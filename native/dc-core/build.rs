use embed_manifest::manifest::ExecutionLevel;
use embed_manifest::{embed_manifest, new_manifest};
use std::fs;
use std::path::PathBuf;

fn main() {
    if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
        // IMPORTANTE: o sidecar usa 'asInvoker'. Ele HERDA o token do processo pai (Electron).
        // Com 'requireAdministrator', o spawn() do Node falharia com erro 740 (ERROR_ELEVATION_REQUIRED)
        // e o stdio redirecionado deixaria de funcionar.
        let manifest = new_manifest("DC.TI.NativeCore")
            .requested_execution_level(ExecutionLevel::AsInvoker);
        embed_manifest(manifest).expect("Falha ao embutir o manifesto (asInvoker)");

        let target = std::env::var("TARGET").unwrap_or_default();
        if target.ends_with("windows-gnullvm") {
            configure_gnullvm_static_link();
        }
    }
    println!("cargo:rerun-if-changed=build.rs");
}

/// Compatibilidade e vinculação 100% estática para o toolchain x86_64-pc-windows-gnullvm
/// (dispensa Visual Studio Build Tools). Herdado do projeto original DC-TI.
fn configure_gnullvm_static_link() {
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    let out_path = PathBuf::from(&out_dir);

    // 1. Stubs de bibliotecas já incluídas no runtime do Windows
    for lib_name in [
        "libadvapi32.a",
        "libcredui.a",
        "libsecur32.a",
        "libopengl32.a",
        "libshell32.a",
        "libgdi32.a",
        "libmsimg32.a",
        "libwinspool.a",
    ] {
        let stub = out_path.join(lib_name);
        if !stub.exists() {
            let _ = fs::write(&stub, b"!<arch>\n");
        }
    }

    // 2. Força libunwind estático (elimina dependência externa de libunwind.dll)
    let rustup_home = std::env::var("RUSTUP_HOME").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join(".rustup")
    });
    let toolchain = std::env::var("RUSTUP_TOOLCHAIN")
        .unwrap_or_else(|_| "stable-x86_64-pc-windows-gnullvm".to_string());
    let static_unwind_src = rustup_home
        .join("toolchains")
        .join(&toolchain)
        .join(r"lib\rustlib\x86_64-pc-windows-gnullvm\lib\self-contained\libunwind.a");
    if static_unwind_src.exists() {
        let _ = fs::copy(&static_unwind_src, out_path.join("libunwind.dll.a"));
    }

    println!("cargo:rustc-link-search=native={}", out_path.display());
}

