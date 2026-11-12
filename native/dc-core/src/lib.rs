//! # DC-TI Native Core (`dc_core`)
//!
//! Camada nativa de baixo nível do DC-TI. Contém **apenas** o que exige acesso profundo ao Windows:
//! - [`system`]: Hostname em HKLM + `SetComputerNameExW`, SMART via WMI/IOCTL, usuários locais (NetAPI),
//!   bateria (Win32/ACPI), hardware (WMI/sysinfo), Event Viewer (EvtQuery) e verificação de token UAC.
//! - [`modules`]: Configuração de conta Outlook via Registro (valores binários) e Stress Test nativo de CPU/RAM.
//! - [`rpc`]: Contrato JSON-RPC (JSON-Lines sobre stdio) consumido pelo processo Node.js/Electron.
//!
//! Toda a lógica de apresentação, score analítico, OS, limpeza e reparos vive no Node.js.

pub mod modules;
pub mod rpc;
pub mod system;

