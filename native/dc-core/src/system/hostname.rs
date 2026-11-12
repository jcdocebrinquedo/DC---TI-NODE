use chrono::Local;
use serde::{Deserialize, Serialize};
use windows::core::PCWSTR;
use windows::Win32::System::SystemInformation::{
    ComputerNamePhysicalDnsHostname, SetComputerNameExW,
};
use winreg::enums::*;
use winreg::RegKey;

const ACTIVE_COMPUTER_NAME_KEY: &str =
    r"SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName";
const COMPUTER_NAME_KEY: &str = r"SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName";
const TCPIP_PARAMETERS_KEY: &str = r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostnameInfo {
    pub active_name: String,
    pub configured_name: String,
    pub tcpip_hostname: String,
    pub nv_hostname: String,
    pub domain: String,
    pub pending_reboot_change: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostnameChangeResult {
    pub previous_name: String,
    pub new_name: String,
    pub registry_updated: bool,
    pub win32_api_updated: bool,
    pub reboot_required: bool,
    pub changed_at_local: String,
}

/// Captura o estado atual do Hostname diretamente do Registro do Windows (HKLM).
pub fn get_hostname_info() -> Result<HostnameInfo, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let active_name = hklm
        .open_subkey_with_flags(ACTIVE_COMPUTER_NAME_KEY, KEY_READ)
        .and_then(|k| k.get_value::<String, _>("ComputerName"))
        .unwrap_or_else(|_| {
            std::env::var("COMPUTERNAME").unwrap_or_else(|_| "DESCONHECIDO".to_string())
        });

    let configured_name = hklm
        .open_subkey_with_flags(COMPUTER_NAME_KEY, KEY_READ)
        .and_then(|k| k.get_value::<String, _>("ComputerName"))
        .unwrap_or_else(|_| active_name.clone());

    let (tcpip_hostname, nv_hostname, domain) = match hklm
        .open_subkey_with_flags(TCPIP_PARAMETERS_KEY, KEY_READ)
    {
        Ok(key) => {
            let host = key
                .get_value::<String, _>("Hostname")
                .unwrap_or_else(|_| active_name.clone());
            let nv = key
                .get_value::<String, _>("NV Hostname")
                .unwrap_or_else(|_| configured_name.clone());
            let dom = key
                .get_value::<String, _>("Domain")
                .ok()
                .filter(|d| !d.trim().is_empty())
                .or_else(|| key.get_value::<String, _>("DhcpDomain").ok())
                .unwrap_or_else(|| "WORKGROUP".to_string());
            (host, nv, dom)
        }
        Err(_) => (
            active_name.clone(),
            configured_name.clone(),
            "WORKGROUP".to_string(),
        ),
    };

    let pending_reboot_change = !active_name.eq_ignore_ascii_case(&configured_name)
        || !active_name.eq_ignore_ascii_case(&nv_hostname);

    Ok(HostnameInfo {
        active_name,
        configured_name,
        tcpip_hostname,
        nv_hostname,
        domain,
        pending_reboot_change,
    })
}

/// Valida um novo nome de host segundo os padrões corporativos NetBIOS / DNS do Windows.
pub fn validate_hostname(raw_name: &str) -> Result<String, String> {
    let trimmed = raw_name.trim().to_uppercase();
    if trimmed.is_empty() {
        return Err("O nome do computador não pode ser vazio.".to_string());
    }
    if trimmed.len() > 15 {
        return Err(format!(
            "O nome '{}' possui {} caracteres (máximo permitido pelo NetBIOS: 15).",
            trimmed,
            trimmed.len()
        ));
    }
    if trimmed.starts_with('-') || trimmed.ends_with('-') {
        return Err("O nome do computador não pode iniciar ou terminar com hífen ('-').".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(
            "O nome do computador deve conter apenas letras (A-Z), números (0-9) e hífen ('-')."
                .to_string(),
        );
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("O nome do computador não pode ser composto exclusivamente por números.".to_string());
    }
    Ok(trimmed)
}

/// Altera o Hostname gravando diretamente nas chaves do HKLM e invocando a API Win32 SetComputerNameExW.
pub fn set_hostname_registry(new_name_input: &str) -> Result<HostnameChangeResult, String> {
    let validated_name = validate_hostname(new_name_input)?;
    let current_info = get_hostname_info()?;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // 1. Atualiza HKLM\SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName
    let comp_name_key = hklm
        .open_subkey_with_flags(COMPUTER_NAME_KEY, KEY_SET_VALUE | KEY_READ)
        .map_err(|e| {
            format!(
                "Falha ao abrir chave '{}' no HKLM (Permissão de Administrador necessária): {}",
                COMPUTER_NAME_KEY, e
            )
        })?;
    comp_name_key
        .set_value("ComputerName", &validated_name)
        .map_err(|e| format!("Falha ao gravar 'ComputerName' no Registro: {}", e))?;

    // 2. Atualiza HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters (NV Hostname e Hostname)
    let tcpip_key = hklm
        .open_subkey_with_flags(TCPIP_PARAMETERS_KEY, KEY_SET_VALUE | KEY_READ)
        .map_err(|e| {
            format!(
                "Falha ao abrir chave '{}' no HKLM: {}",
                TCPIP_PARAMETERS_KEY, e
            )
        })?;
    tcpip_key
        .set_value("NV Hostname", &validated_name)
        .map_err(|e| format!("Falha ao gravar 'NV Hostname' no Registro: {}", e))?;
    tcpip_key
        .set_value("Hostname", &validated_name)
        .map_err(|e| format!("Falha ao gravar 'Hostname' no Registro: {}", e))?;

    // 3. Notifica a API nativa do Windows (SetComputerNameExW) para sincronizar o DNS físico
    let wide_name: Vec<u16> = validated_name
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let win32_api_updated = unsafe {
        SetComputerNameExW(
            ComputerNamePhysicalDnsHostname,
            PCWSTR::from_raw(wide_name.as_ptr()),
        )
        .is_ok()
    };

    Ok(HostnameChangeResult {
        previous_name: current_info.active_name,
        new_name: validated_name,
        registry_updated: true,
        win32_api_updated,
        reboot_required: true,
        changed_at_local: Local::now().format("%d/%m/%Y %H:%M:%S").to_string(),
    })
}

