//! Ponto de entrada do sidecar `dc-core.exe`.
//!
//! Modos de execução:
//! - **Servidor stdio (padrão):** lê requisições JSON-Lines do stdin e responde no stdout.
//!   Cada requisição roda em thread própria (COM/WMI inicializado por thread pelas funções nativas).
//! - **CLI de depuração:** `dc-core.exe call <método> [json-params]` executa uma chamada e imprime o JSON.
//! - `dc-core.exe --version` / `dc-core.exe methods`.

use std::io::{self, BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use dc_core::rpc::{dispatch, event_line, response_line, Request, RpcError, CORE_VERSION, METHODS};
use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => println!("dc-core {}", CORE_VERSION),
        Some("methods") => {
            for m in METHODS {
                println!("{}", m);
            }
        }
        Some("call") => std::process::exit(run_cli_call(&args[1..])),
        _ => run_stdio_server(),
    }
}

/// Executa uma única chamada (útil para depurar sem o Electron).
fn run_cli_call(args: &[String]) -> i32 {
    let Some(method) = args.first() else {
        eprintln!("Uso: dc-core.exe call <método> [json-params]");
        return 2;
    };
    let params: Value = match args.get(1) {
        Some(raw) => match serde_json::from_str(raw) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("JSON de parâmetros inválido: {}", e);
                return 2;
            }
        },
        None => Value::Null,
    };

    let emit = |event: &str, data: Value| {
        eprintln!("[evento:{}] {}", event, data);
    };
    let result = safe_dispatch(method, params, &emit);
    let ok = result.is_ok();
    let line = response_line(0, result);
    println!("{}", serde_json::to_string_pretty(&line).unwrap_or_default());
    if ok {
        0
    } else {
        1
    }
}

/// Loop principal JSON-Lines. Encerra quando o stdin é fechado (processo Node encerrado).
fn run_stdio_server() {
    let stdout = Arc::new(Mutex::new(io::stdout()));
    let stdin = io::stdin();

    eprintln!("[dc-core] v{} pronto (pid {}).", CORE_VERSION, std::process::id());

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request: Request = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[dc-core] Requisição malformada ignorada: {}", e);
                continue;
            }
        };

        let out = Arc::clone(&stdout);
        std::thread::spawn(move || {
            let id = request.id;
            let out_events = Arc::clone(&out);
            let emit = move |event: &str, data: Value| {
                write_line(&out_events, &event_line(id, event, data));
            };
            let result = safe_dispatch(&request.method, request.params, &emit);
            write_line(&out, &response_line(id, result));
        });
    }

    eprintln!("[dc-core] stdin encerrado. Finalizando sidecar.");
}

/// Isola panics de código `unsafe`/COM, convertendo-os em erro `E_PANIC` sem derrubar o processo.
fn safe_dispatch(method: &str, params: Value, emit: &dyn Fn(&str, Value)) -> Result<Value, RpcError> {
    match catch_unwind(AssertUnwindSafe(|| dispatch(method, params, emit))) {
        Ok(r) => r,
        Err(panic) => {
            let msg = panic
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "panic sem mensagem".to_string());
            Err(RpcError::new("E_PANIC", format!("Falha interna no core nativo: {}", msg)))
        }
    }
}

/// Escrita atômica de uma linha JSON no stdout (serializada por Mutex entre threads).
fn write_line(out: &Arc<Mutex<io::Stdout>>, value: &Value) {
    let Ok(serialized) = serde_json::to_string(value) else { return };
    if let Ok(mut guard) = out.lock() {
        let _ = writeln!(guard, "{}", serialized);
        let _ = guard.flush();
    }
}

