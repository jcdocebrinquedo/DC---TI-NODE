use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use windows::core::PCWSTR;
use windows::Win32::System::EventLog::{
    EvtClose, EvtNext, EvtQuery, EvtQueryChannelPath, EvtQueryReverseDirection, EvtRender,
    EvtRenderEventXml, EVT_HANDLE,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutdownEventItem {
    pub event_id: u32,
    pub category: String,
    pub provider: String,
    pub timestamp_local: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutdownAnalysisReport {
    pub normal_shutdowns_count: u32,
    pub forced_shutdowns_count: u32,
    pub bsod_count: u32,
    pub total_events_inspected: u32,
    pub recent_critical_events: Vec<ShutdownEventItem>,
    pub stability_verdict: String,
}

/// Analisa o canal 'System' do Windows Event Viewer via API nativa Win32 (EvtQuery / EvtRender)
/// contabilizando desligamentos normais (6006/1074), forçados/quedas de energia (41/6008) e BSODs (1001).
pub fn analyze_shutdown_events(max_events_to_scan: usize) -> Result<ShutdownAnalysisReport, String> {
    let channel: Vec<u16> = "System\0".encode_utf16().collect();
    let xpath_query: Vec<u16> =
        "*[System[(EventID=6006 or EventID=1074 or EventID=41 or EventID=6008 or EventID=1001)]]\0"
            .encode_utf16()
            .collect();

    let flags = EvtQueryChannelPath.0 | EvtQueryReverseDirection.0;

    let query_handle = unsafe {
        EvtQuery(
            EVT_HANDLE::default(),
            PCWSTR::from_raw(channel.as_ptr()),
            PCWSTR::from_raw(xpath_query.as_ptr()),
            flags,
        )
    }
    .map_err(|e| format!("Falha ao consultar Event Log 'System' via Win32 EvtQuery: {}", e))?;

    let mut normal_shutdowns_count = 0u32;
    let mut forced_shutdowns_count = 0u32;
    let mut bsod_count = 0u32;
    let mut total_events_inspected = 0u32;
    let mut recent_critical_events = Vec::new();

    let mut raw_handles = [0isize; 32];
    let mut returned = 0u32;

    while (total_events_inspected as usize) < max_events_to_scan {
        let next_res = unsafe {
            EvtNext(
                query_handle,
                &mut raw_handles,
                1500,
                0,
                &mut returned,
            )
        };

        if next_res.is_err() || returned == 0 {
            break;
        }

        for i in 0..(returned as usize) {
            let evt_handle = EVT_HANDLE(raw_handles[i]);
            if let Some(xml) = render_event_xml(evt_handle) {
                total_events_inspected += 1;
                if let Some(event_id) = extract_xml_tag_u32(&xml, "EventID") {
                    let provider = extract_provider_name(&xml);
                    let time_local = extract_local_timestamp(&xml);

                    match event_id {
                        6006 | 1074 => {
                            normal_shutdowns_count += 1;
                        }
                        41 | 6008 => {
                            forced_shutdowns_count += 1;
                            if recent_critical_events.len() < 15 {
                                let summary = if event_id == 41 {
                                    "Kernel-Power (41): Reinicialização sem desligamento limpo (Botão Power / Queda de Energia)".to_string()
                                } else {
                                    "EventLog (6008): O desligamento anterior do sistema foi inesperado".to_string()
                                };
                                recent_critical_events.push(ShutdownEventItem {
                                    event_id,
                                    category: "Desligamento Forçado / Inesperado".to_string(),
                                    provider,
                                    timestamp_local: time_local,
                                    summary,
                                });
                            }
                        }
                        1001 => {
                            // Filtra eventos 1001 que são efetivamente BugCheck / BlueScreen (WER-SystemErrorReporting ou BugCheck)
                            let is_bugcheck = provider.to_uppercase().contains("WER")
                                || provider.to_uppercase().contains("BUGCHECK")
                                || xml.contains("BugCheck")
                                || xml.contains("0x000");
                            if is_bugcheck {
                                bsod_count += 1;
                                if recent_critical_events.len() < 15 {
                                    recent_critical_events.push(ShutdownEventItem {
                                        event_id: 1001,
                                        category: "Tela Azul da Morte (BSOD / BugCheck)".to_string(),
                                        provider,
                                        timestamp_local: time_local,
                                        summary: "BugCheck 1001: O computador foi reiniciado após uma verificação de erro crítica (BSOD)".to_string(),
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            unsafe {
                let _ = EvtClose(evt_handle);
            }
        }
    }

    unsafe {
        let _ = EvtClose(query_handle);
    }

    let stability_verdict = if bsod_count > 0 {
        format!(
            "CRÍTICO: Foram detectadas {} ocorrências de Tela Azul (BSOD) e {} desligamentos forçados.",
            bsod_count, forced_shutdowns_count
        )
    } else if forced_shutdowns_count >= 5 {
        format!(
            "ATENÇÃO: Alto índice de desligamentos forçados/quedas bruscas ({} ocorrências).",
            forced_shutdowns_count
        )
    } else if forced_shutdowns_count > 0 {
        format!(
            "ESTÁVEL COM RESSALVAS: {} desligamento(s) inesperado(s) e {} normal(is).",
            forced_shutdowns_count, normal_shutdowns_count
        )
    } else {
        format!(
            "EXCELENTE: Nenhum BSOD ou desligamento forçado detectado ({} desligamentos limpos).",
            normal_shutdowns_count
        )
    };

    Ok(ShutdownAnalysisReport {
        normal_shutdowns_count,
        forced_shutdowns_count,
        bsod_count,
        total_events_inspected,
        recent_critical_events,
        stability_verdict,
    })
}

fn render_event_xml(event_handle: EVT_HANDLE) -> Option<String> {
    let mut buffer_used = 0u32;
    let mut property_count = 0u32;

    unsafe {
        let _ = EvtRender(
            EVT_HANDLE::default(),
            event_handle,
            EvtRenderEventXml.0,
            0,
            None,
            &mut buffer_used,
            &mut property_count,
        );
    }

    if buffer_used == 0 {
        return None;
    }

    let u16_len = ((buffer_used as usize) / 2) + 2;
    let mut buffer = vec![0u16; u16_len];

    let ok = unsafe {
        EvtRender(
            EVT_HANDLE::default(),
            event_handle,
            EvtRenderEventXml.0,
            buffer_used,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut buffer_used,
            &mut property_count,
        )
        .is_ok()
    };

    if !ok {
        return None;
    }

    let nul_pos = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..nul_pos]))
}

fn extract_xml_tag_u32(xml: &str, tag: &str) -> Option<u32> {
    let open_pattern = format!("<{}", tag);
    let close_pattern = format!("</{}>", tag);
    let start_idx = xml.find(&open_pattern)?;
    let after_open = &xml[start_idx..];
    let gt_idx = after_open.find('>')?;
    let content_start = &after_open[gt_idx + 1..];
    let end_idx = content_start.find(&close_pattern)?;
    content_start[..end_idx].trim().parse::<u32>().ok()
}

fn extract_provider_name(xml: &str) -> String {
    if let Some(pos) = xml.find("<Provider Name=") {
        let sub = &xml[pos + 15..];
        let quote_char = sub.chars().next().unwrap_or('\'');
        if quote_char == '\'' || quote_char == '"' {
            let rest = &sub[1..];
            if let Some(end_q) = rest.find(quote_char) {
                return rest[..end_q].to_string();
            }
        }
    }
    "Sistema Windows".to_string()
}

fn extract_local_timestamp(xml: &str) -> String {
    if let Some(pos) = xml.find("SystemTime=") {
        let sub = &xml[pos + 11..];
        let quote_char = sub.chars().next().unwrap_or('\'');
        if quote_char == '\'' || quote_char == '"' {
            let rest = &sub[1..];
            if let Some(end_q) = rest.find(quote_char) {
                let raw_ts = &rest[..end_q];
                if let Ok(parsed) = DateTime::parse_from_rfc3339(raw_ts) {
                    let local_dt = parsed.with_timezone(&Local);
                    return local_dt.format("%d/%m/%Y %H:%M:%S").to_string();
                }
                return raw_ts.to_string();
            }
        }
    }
    Local::now().format("%d/%m/%Y %H:%M:%S").to_string()
}

