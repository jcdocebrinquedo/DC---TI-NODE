use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::NetworkManagement::NetManagement::{
    NetApiBufferFree, NetUserEnum, NetUserSetInfo, NET_USER_ENUM_FILTER_FLAGS, USER_INFO_0, USER_INFO_10,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalUserInfo {
    pub username: String,
    pub full_name: String,
    pub comment: String,
    pub is_current_user: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRenameResult {
    pub previous_name: String,
    pub new_name: String,
    pub full_name_updated: bool,
    pub username_updated: bool,
}

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

fn wide_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0;
    unsafe {
        while *ptr.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }
}

/// Lista todas as contas de usuário locais da máquina
pub fn list_local_users() -> Vec<LocalUserInfo> {
    let mut users = Vec::new();
    let current_user = std::env::var("USERNAME").unwrap_or_default();

    unsafe {
        let mut buf_ptr: *mut u8 = std::ptr::null_mut();
        let mut entries_read = 0u32;
        let mut total_entries = 0u32;
        let mut resume_handle = 0u32;

        let status = NetUserEnum(
            PCWSTR::null(),
            10,
            NET_USER_ENUM_FILTER_FLAGS(2), // FILTER_NORMAL_ACCOUNT
            &mut buf_ptr,
            u32::MAX,
            &mut entries_read,
            &mut total_entries,
            Some(&mut resume_handle),
        );

        if status == 0 && !buf_ptr.is_null() {
            let slice = std::slice::from_raw_parts(buf_ptr as *const USER_INFO_10, entries_read as usize);
            for u in slice {
                let name = wide_to_string(u.usri10_name.0);
                let full = wide_to_string(u.usri10_full_name.0);
                let comm = wide_to_string(u.usri10_comment.0);
                let is_cur = name.eq_ignore_ascii_case(&current_user);

                users.push(LocalUserInfo {
                    username: name,
                    full_name: full,
                    comment: comm,
                    is_current_user: is_cur,
                });
            }
            let _ = NetApiBufferFree(Some(buf_ptr as *const _));
        }
    }

    if users.is_empty() {
        users.push(LocalUserInfo {
            username: current_user.clone(),
            full_name: current_user.clone(),
            comment: "Usuário Atual".to_string(),
            is_current_user: true,
        });
    }

    users
}

/// Altera o Nome de Logon (Username) ou Nome de Exibição (Full Name) de um usuário local do Windows.
pub fn update_user_account(
    target_username: &str,
    new_username: Option<&str>,
    new_full_name: Option<&str>,
) -> Result<UserRenameResult, String> {
    let target_user_clean = target_username.trim();
    if target_user_clean.is_empty() {
        return Err("O usuário alvo não pode ser vazio.".to_string());
    }

    let mut result = UserRenameResult {
        previous_name: target_user_clean.to_string(),
        new_name: target_user_clean.to_string(),
        full_name_updated: false,
        username_updated: false,
    };

    // 1. Atualiza Nome de Exibição (Full Name) se fornecido
    if let Some(fn_val) = new_full_name {
        let trimmed_fn = fn_val.trim();
        if !trimmed_fn.is_empty() {
            let _server_wide: Option<&[u16]> = None;
            let target_wide = to_wide(target_user_clean);
            let mut fn_wide = to_wide(trimmed_fn);

            #[repr(C)]
            struct USER_INFO_1011_RAW {
                pub full_name: *mut u16,
            }

            let mut info1011 = USER_INFO_1011_RAW {
                full_name: fn_wide.as_mut_ptr(),
            };
            let mut parm_err = 0u32;

            let status = unsafe {
                NetUserSetInfo(
                    PCWSTR::null(),
                    windows::core::PCWSTR(target_wide.as_ptr()),
                    1011,
                    &mut info1011 as *mut _ as *const u8,
                    Some(&mut parm_err),
                )
            };

            if status != 0 {
                return Err(format!(
                    "Falha ao atualizar Nome Completo (Código NetApi: {} / WIN32: {}). Requer privilégios de Administrador.",
                    status, status
                ));
            }
            result.full_name_updated = true;
        }
    }

    // 2. Atualiza Nome de Logon (Username) se fornecido e diferente do atual
    if let Some(nu_val) = new_username {
        let trimmed_nu = nu_val.trim();
        if !trimmed_nu.is_empty() && !trimmed_nu.eq_ignore_ascii_case(target_user_clean) {
            // Validações básicas de username Windows
            if trimmed_nu.len() > 20 {
                return Err("O nome de usuário não pode exceder 20 caracteres.".to_string());
            }
            if trimmed_nu.contains('/')
                || trimmed_nu.contains('\\')
                || trimmed_nu.contains('[')
                || trimmed_nu.contains(']')
                || trimmed_nu.contains(':')
                || trimmed_nu.contains(';')
                || trimmed_nu.contains('|')
                || trimmed_nu.contains('<')
                || trimmed_nu.contains('>')
                || trimmed_nu.contains('+')
                || trimmed_nu.contains('=')
                || trimmed_nu.contains(',')
                || trimmed_nu.contains('?')
                || trimmed_nu.contains('*')
                || trimmed_nu.contains('@')
            {
                return Err("O nome de usuário contém caracteres inválidos (/ \\ [ ] : ; | < > + = , ? * @).".to_string());
            }

            let _server_wide: Option<&[u16]> = None;
            let current_target = if result.username_updated {
                to_wide(&result.new_name)
            } else {
                to_wide(target_user_clean)
            };
            let mut new_wide = to_wide(trimmed_nu);

            let mut info0 = USER_INFO_0 {
                usri0_name: PWSTR(new_wide.as_mut_ptr()),
            };
            let mut parm_err = 0u32;

            let status = unsafe {
                NetUserSetInfo(
                    PCWSTR::null(),
                    windows::core::PCWSTR(current_target.as_ptr()),
                    0,
                    &mut info0 as *mut _ as *const u8,
                    Some(&mut parm_err),
                )
            };

            if status != 0 {
                return Err(format!(
                    "Falha ao renomear conta de usuário (Código NetApi: {}). Verifique se o nome já existe ou se o processo está elevado como Administrador.",
                    status
                ));
            }

            result.new_name = trimmed_nu.to_string();
            result.username_updated = true;
        }
    }

    Ok(result)
}

