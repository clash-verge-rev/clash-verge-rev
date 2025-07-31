#[cfg(target_os = "windows")]
use crate::utils::autostart as startup_shortcut;
use crate::{
    config::{Config, IVerge},
    core::{handle::Handle, EventDrivenProxyManager},
    logging, logging_error, singleton_lazy,
    utils::logging::Type,
};
use anyhow::Result;
use std::sync::Arc;
#[cfg(not(target_os = "windows"))]
use sysproxy::{Autoproxy, Sysproxy};
use tauri::async_runtime::Mutex as TokioMutex;
use tauri_plugin_autostart::ManagerExt;

pub struct Sysopt {
    update_sysproxy: Arc<TokioMutex<bool>>,
    reset_sysproxy: Arc<TokioMutex<bool>>,
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str =
    "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

fn get_bypass() -> String {
    let use_default = Config::verge()
        .latest_ref()
        .use_default_bypass
        .unwrap_or(true);
    let res = {
        let verge = Config::verge();
        let verge = verge.latest_ref();
        verge.system_proxy_bypass.clone()
    };
    let custom_bypass = match res {
        Some(bypass) => bypass,
        None => "".to_string(),
    };

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.to_string()
    } else if use_default {
        format!("{DEFAULT_BYPASS},{custom_bypass}")
    } else {
        custom_bypass
    }
}

impl Default for Sysopt {
    fn default() -> Self {
        Sysopt {
            update_sysproxy: Arc::new(TokioMutex::new(false)),
            reset_sysproxy: Arc::new(TokioMutex::new(false)),
        }
    }
}

// Use simplified singleton_lazy macro
singleton_lazy!(Sysopt, SYSOPT, Sysopt::default);

impl Sysopt {
    pub fn init_guard_sysproxy(&self) -> Result<()> {
        // 使用事件驱动代理管理器
        let proxy_manager = EventDrivenProxyManager::global();
        proxy_manager.notify_app_started();

        log::info!(target: "app", "已启用事件驱动代理守卫");
        Ok(())
    }

    /// init the sysproxy
    pub async fn update_sysproxy(&self) -> Result<()> {
        let _lock = self.update_sysproxy.lock().await;

        let port = Config::verge()
            .latest_ref()
            .verge_mixed_port
            .unwrap_or(Config::clash().latest_ref().get_mixed_port());
        let pac_port = IVerge::get_singleton_port();

        let (sys_enable, pac_enable, proxy_host) = {
            let verge = Config::verge();
            let verge = verge.latest_ref();
            (
                verge.enable_system_proxy.unwrap_or(false),
                verge.proxy_auto_config.unwrap_or(false),
                verge
                    .proxy_host
                    .clone()
                    .unwrap_or_else(|| String::from("127.0.0.1")),
            )
        };

        #[cfg(not(target_os = "windows"))]
        {
            let mut sys = Sysproxy {
                enable: false,
                host: proxy_host.clone(),
                port,
                bypass: get_bypass(),
            };
            let mut auto = Autoproxy {
                enable: false,
                url: format!("http://{proxy_host}:{pac_port}/commands/pac"),
            };

            if !sys_enable {
                sys.set_system_proxy()?;
                auto.set_auto_proxy()?;
                let proxy_manager = EventDrivenProxyManager::global();
                proxy_manager.notify_config_changed();
                return Ok(());
            }

            if pac_enable {
                sys.enable = false;
                auto.enable = true;
                sys.set_system_proxy()?;
                auto.set_auto_proxy()?;
                let proxy_manager = EventDrivenProxyManager::global();
                proxy_manager.notify_config_changed();
                return Ok(());
            }

            if sys_enable {
                auto.enable = false;
                sys.enable = true;
                auto.set_auto_proxy()?;
                sys.set_system_proxy()?;
                let proxy_manager = EventDrivenProxyManager::global();
                proxy_manager.notify_config_changed();
                return Ok(());
            }
        }
        #[cfg(target_os = "windows")]
        {
            if !sys_enable {
                let result = self.reset_sysproxy().await;
                let proxy_manager = EventDrivenProxyManager::global();
                proxy_manager.notify_config_changed();
                return result;
            }
            use crate::{core::handle::Handle, utils::dirs};
            use anyhow::bail;
            use tauri_plugin_shell::ShellExt;

            let app_handle = Handle::global().app_handle().unwrap();

            let binary_path = dirs::service_path()?;
            let sysproxy_exe = binary_path.with_file_name("sysproxy.exe");
            if !sysproxy_exe.exists() {
                bail!("sysproxy.exe not found");
            }

            let shell = app_handle.shell();
            let output = if pac_enable {
                let address = format!("http://{proxy_host}:{pac_port}/commands/pac");
                let output = shell
                    .command(sysproxy_exe.as_path().to_str().unwrap())
                    .args(["pac", address.as_str()])
                    .output()
                    .await
                    .unwrap();
                output
            } else {
                let address = format!("{proxy_host}:{port}");
                let bypass = get_bypass();
                let output = shell
                    .command(sysproxy_exe.as_path().to_str().unwrap())
                    .args(["global", address.as_str(), bypass.as_ref()])
                    .output()
                    .await
                    .unwrap();
                output
            };

            if !output.status.success() {
                bail!("sysproxy exe run failed");
            }
        }
        let proxy_manager = EventDrivenProxyManager::global();
        proxy_manager.notify_config_changed();

        Ok(())
    }

    /// reset the sysproxy
    pub async fn reset_sysproxy(&self) -> Result<()> {
        let _lock = self.reset_sysproxy.lock().await;
        //直接关闭所有代理
        #[cfg(not(target_os = "windows"))]
        {
            let mut sysproxy: Sysproxy = Sysproxy::get_system_proxy()?;
            let mut autoproxy = match Autoproxy::get_auto_proxy() {
                Ok(ap) => ap,
                Err(e) => {
                    log::warn!(target: "app", "重置代理时获取自动代理配置失败: {e}, 使用默认配置");
                    Autoproxy {
                        enable: false,
                        url: "".to_string(),
                    }
                }
            };
            sysproxy.enable = false;
            autoproxy.enable = false;
            autoproxy.set_auto_proxy()?;
            sysproxy.set_system_proxy()?;
        }

        #[cfg(target_os = "windows")]
        {
            use crate::{core::handle::Handle, utils::dirs};
            use anyhow::bail;
            use tauri_plugin_shell::ShellExt;

            let app_handle = Handle::global().app_handle().unwrap();

            let binary_path = dirs::service_path()?;
            let sysproxy_exe = binary_path.with_file_name("sysproxy.exe");

            if !sysproxy_exe.exists() {
                bail!("sysproxy.exe not found");
            }

            let shell = app_handle.shell();
            let output = shell
                .command(sysproxy_exe.as_path().to_str().unwrap())
                .args(["set", "1"])
                .output()
                .await
                .unwrap();

            if !output.status.success() {
                bail!("sysproxy exe run failed");
            }
        }

        Ok(())
    }

    /// update the startup
    pub fn update_launch(&self) -> Result<()> {
        let enable_auto_launch = { Config::verge().latest_ref().enable_auto_launch };
        let is_enable = enable_auto_launch.unwrap_or(false);
        logging!(info, true, "Setting auto-launch state to: {:?}", is_enable);

        // 首先尝试使用快捷方式方法
        #[cfg(target_os = "windows")]
        {
            if is_enable {
                if let Err(e) = startup_shortcut::create_shortcut() {
                    log::error!(target: "app", "创建启动快捷方式失败: {e}");
                    // 如果快捷方式创建失败，回退到原来的方法
                    self.try_original_autostart_method(is_enable);
                } else {
                    return Ok(());
                }
            } else if let Err(e) = startup_shortcut::remove_shortcut() {
                log::error!(target: "app", "删除启动快捷方式失败: {e}");
                self.try_original_autostart_method(is_enable);
            } else {
                return Ok(());
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // 非Windows平台使用原来的方法
            self.try_original_autostart_method(is_enable);
        }

        Ok(())
    }

    /// 尝试使用原来的自启动方法
    fn try_original_autostart_method(&self, is_enable: bool) {
        let app_handle = Handle::global().app_handle().unwrap();
        let autostart_manager = app_handle.autolaunch();

        if is_enable {
            logging_error!(Type::System, true, "{:?}", autostart_manager.enable());
        } else {
            logging_error!(Type::System, true, "{:?}", autostart_manager.disable());
        }
    }

    /// 获取当前自启动的实际状态
    pub fn get_launch_status(&self) -> Result<bool> {
        // 首先尝试检查快捷方式是否存在
        #[cfg(target_os = "windows")]
        {
            match startup_shortcut::is_shortcut_enabled() {
                Ok(enabled) => {
                    log::info!(target: "app", "快捷方式自启动状态: {enabled}");
                    return Ok(enabled);
                }
                Err(e) => {
                    log::error!(target: "app", "检查快捷方式失败，尝试原来的方法: {e}");
                }
            }
        }

        // 回退到原来的方法
        let app_handle = Handle::global().app_handle().unwrap();
        let autostart_manager = app_handle.autolaunch();

        match autostart_manager.is_enabled() {
            Ok(status) => {
                log::info!(target: "app", "Auto launch status: {status}");
                Ok(status)
            }
            Err(e) => {
                log::error!(target: "app", "Failed to get auto launch status: {e}");
                Err(anyhow::anyhow!("Failed to get auto launch status: {}", e))
            }
        }
    }
}
