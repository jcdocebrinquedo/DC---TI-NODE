use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sysinfo::{Disks, System};
use winreg::enums::*;
use winreg::RegKey;
use wmi::{COMLibrary, Variant, WMIConnection};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeSpaceInfo {
    pub mount_point: String,
    pub name: String,
    pub file_system: String,
    pub total_gb: f64,
    pub available_gb: f64,
    pub used_gb: f64,
    pub used_percent: f32,
    pub is_removable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareConfigReport {
    pub hostname: String,
    pub os_edition: String,
    pub os_display_version: String,
    pub os_build: String,
    pub architecture: String,
    pub uptime_hours: f64,
    pub cpu_brand: String,
    pub cpu_physical_cores: usize,
    pub cpu_logical_cores: usize,
    pub cpu_usage_percent: f32,
    pub ram_total_gb: f64,
    pub ram_used_gb: f64,
    pub ram_available_gb: f64,
    pub ram_usage_percent: f32,
    pub swap_total_gb: f64,
    pub swap_used_gb: f64,
    pub motherboard_manufacturer: String,
    pub motherboard_product: String,
    pub bios_version: String,
    pub gpu_models: Vec<String>,
    pub volumes: Vec<VolumeSpaceInfo>,
}

/// Coleta configuração completa do Hardware, Volumes e Sistema Operacional (sysinfo + WMI + Registro).
pub fn collect_hardware_config() -> Result<HardwareConfigReport, String> {
    let mut sys = System::new_all();
    sys.refresh_all();
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu();

    let hostname = System::host_name().unwrap_or_else(|| "DESCONHECIDO".to_string());
    let (os_edition, os_display_version, os_build) = read_windows_version_from_registry();
    let architecture = std::env::consts::ARCH.to_uppercase();
    let uptime_hours = ((System::uptime() as f64) / 3600.0 * 10.0).round() / 10.0;

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Processador x86_64 Genérico".to_string());
    let cpu_physical_cores = sys.physical_core_count().unwrap_or(1);
    let cpu_logical_cores = sys.cpus().len().max(1);
    let cpu_usage_percent =
        (sys.global_cpu_info().cpu_usage() * 10.0).round() / 10.0;

    let bytes_to_gb = |b: u64| ((b as f64) / (1024.0 * 1024.0 * 1024.0) * 100.0).round() / 100.0;
    let ram_total_gb = bytes_to_gb(sys.total_memory());
    let ram_used_gb = bytes_to_gb(sys.used_memory());
    let ram_available_gb = bytes_to_gb(sys.available_memory());
    let ram_usage_percent = if sys.total_memory() > 0 {
        (((sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0) as f32 * 10.0).round()
            / 10.0
    } else {
        0.0
    };

    let swap_total_gb = bytes_to_gb(sys.total_swap());
    let swap_used_gb = bytes_to_gb(sys.used_swap());

    let disks = Disks::new_with_refreshed_list();
    let mut volumes = Vec::new();
    for d in disks.list() {
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        let avail = d.available_space();
        let used = total.saturating_sub(avail);
        let used_pct = (((used as f64 / total as f64) * 100.0) as f32 * 10.0).round() / 10.0;

        volumes.push(VolumeSpaceInfo {
            mount_point: d.mount_point().to_string_lossy().to_string(),
            name: d.name().to_string_lossy().to_string(),
            file_system: d.file_system().to_string_lossy().to_string(),
            total_gb: bytes_to_gb(total),
            available_gb: bytes_to_gb(avail),
            used_gb: bytes_to_gb(used),
            used_percent: used_pct,
            is_removable: d.is_removable(),
        });
    }

    let (motherboard_manufacturer, motherboard_product, bios_version, gpu_models) =
        query_board_bios_gpu_wmi();

    Ok(HardwareConfigReport {
        hostname,
        os_edition,
        os_display_version,
        os_build,
        architecture,
        uptime_hours,
        cpu_brand,
        cpu_physical_cores,
        cpu_logical_cores,
        cpu_usage_percent,
        ram_total_gb,
        ram_used_gb,
        ram_available_gb,
        ram_usage_percent,
        swap_total_gb,
        swap_used_gb,
        motherboard_manufacturer,
        motherboard_product,
        bios_version,
        gpu_models,
        volumes,
    })
}

fn read_windows_version_from_registry() -> (String, String, String) {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(cv) = hklm.open_subkey_with_flags(
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
        KEY_READ,
    ) {
        let mut product_name = cv
            .get_value::<String, _>("ProductName")
            .unwrap_or_else(|_| "Microsoft Windows".to_string());
        let display_version = cv
            .get_value::<String, _>("DisplayVersion")
            .or_else(|_| cv.get_value::<String, _>("ReleaseId"))
            .unwrap_or_else(|_| "N/A".to_string());
        let current_build = cv
            .get_value::<String, _>("CurrentBuild")
            .or_else(|_| cv.get_value::<String, _>("CurrentBuildNumber"))
            .unwrap_or_else(|_| "0".to_string());
        let ubr = cv.get_value::<u32, _>("UBR").unwrap_or(0);

        // No Windows 11 (Build >= 22000), a chave ProductName legada às vezes permanece "Windows 10"
        if let Ok(build_num) = current_build.parse::<u32>() {
            if build_num >= 22000 && product_name.contains("Windows 10") {
                product_name = product_name.replace("Windows 10", "Windows 11");
            }
        }

        let full_build = if ubr > 0 {
            format!("{}.{}", current_build, ubr)
        } else {
            current_build
        };

        return (product_name, display_version, full_build);
    }

    (
        System::name().unwrap_or_else(|| "Windows".to_string()),
        System::os_version().unwrap_or_else(|| "N/A".to_string()),
        System::kernel_version().unwrap_or_else(|| "N/A".to_string()),
    )
}

fn query_board_bios_gpu_wmi() -> (String, String, String, Vec<String>) {
    let mut mb_manuf = "N/A".to_string();
    let mut mb_prod = "N/A".to_string();
    let mut bios_ver = "N/A".to_string();
    let mut gpus = Vec::new();

    if let Ok(com) = COMLibrary::new() {
        if let Ok(wmi) = WMIConnection::with_namespace_path("ROOT\\CIMV2", com) {
            if let Ok(rows) = wmi.raw_query::<HashMap<String, Variant>>(
                "SELECT Manufacturer, Product FROM Win32_BaseBoard",
            ) {
                if let Some(first) = rows.first() {
                    if let Some(Variant::String(s)) = first.get("Manufacturer") {
                        if !s.trim().is_empty() {
                            mb_manuf = s.trim().to_string();
                        }
                    }
                    if let Some(Variant::String(s)) = first.get("Product") {
                        if !s.trim().is_empty() {
                            mb_prod = s.trim().to_string();
                        }
                    }
                }
            }

            if let Ok(rows) = wmi.raw_query::<HashMap<String, Variant>>(
                "SELECT SMBIOSBIOSVersion, Manufacturer FROM Win32_BIOS",
            ) {
                if let Some(first) = rows.first() {
                    if let Some(Variant::String(s)) = first.get("SMBIOSBIOSVersion") {
                        if !s.trim().is_empty() {
                            bios_ver = s.trim().to_string();
                        }
                    }
                }
            }

            if let Ok(rows) = wmi.raw_query::<HashMap<String, Variant>>(
                "SELECT Name FROM Win32_VideoController",
            ) {
                for r in rows {
                    if let Some(Variant::String(name)) = r.get("Name") {
                        let trimmed = name.trim().to_string();
                        if !trimmed.is_empty() {
                            gpus.push(trimmed);
                        }
                    }
                }
            }
        }
    }

    if gpus.is_empty() {
        gpus.push("Adaptador Gráfico Padrão".to_string());
    }

    (mb_manuf, mb_prod, bios_ver, gpus)
}

