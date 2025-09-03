#![cfg(any(target_os = "macos", target_os = "linux"))]

use crate::error::AppResult;
use parking_lot::RwLock;
use std::{collections::HashMap, sync::LazyLock};

#[cfg(any(target_os = "macos", target_os = "linux"))]
static GRANTED_PERMISSIONS: LazyLock<RwLock<HashMap<String, Option<bool>>>> = LazyLock::new(|| {
    RwLock::new(HashMap::from_iter([
        (String::from("verge-mihomo"), None),
        (String::from("verge-mihomo-alpha"), None),
    ]))
});

/// 给clash内核的tun模式授权
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn grant_permissions(core: String) -> AppResult<()> {
    use crate::utils::dirs;
    use std::process::Command;
    use tauri::utils::platform::current_exe;

    let path = current_exe()?.with_file_name(&core);
    let path = dirs::path_to_str(&path)?;

    tracing::debug!("grant permissions, core path: {path}");

    #[cfg(target_os = "macos")]
    let output = {
        let path = path.replace(' ', "\\\\ ");
        let shell = format!("chown root:admin {path}\nchmod +sx {path}");
        let command = format!(r#"do shell script "{shell}" with administrator privileges"#);
        Command::new("osascript").args(vec!["-e", &command]).output()?
    };

    #[cfg(target_os = "linux")]
    let output = {
        use crate::utils::unix_helper;

        let path = path.replace(' ', "\\ "); // 避免路径中有空格
        let shell = format!("setcap cap_net_bind_service,cap_net_admin,cap_dac_override=+ep {path}");
        let sudo = unix_helper::linux_elevator();

        Command::new(sudo).arg("sh").arg("-c").arg(shell).output()?
    };

    if output.status.success() {
        GRANTED_PERMISSIONS.write().entry(core).and_modify(|i| *i = Some(true));
        Ok(())
    } else {
        use crate::{any_err, error::AppError};

        let stderr = std::str::from_utf8(&output.stderr).unwrap_or_default();
        Err(any_err!("{stderr}"))
    }
}

#[cfg(target_os = "linux")]
pub fn check_permissions_granted(core: String) -> AppResult<bool> {
    if let Some(Some(granted)) = GRANTED_PERMISSIONS.read().get(&core) {
        tracing::debug!("check permissions granted by cache, core: {core}");
        return Ok(*granted);
    }

    use crate::utils::dirs;
    use std::process::Command;
    use tauri::utils::platform::current_exe;

    let path = current_exe()?.with_file_name(&core);
    let path = dirs::path_to_str(&path)?;

    tracing::debug!("check permissions granted, core path: {path}");

    let output = {
        let path = path.replace(' ', "\\ "); // 避免路径中有空格
        Command::new("getcap").arg(path).output()?
    };

    if output.status.success() {
        let caps: String = String::from_utf8(output.stdout).unwrap_or_default();
        if caps.contains("cap_net_bind_service") && caps.contains("cap_net_admin") && caps.contains("cap_dac_override")
        {
            tracing::debug!("permissions granted, core: {core}");
            GRANTED_PERMISSIONS.write().entry(core).and_modify(|i| *i = Some(true));
            Ok(true)
        } else {
            tracing::debug!("permissions not granted, core: {core}");
            GRANTED_PERMISSIONS.write().entry(core).and_modify(|i| *i = Some(false));
            Ok(false)
        }
    } else {
        use crate::{any_err, error::AppError};

        let stderr = std::str::from_utf8(&output.stderr).unwrap_or_default();
        Err(any_err!("{stderr}"))
    }
}

#[cfg(target_os = "linux")]
pub fn refresh_permissions_granted() -> AppResult<()> {
    tracing::debug!("refresh permissions granted");
    GRANTED_PERMISSIONS.write().iter_mut().for_each(|(_, v)| *v = None);
    let mihomo_cores = ["verge-mihomo", "verge-mihomo-alpha"];
    for core in mihomo_cores {
        check_permissions_granted(core.to_string())?;
    }
    Ok(())
}
