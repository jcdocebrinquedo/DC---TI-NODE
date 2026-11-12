use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use winreg::enums::*;
use winreg::RegKey;
use wmi::{COMLibrary, Variant, WMIConnection};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskSmartEntry {
    pub index: u32,
    pub device_id: String,
    pub model: String,
    pub serial_number: String,
    pub interface_type: String,
    pub media_type: String,
    pub is_ssd: bool,
    pub size_gb: f64,
    pub wmi_status: String,
    pub predict_failure: bool,
    pub temperature_celsius: Option<u32>,
    pub wear_level_percent: Option<u32>,
    pub power_on_hours: Option<u64>,
    pub reallocated_sectors: Option<u64>,
    pub read_errors_uncorrected: Option<u64>,
    pub trim_enabled_system: bool,
    pub health_score: u8,
    pub health_verdict: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskSmartReport {
    pub disks: Vec<DiskSmartEntry>,
    pub overall_status: String,
    pub has_critical_failure: bool,
    pub trim_enabled: bool,
    pub summary_notes: Vec<String>,
    pub collected_at_local: String,
}

#[derive(Default, Clone, Copy)]
struct RawSmartMetrics {
    predict_failure: Option<bool>,
    temperature_celsius: Option<u32>,
    wear_level_percent: Option<u32>,
    power_on_hours: Option<u64>,
    reallocated_sectors: Option<u64>,
}

/// Verifica no Registro do Windows se o comando TRIM (DisableDeleteNotify == 0) está ativo para SSDs/NVMe.
pub fn is_ntfs_trim_enabled() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(fs_key) = hklm.open_subkey_with_flags(
        r"SYSTEM\CurrentControlSet\Control\FileSystem",
        KEY_READ,
    ) {
        if let Ok(disable_delete_notify) = fs_key.get_value::<u32, _>("DisableDeleteNotify") {
            return disable_delete_notify == 0;
        }
    }
    true
}

/// Coleta telemetria física SMART e parâmetros avançados de SSD/NVMe através de IOCTL nativo Win32
/// (STORAGE_PROPERTY_QUERY com StorageAdapterProtocolSpecificProperty = 49 e StorageDeviceProtocolSpecificProperty = 6
/// para NVMe Health Info Log Page).
fn query_nvme_smart_ioctl(disk_index: u32) -> Option<RawSmartMetrics> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::Ioctl::IOCTL_STORAGE_QUERY_PROPERTY;
    use windows::Win32::System::IO::DeviceIoControl;

    let path_str = format!(r"\\.\PhysicalDrive{}", disk_index);
    let wide_path: Vec<u16> = std::ffi::OsStr::new(&path_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        // Tenta abrir com acesso genérico; se falhar (sem elevação), abre com acesso 0 (query access)
        let mut handle = CreateFileW(
            PCWSTR(wide_path.as_ptr()),
            0x80000000 | 0x40000000, // GENERIC_READ | GENERIC_WRITE
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
            HANDLE::default(),
        );

        if handle.is_err() || handle.as_ref().map(|h| h.is_invalid()).unwrap_or(true) {
            handle = CreateFileW(
                PCWSTR(wide_path.as_ptr()),
                0, // FILE_READ_ATTRIBUTES / Query Access
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
                HANDLE::default(),
            );
        }

        let dev_handle = match handle {
            Ok(h) if !h.is_invalid() => h,
            _ => return None,
        };

        // Testa IDs de propriedade suportados por controladores NVMe no Windows:
        // 49 = StorageAdapterProtocolSpecificProperty (Windows 10/11 NVMe controller)
        // 6  = StorageDeviceProtocolSpecificProperty
        for prop_id in [49u32, 6u32] {
            let buf_size = 4096;
            let mut in_out_buf = vec![0u8; buf_size];

            // STORAGE_PROPERTY_QUERY
            in_out_buf[0..4].copy_from_slice(&prop_id.to_le_bytes()); // PropertyId
            in_out_buf[4..8].copy_from_slice(&0u32.to_le_bytes()); // PropertyStandardQuery

            // STORAGE_PROTOCOL_SPECIFIC_DATA (40 bytes a partir do offset 8)
            in_out_buf[8..12].copy_from_slice(&3u32.to_le_bytes()); // ProtocolTypeNvme = 3
            in_out_buf[12..16].copy_from_slice(&2u32.to_le_bytes()); // DataType = 2 (NVMeDataTypeLogPage)
            in_out_buf[16..20].copy_from_slice(&2u32.to_le_bytes()); // RequestValue = 2 (NVME_LOG_PAGE_HEALTH_INFO)
            in_out_buf[20..24].copy_from_slice(&0u32.to_le_bytes()); // RequestSubValue = 0
            in_out_buf[24..28].copy_from_slice(&40u32.to_le_bytes()); // ProtocolDataOffset = 40
            in_out_buf[28..32].copy_from_slice(&512u32.to_le_bytes()); // ProtocolDataLength = 512

            let mut bytes_returned = 0u32;
            let ok = DeviceIoControl(
                dev_handle,
                IOCTL_STORAGE_QUERY_PROPERTY,
                Some(in_out_buf.as_ptr() as *const _),
                48,
                Some(in_out_buf.as_mut_ptr() as *mut _),
                buf_size as u32,
                Some(&mut bytes_returned),
                None,
            );

            if ok.is_ok() && bytes_returned >= 48 {
                // Layout de retorno:
                // Header (48 bytes): Version(4) + Size(4) + ProtocolSpecificData(40)
                // Os dados do log NVMe iniciam exatamente no byte 48 (offset 40 dentro do struct)
                let log_start = 48usize;
                if log_start + 128 <= in_out_buf.len() {
                    let log = &in_out_buf[log_start..];
                    let crit_warning = log[0];
                    let temp_kelvin = u16::from_le_bytes([log[1], log[2]]);
                    let temp_c = if temp_kelvin >= 273 && temp_kelvin <= 450 {
                        Some((temp_kelvin - 273) as u32)
                    } else {
                        None
                    };

                    let percentage_used = log[5] as u32;

                    // Power On Hours: offset 112..120 dentro da Health Log Page do NVMe
                    let mut poh_bytes = [0u8; 8];
                    poh_bytes.copy_from_slice(&log[112..120]);
                    let poh = u64::from_le_bytes(poh_bytes);

                    // Media errors: offset 144..152
                    let mut media_err_bytes = [0u8; 8];
                    media_err_bytes.copy_from_slice(&log[144..152]);
                    let media_errors = u64::from_le_bytes(media_err_bytes);

                    let _ = CloseHandle(dev_handle);
                    return Some(RawSmartMetrics {
                        predict_failure: Some(crit_warning != 0),
                        temperature_celsius: temp_c,
                        wear_level_percent: Some(percentage_used),
                        power_on_hours: if poh < 10_000_000 { Some(poh) } else { None },
                        reallocated_sectors: Some(media_errors),
                    });
                }
            }
        }

        let _ = CloseHandle(dev_handle);
    }
    None
}

/// Fallback de alta precisão: lê o cache SMART oficial do CrystalDiskInfo se disponível na máquina
fn read_crystaldiskinfo_smart(model: &str, serial: &str) -> Option<RawSmartMetrics> {
    use std::fs;
    use std::path::Path;

    let possible_paths = [
        r"C:\Program Files\CrystalDiskInfo\Smart",
        r"C:\Program Files (x86)\CrystalDiskInfo\Smart",
    ];

    let clean_model = model.replace(" ", "").to_uppercase();
    let clean_serial = serial.replace(" ", "").replace("_", "").to_uppercase();

    for base in possible_paths {
        let base_path = Path::new(base);
        if !base_path.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(base_path) {
            for entry in entries.flatten() {
                let dir_name = entry.file_name().to_string_lossy().to_string();
                let upper_dir = dir_name.replace(" ", "").replace("_", "").to_uppercase();

                let model_match = clean_model.chars().take(8).collect::<String>();
                let serial_match = if clean_serial.len() >= 6 {
                    clean_serial.chars().take(6).collect::<String>()
                } else {
                    String::new()
                };

                let matches = upper_dir.contains(&clean_model)
                    || (!model_match.is_empty() && upper_dir.contains(&model_match))
                    || (!serial_match.is_empty() && upper_dir.contains(&serial_match));

                if matches {
                    let ini_path = entry.path().join("Smart.ini");
                    if ini_path.exists() {
                        if let Ok(content) = fs::read_to_string(&ini_path) {
                            let mut metrics = RawSmartMetrics::default();
                            let mut in_target_section = false;

                            for line in content.lines() {
                                let line = line.trim();
                                if line.starts_with('[') && line.ends_with(']') {
                                    let sec = line.to_uppercase();
                                    // Ignora PC ou THRESHOLD, foca no nome do disco
                                    in_target_section = !sec.contains("PC") && !sec.contains("THRESHOLD");
                                    continue;
                                }

                                if in_target_section {
                                    if let Some((k, v)) = line.split_once('=') {
                                        let key = k.trim().to_uppercase();
                                        let val = v.trim().trim_matches('"');

                                        if key == "TEMPERATURE" {
                                            if let Ok(t) = val.parse::<u32>() {
                                                if (10..=120).contains(&t) {
                                                    metrics.temperature_celsius = Some(t);
                                                }
                                            }
                                        } else if key == "LIFE" {
                                            if let Ok(life_remaining) = val.parse::<u32>() {
                                                // Life no CrystalDiskInfo é vida útil restante (ex: 84%).
                                                // Desgaste (percentage used) é 100 - Life
                                                let wear = 100u32.saturating_sub(life_remaining);
                                                metrics.wear_level_percent = Some(wear);
                                            }
                                        } else if key == "POWERONHOURS" {
                                            if let Ok(poh) = val.parse::<u64>() {
                                                metrics.power_on_hours = Some(poh);
                                            }
                                        } else if key == "REALLOCATEDSECTORSCOUNT" {
                                            if let Ok(bad) = val.parse::<u64>() {
                                                metrics.reallocated_sectors = Some(bad);
                                            }
                                        } else if key == "HEALTHSTATUS" {
                                            if let Ok(hs) = val.parse::<u32>() {
                                                // 1 = Saudável, 2 = Atenção/Alerta, 3 = Ruim
                                                metrics.predict_failure = Some(hs >= 3);
                                            }
                                        }
                                    }
                                }
                            }

                            if metrics.temperature_celsius.is_some()
                                || metrics.wear_level_percent.is_some()
                                || metrics.power_on_hours.is_some()
                                || metrics.reallocated_sectors.is_some()
                            {
                                return Some(metrics);
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Executa varredura profunda de discos e telemetria SMART combinando Win32 IOCTL direto para NVMe,
/// classes WMI do Windows Storage e namespace CIMV2.
pub fn scan_disks_smart() -> Result<DiskSmartReport, String> {
    let com_con = COMLibrary::new()
        .map_err(|e| format!("Falha ao inicializar COM para WMI: {}", e))?;

    let cimv2 = WMIConnection::with_namespace_path("ROOT\\CIMV2", com_con)
        .map_err(|e| format!("Falha ao conectar ao namespace ROOT\\CIMV2: {}", e))?;

    let trim_enabled = is_ntfs_trim_enabled();

    // 1. Coleta predição de falha e bytes brutos SMART SATA em ROOT\WMI
    let mut smart_by_instance: HashMap<String, RawSmartMetrics> = HashMap::new();
    if let Ok(wmi_root) = WMIConnection::with_namespace_path("ROOT\\WMI", com_con) {
        if let Ok(status_rows) = wmi_root.raw_query::<HashMap<String, Variant>>(
            "SELECT InstanceName, PredictFailure FROM MSStorageDriver_FailurePredictStatus",
        ) {
            for row in status_rows {
                let instance = variant_to_string(row.get("InstanceName")).to_uppercase();
                let pred = variant_to_bool(row.get("PredictFailure")).unwrap_or(false);
                if !instance.is_empty() {
                    let entry = smart_by_instance.entry(instance).or_default();
                    entry.predict_failure = Some(pred);
                }
            }
        }

        if let Ok(data_rows) = wmi_root.raw_query::<HashMap<String, Variant>>(
            "SELECT InstanceName, VendorSpecific FROM MSStorageDriver_FailurePredictData",
        ) {
            for row in data_rows {
                let instance = variant_to_string(row.get("InstanceName")).to_uppercase();
                if let Some(bytes) = variant_to_u8_vec(row.get("VendorSpecific")) {
                    let parsed = parse_vendor_specific_smart(&bytes);
                    let entry = smart_by_instance.entry(instance).or_default();
                    if parsed.temperature_celsius.is_some() {
                        entry.temperature_celsius = parsed.temperature_celsius;
                    }
                    if parsed.wear_level_percent.is_some() {
                        entry.wear_level_percent = parsed.wear_level_percent;
                    }
                    if parsed.power_on_hours.is_some() {
                        entry.power_on_hours = parsed.power_on_hours;
                    }
                    if parsed.reallocated_sectors.is_some() {
                        entry.reallocated_sectors = parsed.reallocated_sectors;
                    }
                }
            }
        }
    }

    // 2. Coleta dados complementares do Storage Namespace (MSFT_PhysicalDisk)
    // BusType: 17 = NVMe, 11 = SATA, 8 = RAID, 7 = USB
    // MediaType: 3 = HDD, 4 = SSD, 5 = SCM
    let mut storage_disks_by_index: HashMap<u32, (bool, bool, String, String, Option<u32>)> = HashMap::new();
    if let Ok(storage_wmi) =
        WMIConnection::with_namespace_path("ROOT\\Microsoft\\Windows\\Storage", com_con)
    {
        if let Ok(phys_rows) = storage_wmi.raw_query::<HashMap<String, Variant>>(
            "SELECT DeviceId, MediaType, BusType, HealthStatus, OperationalStatus, FriendlyName, SerialNumber, AdapterSerialNumber FROM MSFT_PhysicalDisk",
        ) {
            for row in phys_rows {
                if let Some(dev_id) = variant_to_string(row.get("DeviceId"))
                    .trim()
                    .parse::<u32>()
                    .ok()
                {
                    let media_type_code = variant_to_u64(row.get("MediaType")).unwrap_or(0);
                    let bus_type_code = variant_to_u64(row.get("BusType")).unwrap_or(0);
                    let is_ssd_flag = media_type_code == 4 || media_type_code == 5 || bus_type_code == 17;
                    let is_nvme_flag = bus_type_code == 17;

                    let bus_str = match bus_type_code {
                        17 => "NVMe".to_string(),
                        11 => "SATA".to_string(),
                        7 => "USB".to_string(),
                        8 => "RAID".to_string(),
                        3 => "ATAPI".to_string(),
                        _ => "SCSI".to_string(),
                    };

                    let mut serial = variant_to_string(row.get("AdapterSerialNumber")).trim().to_string(); if serial.is_empty() { serial = variant_to_string(row.get("SerialNumber")).trim().to_string(); }
                    let health_status = variant_to_u64(row.get("HealthStatus")).map(|v| v as u32);

                    storage_disks_by_index.insert(dev_id, (is_ssd_flag, is_nvme_flag, bus_str, serial, health_status));
                }
            }
        }
    }

    // 3. Consulta principal em Win32_DiskDrive
    let disk_rows = cimv2
        .raw_query::<HashMap<String, Variant>>(
            "SELECT Index, DeviceID, Model, SerialNumber, InterfaceType, MediaType, Size, Status, PNPDeviceID FROM Win32_DiskDrive",
        )
        .map_err(|e| format!("Falha ao consultar Win32_DiskDrive: {}", e))?;

    let mut disks = Vec::new();
    let mut summary_notes = Vec::new();
    let mut has_critical_failure = false;

    for row in disk_rows {
        let index = variant_to_u64(row.get("Index")).unwrap_or(0) as u32;
        let device_id = variant_to_string(row.get("DeviceID"));
        let model = variant_to_string(row.get("Model")).trim().to_string();
        let mut serial_number = variant_to_string(row.get("SerialNumber")).trim().to_string();
        let mut interface_type = variant_to_string(row.get("InterfaceType")).trim().to_string();
        let media_type = variant_to_string(row.get("MediaType")).trim().to_string();
        let size_bytes = variant_to_u64(row.get("Size")).unwrap_or(0);
        let size_gb = (size_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
        let wmi_status = variant_to_string(row.get("Status")).trim().to_string();
        let pnp_id = variant_to_string(row.get("PNPDeviceID")).to_uppercase();

        let mut is_ssd = model.to_uppercase().contains("SSD")
            || model.to_uppercase().contains("NVME")
            || pnp_id.contains("NVME");
        let mut is_nvme = model.to_uppercase().contains("NVME") || pnp_id.contains("NVME");

        if let Some((st_ssd, st_nvme, st_bus, st_serial, _)) = storage_disks_by_index.get(&index) {
            if *st_ssd {
                is_ssd = true;
            }
            if *st_nvme {
                is_nvme = true;
            }
            if !st_bus.is_empty() && (interface_type == "SCSI" || interface_type.is_empty()) {
                interface_type = st_bus.clone();
            }
            if serial_number.is_empty() || serial_number.contains("0000_0000_") {
                if !st_serial.is_empty() {
                    serial_number = st_serial.clone();
                }
            }
        }

        let mut predict_failure = !wmi_status.eq_ignore_ascii_case("OK") && !wmi_status.is_empty();
        let mut temperature_celsius = None;
        let mut wear_level_percent = None;
        let mut power_on_hours = None;
        let mut reallocated_sectors = None;
        let read_errors_uncorrected = None;

        // Se for NVMe, executa primeiro a consulta via IOCTL nativo de protocolo NVMe
        if is_nvme {
            if let Some(nvme_raw) = query_nvme_smart_ioctl(index) {
                if let Some(pf) = nvme_raw.predict_failure {
                    predict_failure = predict_failure || pf;
                }
                if nvme_raw.temperature_celsius.is_some() {
                    temperature_celsius = nvme_raw.temperature_celsius;
                }
                if nvme_raw.wear_level_percent.is_some() {
                    wear_level_percent = nvme_raw.wear_level_percent;
                }
                if nvme_raw.power_on_hours.is_some() {
                    power_on_hours = nvme_raw.power_on_hours;
                }
                reallocated_sectors = nvme_raw.reallocated_sectors;
            }
        }

        // Caso ainda não tenha telemetria (ex: SATA HDD ou se IOCTL não respondeu), mescla com os dados do MSStorageDriver
        for (inst_key, raw) in &smart_by_instance {
            if !pnp_id.is_empty() && inst_key.contains(&pnp_id) {
                if let Some(pf) = raw.predict_failure {
                    predict_failure = predict_failure || pf;
                }
                if temperature_celsius.is_none() {
                    temperature_celsius = raw.temperature_celsius;
                }
                if wear_level_percent.is_none() {
                    wear_level_percent = raw.wear_level_percent;
                }
                if power_on_hours.is_none() {
                    power_on_hours = raw.power_on_hours;
                }
                if reallocated_sectors.is_none() {
                    reallocated_sectors = raw.reallocated_sectors;
                }
                break;
            }
        }

        // Se os valores ainda estiverem nulos (ou para enriquecer com precisão máxima), consulta o cache SMART oficial
        if temperature_celsius.is_none() || wear_level_percent.is_none() || power_on_hours.is_none() {
            if let Some(cdi_raw) = read_crystaldiskinfo_smart(&model, &serial_number) {
                if let Some(pf) = cdi_raw.predict_failure {
                    predict_failure = predict_failure || pf;
                }
                if temperature_celsius.is_none() && cdi_raw.temperature_celsius.is_some() {
                    temperature_celsius = cdi_raw.temperature_celsius;
                }
                if wear_level_percent.is_none() && cdi_raw.wear_level_percent.is_some() {
                    wear_level_percent = cdi_raw.wear_level_percent;
                }
                if power_on_hours.is_none() && cdi_raw.power_on_hours.is_some() {
                    power_on_hours = cdi_raw.power_on_hours;
                }
                if cdi_raw.reallocated_sectors.is_some() {
                    reallocated_sectors = cdi_raw.reallocated_sectors;
                }
            }
        }

        // Se for SSD/NVMe sem contagem de reallocated sectors (não aplicável em flash), define 0
        if is_ssd && reallocated_sectors.is_none() {
            reallocated_sectors = Some(0);
        }

        // Estima parâmetros nominais se for NVMe com HealthStatus 0 (Healthy)
        if is_nvme && wear_level_percent.is_none() {
            // Unidade NVMe saudável reportando status OK
            // NVMe fallback removido para evitar falso 100%
        }

        // Calcula o Score individual do disco (0 a 100)
        let mut health_score: i32 = 100;
        if predict_failure {
            health_score -= 70;
            has_critical_failure = true;
            summary_notes.push(format!(
                "ALERTA CRÍTICO: Disco #{} ({}) reportou falha iminente via SMART!",
                index, model
            ));
        }
        if let Some(realloc) = reallocated_sectors {
            if realloc > 0 {
                let penalty = (realloc as i32 * 3).min(35);
                health_score -= penalty;
                summary_notes.push(format!(
                    "Disco #{} ({}) possui {} setores realocados (Bad Blocks físicos).",
                    index, model, realloc
                ));
            }
        }
        if let Some(wear) = wear_level_percent {
            // Em SSDs e NVMe, a pontuação de saúde reflete diretamente a vida útil restante das células
            // Se o desgaste for 16% (ex: Life 84%), a saúde física real é 84%.
            let wear_penalty = wear as i32;
            health_score -= wear_penalty;
            if wear >= 80 {
                summary_notes.push(format!(
                    "Disco #{} ({}) apresenta desgaste elevado de células ({}% consumido).",
                    index, model, wear
                ));
            } else if wear >= 50 {
                summary_notes.push(format!(
                    "Disco #{} ({}) com {}% de desgaste de células.",
                    index, model, wear
                ));
            }
        }
        if let Some(temp) = temperature_celsius {
            if temp >= 65 {
                health_score -= 20;
                summary_notes.push(format!(
                    "Disco #{} ({}) operando em temperatura crítica ({} °C).",
                    index, model, temp
                ));
            } else if temp >= 55 {
                health_score -= 10;
            }
        }
        if is_ssd && !trim_enabled {
            health_score -= 5;
        }

        let final_score = health_score.clamp(0, 100) as u8;
        let health_verdict = match final_score {
            85..=100 => "Saudável (Excelente)".to_string(),
            65..=84 => "Bom (Atenção Moderada)".to_string(),
            40..=64 => "Degradado (Planejar Substituição)".to_string(),
            _ => "Crítico (Risco Iminente de Perda de Dados)".to_string(),
        };

        disks.push(DiskSmartEntry {
            index,
            device_id,
            model,
            serial_number,
            interface_type,
            media_type,
            is_ssd,
            size_gb: (size_gb * 100.0).round() / 100.0,
            wmi_status,
            predict_failure,
            temperature_celsius,
            wear_level_percent,
            power_on_hours,
            reallocated_sectors,
            read_errors_uncorrected,
            trim_enabled_system: trim_enabled,
            health_score: final_score,
            health_verdict,
        });
    }

    disks.sort_by_key(|d| d.index);

    if summary_notes.is_empty() {
        summary_notes.push(
            "Todos os discos físicos responderam com status operacional íntegro.".to_string(),
        );
    }

    let overall_status = if has_critical_failure {
        "CRÍTICO - Falha SMART Detectada".to_string()
    } else if disks.iter().any(|d| d.health_score < 70) {
        "ATENÇÃO - Sinais de Desgaste".to_string()
    } else {
        "SAUDÁVEL - Todos os Discos OK".to_string()
    };

    Ok(DiskSmartReport {
        disks,
        overall_status,
        has_critical_failure,
        trim_enabled,
        summary_notes,
        collected_at_local: Local::now().format("%d/%m/%Y %H:%M:%S").to_string(),
    })
}

/// Decodifica a tabela de atributos SMART legados do buffer VendorSpecific (SATA).
fn parse_vendor_specific_smart(bytes: &[u8]) -> RawSmartMetrics {
    let mut metrics = RawSmartMetrics::default();
    if bytes.len() < 14 {
        return metrics;
    }

    let mut offset = 2;
    while offset + 12 <= bytes.len() && offset < 362 {
        let attr_id = bytes[offset];
        let current_val = bytes[offset + 3];
        let raw_lo = u32::from_le_bytes([
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
            bytes[offset + 8],
        ]) as u64;

        match attr_id {
            0x05 | 0xC4 => {
                metrics.reallocated_sectors = Some(raw_lo);
            }
            0x09 => {
                if raw_lo < 1_000_000 {
                    metrics.power_on_hours = Some(raw_lo);
                }
            }
            0xBE | 0xC2 => {
                let temp = (raw_lo & 0xFF) as u32;
                if (10..=110).contains(&temp) {
                    metrics.temperature_celsius = Some(temp);
                }
            }
            0xE7 | 0xE9 | 0xB1 | 0xAD => {
                if (1..=100).contains(&current_val) {
                    let wear = 100u32.saturating_sub(current_val as u32);
                    metrics.wear_level_percent = Some(wear);
                }
            }
            _ => {}
        }

        offset += 12;
    }

    metrics
}

fn variant_to_string(v: Option<&Variant>) -> String {
    match v {
        Some(Variant::String(s)) => s.clone(),
        Some(Variant::UI1(n)) => n.to_string(),
        Some(Variant::UI2(n)) => n.to_string(),
        Some(Variant::UI4(n)) => n.to_string(),
        Some(Variant::UI8(n)) => n.to_string(),
        Some(Variant::I4(n)) => n.to_string(),
        Some(Variant::I8(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn variant_to_u64(v: Option<&Variant>) -> Option<u64> {
    match v {
        Some(Variant::UI1(n)) => Some(*n as u64),
        Some(Variant::UI2(n)) => Some(*n as u64),
        Some(Variant::UI4(n)) => Some(*n as u64),
        Some(Variant::UI8(n)) => Some(*n),
        Some(Variant::I2(n)) if *n >= 0 => Some(*n as u64),
        Some(Variant::I4(n)) if *n >= 0 => Some(*n as u64),
        Some(Variant::I8(n)) if *n >= 0 => Some(*n as u64),
        Some(Variant::String(s)) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn variant_to_bool(v: Option<&Variant>) -> Option<bool> {
    match v {
        Some(Variant::Bool(b)) => Some(*b),
        Some(Variant::UI1(n)) => Some(*n != 0),
        _ => None,
    }
}

fn variant_to_u8_vec(v: Option<&Variant>) -> Option<Vec<u8>> {
    match v {
        Some(Variant::Array(arr)) => {
            let mut out = Vec::with_capacity(arr.len());
            for item in arr {
                if let Variant::UI1(b) = item {
                    out.push(*b);
                }
            }
            Some(out)
        }
        _ => None,
    }
}
