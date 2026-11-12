use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use wmi::{COMLibrary, Variant, WMIConnection};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryReport {
    pub is_present: bool,
    pub battery_name: String,
    pub ac_online: bool,
    pub is_charging: bool,
    pub charge_percent: u8,
    pub design_capacity_mwh: Option<u32>,
    pub full_charge_capacity_mwh: Option<u32>,
    pub wear_level_percent: Option<f32>,
    pub cycle_count: Option<u32>,
    pub estimated_run_time_mins: Option<u32>,
    pub health_status: String,
}

/// Captura o estado completo da bateria (se notebook) combinando Win32 Power API e WMI (ROOT\WMI e ROOT\CIMV2).
pub fn get_battery_status() -> Result<BatteryReport, String> {
    let mut sps = SYSTEM_POWER_STATUS::default();
    let win32_ok = unsafe { GetSystemPowerStatus(&mut sps).is_ok() };

    // BatteryFlag == 128 indica ausência de bateria (Desktop)
    let has_battery_win32 = win32_ok && (sps.BatteryFlag & 128 == 0) && sps.BatteryFlag != 255;
    let ac_online = win32_ok && sps.ACLineStatus == 1;
    let is_charging_win32 = win32_ok && (sps.BatteryFlag & 8 != 0);
    let charge_percent_win32 = if win32_ok && sps.BatteryLifePercent <= 100 {
        sps.BatteryLifePercent
    } else {
        0
    };
    let est_mins_win32 = if win32_ok && sps.BatteryLifeTime != u32::MAX {
        Some(sps.BatteryLifeTime / 60)
    } else {
        None
    };

    let mut battery_name = "Bateria Interna Padrão".to_string();
    let mut wmi_present = false;
    let mut charge_percent = charge_percent_win32;
    let mut est_mins = est_mins_win32;
    let mut design_capacity_mwh: Option<u32> = None;
    let mut full_charge_capacity_mwh: Option<u32> = None;
    let mut cycle_count: Option<u32> = None;

    if let Ok(com_con) = COMLibrary::new() {
        // 1. Consulta Win32_Battery em ROOT\CIMV2
        if let Ok(cimv2) = WMIConnection::with_namespace_path("ROOT\\CIMV2", com_con) {
            if let Ok(rows) = cimv2.raw_query::<HashMap<String, Variant>>(
                "SELECT Name, EstimatedChargeRemaining, EstimatedRunTime, DesignCapacity, FullChargeCapacity FROM Win32_Battery",
            ) {
                if let Some(first) = rows.first() {
                    wmi_present = true;
                    if let Some(Variant::String(name)) = first.get("Name") {
                        if !name.trim().is_empty() {
                            battery_name = name.trim().to_string();
                        }
                    }
                    if let Some(rem) = variant_u32(first.get("EstimatedChargeRemaining")) {
                        if rem <= 100 {
                            charge_percent = rem as u8;
                        }
                    }
                    if est_mins.is_none() {
                        if let Some(rt) = variant_u32(first.get("EstimatedRunTime")) {
                            if rt > 0 && rt < 71582788 {
                                est_mins = Some(rt);
                            }
                        }
                    }
                    design_capacity_mwh = variant_u32(first.get("DesignCapacity")).filter(|&v| v > 0);
                    full_charge_capacity_mwh =
                        variant_u32(first.get("FullChargeCapacity")).filter(|&v| v > 0);
                }
            }
        }

        // 2. Consulta telemetria avançada do driver ACPI da bateria em ROOT\WMI
        if let Ok(wmi_root) = WMIConnection::with_namespace_path("ROOT\\WMI", com_con) {
            if let Ok(static_rows) = wmi_root.raw_query::<HashMap<String, Variant>>(
                "SELECT DesignedCapacity, DeviceName FROM BatteryStaticData",
            ) {
                if let Some(first) = static_rows.first() {
                    wmi_present = true;
                    if let Some(dc) = variant_u32(first.get("DesignedCapacity")).filter(|&v| v > 0) {
                        design_capacity_mwh = Some(dc);
                    }
                    if let Some(Variant::String(dev_name)) = first.get("DeviceName") {
                        if !dev_name.trim().is_empty() {
                            battery_name = dev_name.trim().to_string();
                        }
                    }
                }
            }

            if let Ok(full_rows) = wmi_root.raw_query::<HashMap<String, Variant>>(
                "SELECT FullChargedCapacity FROM BatteryFullChargedCapacity",
            ) {
                if let Some(first) = full_rows.first() {
                    if let Some(fcc) =
                        variant_u32(first.get("FullChargedCapacity")).filter(|&v| v > 0)
                    {
                        full_charge_capacity_mwh = Some(fcc);
                    }
                }
            }

            if let Ok(cycle_rows) = wmi_root.raw_query::<HashMap<String, Variant>>(
                "SELECT CycleCount FROM BatteryCycleCount",
            ) {
                if let Some(first) = cycle_rows.first() {
                    cycle_count = variant_u32(first.get("CycleCount"));
                }
            }
        }
    }

    let is_present = has_battery_win32 || wmi_present;
    if !is_present {
        return Ok(BatteryReport {
            is_present: false,
            battery_name: "N/A (Estação Desktop / Sem Bateria)".to_string(),
            ac_online: true,
            is_charging: false,
            charge_percent: 0,
            design_capacity_mwh: None,
            full_charge_capacity_mwh: None,
            wear_level_percent: None,
            cycle_count: None,
            estimated_run_time_mins: None,
            health_status: "Não Aplicável (Desktop)".to_string(),
        });
    }

    let wear_level_percent = match (design_capacity_mwh, full_charge_capacity_mwh) {
        (Some(design), Some(full)) if design > 0 => {
            if full >= design {
                Some(0.0)
            } else {
                let wear = ((design - full) as f32 / (design as f32)) * 100.0;
                Some((wear * 10.0).round() / 10.0)
            }
        }
        _ => None,
    };

    let health_status = match wear_level_percent {
        Some(wear) if wear >= 40.0 => {
            format!("Crítica (Desgaste Severo: {:.1}% - Substituir Bateria)", wear)
        }
        Some(wear) if wear >= 25.0 => {
            format!("Atenção (Desgaste Moderado: {:.1}%)", wear)
        }
        Some(wear) => format!("Saudável (Desgaste de apenas {:.1}%)", wear),
        None => "Operacional (Capacidade Nominal via ACPI)".to_string(),
    };

    Ok(BatteryReport {
        is_present: true,
        battery_name,
        ac_online,
        is_charging: is_charging_win32,
        charge_percent,
        design_capacity_mwh,
        full_charge_capacity_mwh,
        wear_level_percent,
        cycle_count,
        estimated_run_time_mins: est_mins,
        health_status,
    })
}

fn variant_u32(v: Option<&Variant>) -> Option<u32> {
    match v {
        Some(Variant::UI1(n)) => Some(*n as u32),
        Some(Variant::UI2(n)) => Some(*n as u32),
        Some(Variant::UI4(n)) => Some(*n),
        Some(Variant::UI8(n)) => Some(*n as u32),
        Some(Variant::I2(n)) if *n >= 0 => Some(*n as u32),
        Some(Variant::I4(n)) if *n >= 0 => Some(*n as u32),
        Some(Variant::I8(n)) if *n >= 0 => Some(*n as u32),
        _ => None,
    }
}

