//! Contrato JSON-RPC do sidecar `dc-core` (JSON-Lines sobre stdin/stdout).
//!
//! Requisição  (Node → Rust): `{"id":1,"method":"system.hostname.get","params":{}}`
//! Resposta    (Rust → Node): `{"id":1,"ok":true,"result":{...}}` ou
//!                            `{"id":1,"ok":false,"error":{"code":"E_NOT_ELEVATED","message":"..."}}`
//! Evento      (Rust → Node): `{"id":1,"event":"tick","data":{...}}` (progresso de operações longas)

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::modules::email::{
    configure_outlook_corporate_email, detect_outlook_profile, CorporateEmailConfig,
};
use crate::modules::stress::{run_stress_test, StressTestConfig, StressTickSnapshot};
use crate::system::battery::get_battery_status;
use crate::system::disk_smart::{is_ntfs_trim_enabled, scan_disks_smart};
use crate::system::event_log::analyze_shutdown_events;
use crate::system::hardware::collect_hardware_config;
use crate::system::hostname::{get_hostname_info, set_hostname_registry, validate_hostname};
use crate::system::is_running_as_admin;
use crate::system::user_manager::{list_local_users, update_user_account};

pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Lista pública de métodos expostos ao Node.js (mantida em sincronia com `dispatch`).
pub const METHODS: &[&str] = &[
    "core.ping",
    "core.methods",
    "system.admin.check",
    "system.hostname.get",
    "system.hostname.validate",
    "system.hostname.set",
    "system.disk.smart",
    "system.disk.trim",
    "system.hardware",
    "system.battery",
    "system.events.shutdown",
    "system.users.list",
    "system.users.update",
    "outlook.detect",
    "outlook.configure",
    "stress.run",
];

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    pub code: &'static str,
    pub message: String,
}

impl RpcError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    fn native(message: String) -> Self {
        Self::new("E_NATIVE", message)
    }
}

/// Monta a linha de resposta de sucesso/erro.
pub fn response_line(id: u64, result: Result<Value, RpcError>) -> Value {
    match result {
        Ok(v) => json!({ "id": id, "ok": true, "result": v }),
        Err(e) => json!({ "id": id, "ok": false, "error": e }),
    }
}

/// Monta a linha de evento de progresso.
pub fn event_line(id: u64, event: &str, data: Value) -> Value {
    json!({ "id": id, "event": event, "data": data })
}

// ---------------------------------------------------------------------------
// Parâmetros tipados
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HostnameParams {
    name: String,
}

#[derive(Deserialize)]
struct EventsParams {
    #[serde(default = "default_max_events")]
    max_events: usize,
}
fn default_max_events() -> usize {
    600
}

#[derive(Deserialize)]
struct UserUpdateParams {
    target_username: String,
    #[serde(default)]
    new_username: Option<String>,
    #[serde(default)]
    new_full_name: Option<String>,
}

#[derive(Deserialize, Default)]
struct StressParams {
    duration_seconds: Option<u64>,
    memory_allocation_mb: Option<usize>,
    threads_count: Option<usize>,
}

fn parse<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, RpcError> {
    let normalized = if params.is_null() { json!({}) } else { params };
    serde_json::from_value(normalized)
        .map_err(|e| RpcError::new("E_INVALID_PARAMS", format!("Parâmetros inválidos: {}", e)))
}

fn to_value<T: Serialize>(value: T) -> Result<Value, RpcError> {
    serde_json::to_value(value)
        .map_err(|e| RpcError::new("E_SERIALIZE", format!("Falha ao serializar resposta: {}", e)))
}

fn require_admin() -> Result<(), RpcError> {
    if is_running_as_admin() {
        Ok(())
    } else {
        Err(RpcError::new(
            "E_NOT_ELEVATED",
            "Operação requer privilégios de Administrador (token UAC elevado). Execute o DC-TI como Administrador.",
        ))
    }
}

/// Despacha um método para a função nativa correspondente.
/// `emit(evento, dados)` publica eventos de progresso para o Node.js.
pub fn dispatch(method: &str, params: Value, emit: &dyn Fn(&str, Value)) -> Result<Value, RpcError> {
    match method {
        "core.ping" => Ok(json!({
            "pong": true,
            "version": CORE_VERSION,
            "pid": std::process::id(),
            "elevated": is_running_as_admin(),
        })),
        "core.methods" => to_value(METHODS),

        "system.admin.check" => Ok(json!({ "elevated": is_running_as_admin() })),

        // --- Hostname (HKLM + SetComputerNameExW) ---
        "system.hostname.get" => get_hostname_info().map_err(RpcError::native).and_then(to_value),
        "system.hostname.validate" => {
            let p: HostnameParams = parse(params)?;
            match validate_hostname(&p.name) {
                Ok(normalized) => Ok(json!({ "valid": true, "normalized": normalized })),
                Err(msg) => Ok(json!({ "valid": false, "message": msg })),
            }
        }
        "system.hostname.set" => {
            let p: HostnameParams = parse(params)?;
            // Defesa em profundidade: o Node já validou, o Rust valida novamente antes de tocar no HKLM.
            validate_hostname(&p.name).map_err(|m| RpcError::new("E_VALIDATION", m))?;
            require_admin()?;
            set_hostname_registry(&p.name).map_err(RpcError::native).and_then(to_value)
        }

        // --- Armazenamento (WMI MSStorageDriver + IOCTL) ---
        "system.disk.smart" => scan_disks_smart().map_err(RpcError::native).and_then(to_value),
        "system.disk.trim" => Ok(json!({ "trim_enabled": is_ntfs_trim_enabled() })),

        // --- Hardware / Bateria / Event Viewer ---
        "system.hardware" => collect_hardware_config().map_err(RpcError::native).and_then(to_value),
        "system.battery" => get_battery_status().map_err(RpcError::native).and_then(to_value),
        "system.events.shutdown" => {
            let p: EventsParams = parse(params)?;
            analyze_shutdown_events(p.max_events.clamp(10, 5000))
                .map_err(RpcError::native)
                .and_then(to_value)
        }

        // --- Usuários locais (NetUserEnum / NetUserSetInfo) ---
        "system.users.list" => to_value(list_local_users()),
        "system.users.update" => {
            let p: UserUpdateParams = parse(params)?;
            require_admin()?;
            let new_user = p.new_username.as_deref().map(str::trim).filter(|s| !s.is_empty());
            let new_full = p.new_full_name.as_deref().map(str::trim).filter(|s| !s.is_empty());
            update_user_account(&p.target_username, new_user, new_full)
                .map_err(RpcError::native)
                .and_then(to_value)
        }

        // --- Outlook (Registro HKCU com valores REG_BINARY) ---
        "outlook.detect" => to_value(detect_outlook_profile()),
        "outlook.configure" => {
            let cfg: CorporateEmailConfig = parse(params)?;
            configure_outlook_corporate_email(&cfg)
                .map_err(RpcError::native)
                .and_then(to_value)
        }

        // --- Stress Test nativo com eventos de progresso ---
        "stress.run" => {
            let p: StressParams = parse(params)?;
            let mut cfg = StressTestConfig::default();
            if let Some(v) = p.duration_seconds {
                cfg.duration_seconds = v;
            }
            if let Some(v) = p.memory_allocation_mb {
                cfg.memory_allocation_mb = v;
            }
            if let Some(v) = p.threads_count {
                cfg.threads_count = v;
            }
            let on_tick = |tick: StressTickSnapshot| {
                emit("tick", serde_json::to_value(tick).unwrap_or(Value::Null));
            };
            run_stress_test(&cfg, Some(on_tick))
                .map_err(RpcError::native)
                .and_then(to_value)
        }

        other => Err(RpcError::new(
            "E_UNKNOWN_METHOD",
            format!("Método '{}' não existe no dc-core v{}.", other, CORE_VERSION),
        )),
    }
}

