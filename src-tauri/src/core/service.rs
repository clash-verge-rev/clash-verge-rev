use crate::config::{Config, IVerge};
use crate::core::handle;
use crate::utils::dirs;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use std::{env::current_exe, process::Command as StdCommand};
use tokio::time::sleep;

// Windows only

const SERVICE_URL: &str = "http://127.0.0.1:33211";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ResponseBody {
    pub core_type: Option<String>,
    pub bin_path: String,
    pub config_dir: String,
    pub log_file: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct JsonResponse {
    pub code: u64,
    pub msg: String,
    pub data: Option<ResponseBody>,
}

#[cfg(not(target_os = "windows"))]
pub fn sudo(passwd: &String, cmd: String) -> StdCommand {
    let shell = format!("echo \"{}\" | sudo -S {}", passwd, cmd);
    let mut command = StdCommand::new("bash");
    command.arg("-c").arg(shell);
    command
}

/// Install the Clash Verge Service
/// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
///
#[cfg(target_os = "windows")]
pub async fn install_service(_passwd: String) -> Result<()> {
    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service.exe");

    if !install_path.exists() {
        bail!("installer exe not found");
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;

    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(install_path).show(false).status()?,
        _ => StdCommand::new(install_path)
            .creation_flags(0x08000000)
            .status()?,
    };

    if !status.success() {
        bail!(
            "failed to install service with status {}",
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub async fn install_service(passwd: String) -> Result<()> {
    use users::get_effective_uid;

    let binary_path = dirs::service_path()?;
    let installer_path = binary_path.with_file_name("install-service");
    if !installer_path.exists() {
        bail!("installer not found");
    }

    let output = match get_effective_uid() {
        0 => {
            StdCommand::new("chmod")
                .arg("+x")
                .arg(installer_path.clone())
                .output()?;
            StdCommand::new("chmod")
                .arg("+x")
                .arg(binary_path)
                .output()?;
            StdCommand::new(installer_path.clone()).output()?
        }
        _ => {
            sudo(
                &passwd,
                format!("chmod +x {}", installer_path.to_string_lossy()),
            )
            .output()?;
            sudo(
                &passwd,
                format!("chmod +x {}", binary_path.to_string_lossy()),
            )
            .output()?;
            sudo(&passwd, format!("{}", installer_path.to_string_lossy())).output()?
        }
    };
    if !output.status.success() {
        bail!(
            "failed to install service with error: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn install_service(passwd: String) -> Result<()> {
    let binary_path = dirs::service_path()?;
    let installer_path = binary_path.with_file_name("install-service");

    if !installer_path.exists() {
        bail!("installer not found");
    }

    sudo(
        &passwd,
        format!(
            "chmod +x {}",
            installer_path.to_string_lossy().replace(" ", "\\ ")
        ),
    )
    .output()?;
    let output = sudo(
        &passwd,
        format!("{}", installer_path.to_string_lossy().replace(" ", "\\ ")),
    )
    .output()?;

    if !output.status.success() {
        bail!(
            "failed to install service with error: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(())
}
/// Uninstall the Clash Verge Service
/// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
#[cfg(target_os = "windows")]
pub async fn uninstall_service(_passwd: String) -> Result<()> {
    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("uninstall-service.exe");

    if !uninstall_path.exists() {
        bail!("uninstaller exe not found");
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;

    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path).show(false).status()?,
        _ => StdCommand::new(uninstall_path)
            .creation_flags(0x08000000)
            .status()?,
    };

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub async fn uninstall_service(passwd: String) -> Result<()> {
    use users::get_effective_uid;

    let binary_path = dirs::service_path()?;
    let uninstaller_path = binary_path.with_file_name("uninstall-service");

    if !uninstaller_path.exists() {
        bail!("uninstaller not found");
    }

    let output = match get_effective_uid() {
        0 => {
            StdCommand::new("chmod")
                .arg("+x")
                .arg(uninstaller_path.clone())
                .output()?;
            StdCommand::new(uninstaller_path.clone()).output()?
        }
        _ => {
            sudo(
                &passwd,
                format!("chmod +x {}", uninstaller_path.to_string_lossy()),
            )
            .output()?;

            sudo(&passwd, format!("{}", uninstaller_path.to_string_lossy())).output()?
        }
    };

    if !output.status.success() {
        bail!(
            "failed to install service with error: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn uninstall_service(passwd: String) -> Result<()> {
    let binary_path = dirs::service_path()?;
    let uninstaller_path = binary_path.with_file_name("uninstall-service");

    if !uninstaller_path.exists() {
        bail!("uninstaller not found");
    }

    sudo(
        &passwd,
        format!(
            "chmod +x {}",
            uninstaller_path.to_string_lossy().replace(" ", "\\ ")
        ),
    )
    .output()?;
    let output = sudo(
        &passwd,
        format!("{}", uninstaller_path.to_string_lossy().replace(" ", "\\ ")),
    )
    .output()?;

    if !output.status.success() {
        bail!(
            "failed to uninstall service with error: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(())
}

/// check the windows service status
pub async fn check_service() -> Result<JsonResponse> {
    let url = format!("{SERVICE_URL}/get_clash");
    let response = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .get(url)
        .send()
        .await
        .context("failed to connect to the Clash Verge Service")?
        .json::<JsonResponse>()
        .await
        .context("failed to parse the Clash Verge Service response")?;

    Ok(response)
}

/// start the clash by service
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    let status = check_service().await?;

    if status.code == 0 {
        stop_core_by_service().await?;
        sleep(Duration::from_secs(1)).await;
    }

    let clash_core = { Config::verge().latest().clash_core.clone() };
    let mut clash_core = clash_core.unwrap_or("verge-mihomo".into());

    // compatibility
    if clash_core.contains("clash") {
        clash_core = "verge-mihomo".to_string();
        Config::verge().draft().patch_config(IVerge {
            clash_core: Some("verge-mihomo".to_string()),
            ..IVerge::default()
        });
        Config::verge().apply();
        match Config::verge().data().save_file() {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
    }

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let clash_bin = format!("{clash_core}{bin_ext}");
    let bin_path = current_exe()?.with_file_name(clash_bin);
    let bin_path = dirs::path_to_str(&bin_path)?;

    let config_dir = dirs::app_home_dir()?;
    let config_dir = dirs::path_to_str(&config_dir)?;

    let log_path = dirs::service_log_file()?;
    let log_path = dirs::path_to_str(&log_path)?;

    let config_file = dirs::path_to_str(config_file)?;

    let mut map = HashMap::new();
    map.insert("core_type", clash_core.as_str());
    map.insert("bin_path", bin_path);
    map.insert("config_dir", config_dir);
    map.insert("config_file", config_file);
    map.insert("log_file", log_path);

    let url = format!("{SERVICE_URL}/start_clash");
    let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .json(&map)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    if res.code != 0 {
        bail!(res.msg);
    }

    Ok(())
}

/// stop the clash by service
pub(super) async fn stop_core_by_service() -> Result<()> {
    let url = format!("{SERVICE_URL}/stop_clash");
    let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    if res.code != 0 {
        bail!(res.msg);
    }

    Ok(())
}

/// set dns by service
pub async fn set_dns_by_service() -> Result<()> {
    let url = format!("{SERVICE_URL}/set_dns");
    let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    if res.code != 0 {
        bail!(res.msg);
    }

    Ok(())
}

/// unset dns by service
pub async fn unset_dns_by_service() -> Result<()> {
    let url = format!("{SERVICE_URL}/unset_dns");
    let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    if res.code != 0 {
        bail!(res.msg);
    }

    Ok(())
}
