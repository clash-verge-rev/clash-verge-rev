#![cfg(target_os = "windows")]

use crate::utils::{config, dirs};
use anyhow::Context;
use deelevate::{PrivilegeLevel, Token};
use runas::Command as RunasCommand;
use serde::{Deserialize, Serialize};
use std::os::windows::process::CommandExt;
use std::{env::current_exe, process::Command as StdCommand};

const SERVICE_NAME: &str = "clash_verge_service";

const SERVICE_URL: &str = "http://127.0.0.1:33211";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ResponseBody {
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

impl Service {
    /// Install the Clash Verge Service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn install_service() -> Result<()> {
        let binary_path = dirs::service_path();
        let install_path = binary_path.with_file_name("install-service.exe");

        if !install_path.exists() {
            bail!("installer exe not found");
        }

        let token = Token::with_current_process()?;
        let level = token.privilege_level()?;

        let status = match level {
            PrivilegeLevel::NotPrivileged => RunasCommand::new(install_path).status()?,
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

    /// Uninstall the Clash Verge Service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn uninstall_service() -> Result<()> {
        let binary_path = dirs::service_path();
        let uninstall_path = binary_path.with_file_name("uninstall-service.exe");

        if !uninstall_path.exists() {
            bail!("uninstaller exe not found");
        }

        let token = Token::with_current_process()?;
        let level = token.privilege_level()?;

        let status = match level {
            PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path).status()?,
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

    /// [deprecated]
    /// start service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn start_service() -> Result<()> {
        let token = Token::with_current_process()?;
        let level = token.privilege_level()?;

        let args = ["start", SERVICE_NAME];

        let status = match level {
            PrivilegeLevel::NotPrivileged => RunasCommand::new("sc").args(&args).status()?,
            _ => StdCommand::new("sc").args(&args).status()?,
        };

        match status.success() {
            true => Ok(()),
            false => bail!(
                "failed to start service with status {}",
                status.code().unwrap()
            ),
        }
    }

    /// stop service
    pub async fn stop_service() -> Result<()> {
        let url = format!("{SERVICE_URL}/stop_service");
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

    /// check the windows service status
    pub async fn check_service() -> Result<JsonResponse> {
        let url = format!("{SERVICE_URL}/get_clash");
        let response = reqwest::ClientBuilder::new()
            .no_proxy()
            .build()?
            .get(url)
            .send()
            .await?
            .json::<JsonResponse>()
            .await
            .context("failed to connect to the Clash Verge Service")?;

        Ok(response)
    }

    /// start the clash by service
    pub(super) async fn start_clash_by_service() -> Result<()> {
        let status = Self::check_service().await?;

        if status.code == 0 {
            Self::stop_clash_by_service().await?;
            sleep(Duration::from_secs(1)).await;
        }

        let clash_core = {
            let global = Data::global();
            let verge = global.verge.lock();
            verge.clash_core.clone().unwrap_or("clash".into())
        };

        let clash_bin = format!("{clash_core}.exe");
        let bin_path = current_exe().unwrap().with_file_name(clash_bin);
        let bin_path = bin_path.as_os_str().to_str().unwrap();

        let config_dir = dirs::app_home_dir();
        let config_dir = config_dir.as_os_str().to_str().unwrap();

        let log_path = dirs::service_log_file();
        let log_path = log_path.as_os_str().to_str().unwrap();

        let mut map = HashMap::new();
        map.insert("bin_path", bin_path);
        map.insert("config_dir", config_dir);
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
    pub(super) async fn stop_clash_by_service() -> Result<()> {
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
}
