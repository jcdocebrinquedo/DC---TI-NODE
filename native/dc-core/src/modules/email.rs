use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EmailAccountType {
    Imap,
    Pop3,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorporateEmailConfig {
    pub display_name: String,
    pub email_address: String,
    pub domain: String,
    pub account_type: EmailAccountType,
    pub incoming_server: String,
    pub incoming_port: u32,
    pub incoming_use_ssl: bool,
    pub outgoing_server: String,
    pub outgoing_port: u32,
    pub outgoing_use_ssl: bool,
    pub outgoing_require_auth: bool,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub use_existing_pst: Option<bool>,
    #[serde(default)]
    pub existing_pst_path: Option<String>,
}

impl CorporateEmailConfig {
    pub fn from_defaults(
        display_name: &str,
        email_address: &str,
        domain: &str,
        account_type: EmailAccountType,
    ) -> Self {
        let clean_domain = domain.trim().trim_start_matches('@').to_lowercase();
        match account_type {
            EmailAccountType::Imap => Self {
                display_name: display_name.trim().to_string(),
                email_address: email_address.trim().to_lowercase(),
                incoming_server: format!("imap.{}", clean_domain),
                incoming_port: 993,
                incoming_use_ssl: true,
                outgoing_server: format!("smtp.{}", clean_domain),
                outgoing_port: 587,
                outgoing_use_ssl: true,
                outgoing_require_auth: true,
                domain: clean_domain,
                account_type: EmailAccountType::Imap,
            },
            EmailAccountType::Pop3 => Self {
                display_name: display_name.trim().to_string(),
                email_address: email_address.trim().to_lowercase(),
                incoming_server: format!("pop.{}", clean_domain),
                incoming_port: 995,
                incoming_use_ssl: true,
                outgoing_server: format!("smtp.{}", clean_domain),
                outgoing_port: 587,
                outgoing_use_ssl: true,
                outgoing_require_auth: true,
                domain: clean_domain,
                account_type: EmailAccountType::Pop3,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlookProfileDetection {
    pub office_version: String,
    pub default_profile: String,
    pub profile_registry_path: String,
    pub existed_previously: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlookConfigResult {
    pub office_version: String,
    pub profile_name: String,
    pub account_index_hex: String,
    pub account_registry_path: String,
    pub data_store_path: String,
    pub autodiscover_xml_path: String,
    pub incoming_endpoint: String,
    pub outgoing_endpoint: String,
    pub configured_at_local: String,
}

pub fn detect_outlook_profile() -> OutlookProfileDetection {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let candidate_versions = ["16.0", "15.0", "14.0"];

    for ver in candidate_versions {
        let base_path = format!(r"Software\Microsoft\Office\{}\Outlook", ver);
        if let Ok(outlook_key) = hkcu.open_subkey_with_flags(&base_path, KEY_READ) {
            let default_profile = outlook_key
                .get_value::<String, _>("DefaultProfile")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "Outlook".to_string());

            let profile_registry_path = format!(r"{}\Profiles\{}", base_path, default_profile);
            let existed = hkcu
                .open_subkey_with_flags(&profile_registry_path, KEY_READ)
                .is_ok();

            return OutlookProfileDetection {
                office_version: ver.to_string(),
                default_profile,
                profile_registry_path,
                existed_previously: existed,
            };
        }
    }

    OutlookProfileDetection {
        office_version: "16.0".to_string(),
        default_profile: "Outlook".to_string(),
        profile_registry_path: r"Software\Microsoft\Office\16.0\Outlook\Profiles\Outlook".to_string(),
        existed_previously: false,
    }
}

/// Encontra o próximo ID livre na árvore de Contas do Outlook (9375CFF0413111d3B88A00104B2A6676)
/// garantindo que NUNCA sobreponha as contas já configuradas (00000001, 00000002, etc.).
fn find_next_free_account_slot(profile_key: &RegKey) -> (u32, String) {
    let accounts_root_path = "9375CFF0413111d3B88A00104B2A6676";
    let accounts_key = match profile_key.open_subkey_with_flags(accounts_root_path, KEY_READ | KEY_SET_VALUE) {
        Ok(k) => k,
        Err(_) => {
            let (_k, _) = profile_key.create_subkey(accounts_root_path).unwrap();
            return (2, "00000002".to_string());
        }
    };

    let next_id_from_reg = accounts_key.get_value::<u32, _>("NextAccountID").unwrap_or(2);
    let mut candidate = next_id_from_reg.max(2);

    loop {
        let sub_name = format!("{:08x}", candidate);
        if accounts_key.open_subkey_with_flags(&sub_name, KEY_READ).is_err() {
            // Atualiza NextAccountID no Registro para reservar este slot
            let _ = accounts_key.set_value("NextAccountID", &(candidate + 1));
            return (candidate, sub_name);
        }
        candidate += 1;
    }
}

/// Registra a nova conta na lista de ordem de contas `{ED475420-B0D6-11D2-8C3B-00104B2A6676}`
fn append_account_to_order_list(accounts_key: &RegKey, account_id: u32) {
    let order_val_name = "{ED475420-B0D6-11D2-8C3B-00104B2A6676}";
    let mut order_bytes: Vec<u8> = accounts_key.get_raw_value(order_val_name).map(|v| v.bytes).unwrap_or_default();

    let id_bytes = account_id.to_le_bytes();
    // Verifica se já não existe na lista
    let mut exists = false;
    for chunk in order_bytes.chunks_exact(4) {
        if chunk == id_bytes {
            exists = true;
            break;
        }
    }

    if !exists {
        order_bytes.extend_from_slice(&id_bytes);
        let _ = accounts_key.set_raw_value(
            order_val_name,
            &winreg::RegValue {
                bytes: order_bytes,
                vtype: winreg::enums::REG_BINARY,
            },
        );
    }
}

/// Cria o arquivo de dados local (.pst ou .ost) dedicado na pasta do usuário para a nova conta.
fn setup_local_data_file(email_address: &str, is_imap: bool) -> Result<String, String> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| r"C:\Users\Public".to_string());
    let docs_dir = PathBuf::from(&user_profile).join("Documents").join("Arquivos do Outlook");
    let _ = fs::create_dir_all(&docs_dir);

    let ext = if is_imap { "ost" } else { "pst" };
    let sanitized_email: String = email_address
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();

    let data_file = docs_dir.join(format!("{}.{}", sanitized_email, ext));
    Ok(data_file.to_string_lossy().to_string())
}

/// Adiciona uma nova conta corporativa (POP3 ou IMAP) preservando intactas todas as contas existentes.
pub fn configure_outlook_corporate_email(
    config: &CorporateEmailConfig,
) -> Result<OutlookConfigResult, String> {
    if config.email_address.trim().is_empty() || !config.email_address.contains('@') {
        return Err("Endereço de e-mail corporativo inválido.".to_string());
    }
    if config.incoming_server.trim().is_empty() || config.outgoing_server.trim().is_empty() {
        return Err("Os servidores de entrada e saída não podem ser vazios.".to_string());
    }

    let detection = detect_outlook_profile();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let (profile_key, _) = hkcu
        .create_subkey(&detection.profile_registry_path)
        .map_err(|e| format!("Falha ao acessar perfil '{}': {}", detection.profile_registry_path, e))?;

    // 1. Encontra slot exclusivo para a nova conta (evita sobrescrever conta 00000001, 00000002, etc.)
    let (account_num, slot_hex) = find_next_free_account_slot(&profile_key);
    let accounts_root = profile_key
        .open_subkey_with_flags("9375CFF0413111d3B88A00104B2A6676", KEY_SET_VALUE | KEY_READ)
        .unwrap();

    let account_sub_path = format!("9375CFF0413111d3B88A00104B2A6676\\{}", slot_hex);
    let (acct_key, _) = profile_key
        .create_subkey(&account_sub_path)
        .map_err(|e| format!("Falha ao criar subchave da conta: {}", e))?;

    // Adiciona o novo ID à lista de ordem de contas
    append_account_to_order_list(&accounts_root, account_num);

    // 2. Prepara arquivo de dados exclusivo (.ost para IMAP ou .pst para POP3)
    let is_imap = config.account_type == EmailAccountType::Imap;
    let data_file_path = if let (Some(true), Some(ref path)) = (config.use_existing_pst, &config.existing_pst_path) {
        if !path.trim().is_empty() {
            path.trim().to_string()
        } else {
            setup_local_data_file(&config.email_address, is_imap)?
        }
    } else {
        setup_local_data_file(&config.email_address, is_imap)?
    };

    // 3. Grava propriedades da conta de acordo com o protocolo selecionado
    if is_imap {
        // IMAP Account
        let _ = acct_key.set_value("clsid", &"{ED475412-B0D6-11D2-8C3B-00104B2A6676}");
        let _ = acct_key.set_value("Service Name", &"IMAP/SMTP");
        let _ = acct_key.set_value("Account Name", &config.email_address);
        let _ = acct_key.set_value("Display Name", &config.display_name);
        let _ = acct_key.set_value("Email", &config.email_address);
        let _ = acct_key.set_value("IMAP Server", &config.incoming_server);
        let _ = acct_key.set_value("IMAP Port", &config.incoming_port);
        let _ = acct_key.set_value("IMAP Use SSL", &(if config.incoming_use_ssl { 1u32 } else { 0u32 }));
        let _ = acct_key.set_value("IMAP User", &config.email_address);
    } else {
        // POP3 Account
        let _ = acct_key.set_value("clsid", &"{ED475411-B0D6-11D2-8C3B-00104B2A6676}");
        let _ = acct_key.set_value("Service Name", &"POP3/SMTP");
        let _ = acct_key.set_value("Account Name", &config.email_address);
        let _ = acct_key.set_value("Display Name", &config.display_name);
        let _ = acct_key.set_value("Email", &config.email_address);
        let _ = acct_key.set_value("POP3 Server", &config.incoming_server);
        let _ = acct_key.set_value("POP3 Port", &config.incoming_port);
        let _ = acct_key.set_value("POP3 Use SSL", &(if config.incoming_use_ssl { 1u32 } else { 0u32 }));
        let _ = acct_key.set_value("POP3 User", &config.email_address);
        let _ = acct_key.set_value("Leave on Server", &0x000E0003u32); // Manter cópia no servidor por 14 dias
    }

    // SMTP Comum
    let _ = acct_key.set_value("SMTP Server", &config.outgoing_server);
    let _ = acct_key.set_value("SMTP Port", &config.outgoing_port);
    let _ = acct_key.set_value("SMTP Use SSL", &(if config.outgoing_use_ssl { 1u32 } else { 0u32 }));
    let _ = acct_key.set_value(
        "SMTP Secure Connection",
        &(if config.outgoing_use_ssl { 2u32 } else { 0u32 }), // 2 = SSL/TLS, 1 = STARTTLS
    );
    let _ = acct_key.set_value(
        "SMTP Use Auth",
        &(if config.outgoing_require_auth { 1u32 } else { 0u32 }),
    );
    let _ = acct_key.set_value("SMTP User", &config.email_address);

    // 4. Cria XML de Autodiscover para o domínio
    let autodiscover_xml_path = write_local_autodiscover_xml(config)?;

    // 5. Configura políticas no AutoDiscover para preferir XML local
    let outlook_base_path = format!(r"Software\Microsoft\Office\{}\Outlook", detection.office_version);
    if let Ok((autodiscover_key, _)) = hkcu.create_subkey(format!(r"{}\AutoDiscover", outlook_base_path)) {
        let _ = autodiscover_key.set_value(&config.domain, &autodiscover_xml_path);
        let _ = autodiscover_key.set_value("PreferLocalXml", &1u32);
        let _ = autodiscover_key.set_value("ExcludeExplicitO365Endpoint", &1u32);
    }

    Ok(OutlookConfigResult {
        office_version: detection.office_version,
        profile_name: detection.default_profile,
        account_index_hex: slot_hex.clone(),
        account_registry_path: format!(r"HKCU\{}\{}", detection.profile_registry_path, account_sub_path),
        data_store_path: data_file_path,
        autodiscover_xml_path,
        incoming_endpoint: format!(
            "{} {}:{} (SSL={})",
            if is_imap { "IMAP" } else { "POP3" },
            config.incoming_server,
            config.incoming_port,
            config.incoming_use_ssl
        ),
        outgoing_endpoint: format!(
            "SMTP {}:{} (SSL/TLS={})",
            config.outgoing_server, config.outgoing_port, config.outgoing_use_ssl
        ),
        configured_at_local: Local::now().format("%d/%m/%Y %H:%M:%S").to_string(),
    })
}

fn write_local_autodiscover_xml(config: &CorporateEmailConfig) -> Result<String, String> {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| r"C:\Users\Public".to_string());
    let target_dir = PathBuf::from(appdata).join("Microsoft").join("Outlook");
    let _ = fs::create_dir_all(&target_dir);

    let safe_domain: String = config
        .domain
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect();

    let xml_file_path = target_dir.join(format!("autodiscover-{}.xml", safe_domain));
    let in_ssl_str = if config.incoming_use_ssl { "on" } else { "off" };
    let out_ssl_str = if config.outgoing_use_ssl { "on" } else { "off" };
    let proto_type = match config.account_type {
        EmailAccountType::Imap => "IMAP",
        EmailAccountType::Pop3 => "POP3",
    };

    let xml_content = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <User>
      <DisplayName>{}</DisplayName>
    </User>
    <Account>
      <AccountType>email</AccountType>
      <Action>settings</Action>
      <Protocol>
        <Type>{}</Type>
        <Server>{}</Server>
        <Port>{}</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>{}</LoginName>
        <SPA>off</SPA>
        <SSL>{}</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>{}</Server>
        <Port>{}</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>{}</LoginName>
        <SPA>off</SPA>
        <SSL>{}</SSL>
        <AuthRequired>on</AuthRequired>
        <UsePOPAuth>on</UsePOPAuth>
        <SMTPLast>off</SMTPLast>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>
"#,
        escape_xml(&config.display_name),
        proto_type,
        escape_xml(&config.incoming_server),
        config.incoming_port,
        escape_xml(&config.email_address),
        in_ssl_str,
        escape_xml(&config.outgoing_server),
        config.outgoing_port,
        escape_xml(&config.email_address),
        out_ssl_str,
    );

    fs::write(&xml_file_path, xml_content.as_bytes())
        .map_err(|e| format!("Falha ao gravar arquivo XML de Autodiscover local: {}", e))?;

    Ok(xml_file_path.to_string_lossy().to_string())
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
