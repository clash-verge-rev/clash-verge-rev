use crate::{
    config::{Config, IVerge},
    core::handle::Handle,
    log_err,
};
use anyhow::Result;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::sync::Arc;
use sysproxy::{Autoproxy, Sysproxy};
use tauri::async_runtime::Mutex as TokioMutex;
use tauri_plugin_autostart::ManagerExt;
use tokio::time::{sleep, Duration};

pub struct Sysopt {
    update_sysproxy: Arc<TokioMutex<bool>>,
    reset_sysproxy: Arc<TokioMutex<bool>>,
    /// helps to auto launch the app
    auto_launch: Arc<Mutex<bool>>,
    /// record whether the guard async is running or not
    guard_state: Arc<Mutex<bool>>,
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
    let use_default = Config::verge().latest().use_default_bypass.unwrap_or(true);
    let res = {
        let verge = Config::verge();
        let verge = verge.latest();
        verge.system_proxy_bypass.clone()
    };
    let custom_bypass = match res {
        Some(bypass) => bypass,
        None => "".to_string(),
    };

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.to_string()
    } else if use_default {
        format!("{},{}", DEFAULT_BYPASS, custom_bypass)
    } else {
        custom_bypass
    }
}

impl Sysopt {
    pub fn global() -> &'static Sysopt {
        static SYSOPT: OnceCell<Sysopt> = OnceCell::new();
        SYSOPT.get_or_init(|| Sysopt {
            update_sysproxy: Arc::new(TokioMutex::new(false)),
            reset_sysproxy: Arc::new(TokioMutex::new(false)),
            auto_launch: Arc::new(Mutex::new(false)),
            guard_state: Arc::new(false.into()),
        })
    }

    pub fn init_guard_sysproxy(&self) -> Result<()> {
        self.guard_proxy();
        Ok(())
    }

    /// init the sysproxy
    pub async fn update_sysproxy(&self) -> Result<()> {
        let _lock = self.update_sysproxy.lock().await;

        let port = Config::verge()
            .latest()
            .verge_mixed_port
            .unwrap_or(Config::clash().data().get_mixed_port());
        let pac_port = IVerge::get_singleton_port();

        let (sys_enable, pac_enable) = {
            let verge = Config::verge();
            let verge = verge.latest();
            (
                verge.enable_system_proxy.unwrap_or(false),
                verge.proxy_auto_config.unwrap_or(false),
            )
        };

        #[cfg(not(target_os = "windows"))]
        {
            let mut sys = Sysproxy {
                enable: false,
                host: String::from("127.0.0.1"),
                port,
                bypass: get_bypass(),
            };
            let mut auto = Autoproxy {
                enable: false,
                url: format!("http://127.0.0.1:{pac_port}/commands/pac"),
            };

            if !sys_enable {
                sys.set_system_proxy()?;
                auto.set_auto_proxy()?;
                return Ok(());
            }

            if pac_enable {
                sys.enable = false;
                auto.enable = true;
                sys.set_system_proxy()?;
                auto.set_auto_proxy()?;
                return Ok(());
            }

            if sys_enable {
                auto.enable = false;
                sys.enable = true;
                auto.set_auto_proxy()?;
                sys.set_system_proxy()?;
                return Ok(());
            }
        }
        #[cfg(target_os = "windows")]
        {
            if !sys_enable {
                return self.reset_sysproxy().await;
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
                let address = format!("http://{}:{}/commands/pac", "127.0.0.1", pac_port);
                let output = shell
                    .command(sysproxy_exe.as_path().to_str().unwrap())
                    .args(["pac", address.as_str()])
                    .output()
                    .await
                    .unwrap();
                output
            } else {
                let address = format!("{}:{}", "127.0.0.1", port);
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

        Ok(())
    }

    /// reset the sysproxy
    pub async fn reset_sysproxy(&self) -> Result<()> {
        let _lock = self.reset_sysproxy.lock().await;
        //直接关闭所有代理
        #[cfg(not(target_os = "windows"))]
        {
            let mut sysproxy: Sysproxy = Sysproxy::get_system_proxy()?;
            let mut autoproxy = Autoproxy::get_auto_proxy()?;
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
        let _lock = self.auto_launch.lock();
        let enable = { Config::verge().latest().enable_auto_launch };
        let enable = enable.unwrap_or(false);
        let app_handle = Handle::global().app_handle().unwrap();
        let autostart_manager = app_handle.autolaunch();

        log::info!(target: "app", "Setting auto launch to: {}", enable);

        match enable {
            true => {
                let result = autostart_manager.enable();
                if let Err(ref e) = result {
                    log::error!(target: "app", "Failed to enable auto launch: {}", e);
                } else {
                    log::info!(target: "app", "Auto launch enabled successfully");
                }
                log_err!(result)
            }
            false => {
                let result = autostart_manager.disable();
                if let Err(ref e) = result {
                    log::error!(target: "app", "Failed to disable auto launch: {}", e);
                } else {
                    log::info!(target: "app", "Auto launch disabled successfully");
                }
                log_err!(result)
            }
        };

        Ok(())
    }

    /// 获取当前自启动的实际状态
    pub fn get_launch_status(&self) -> Result<bool> {
        let app_handle = Handle::global().app_handle().unwrap();
        let autostart_manager = app_handle.autolaunch();

        match autostart_manager.is_enabled() {
            Ok(status) => {
                log::info!(target: "app", "Auto launch status: {}", status);
                Ok(status)
            }
            Err(e) => {
                log::error!(target: "app", "Failed to get auto launch status: {}", e);
                Err(anyhow::anyhow!("Failed to get auto launch status: {}", e))
            }
        }
    }

    fn guard_proxy(&self) {
        let _lock = self.guard_state.lock();

        tauri::async_runtime::spawn(async move {
            // default duration is 10s
            let mut wait_secs = 10u64;

            loop {
                sleep(Duration::from_secs(wait_secs)).await;

                let (enable, guard, guard_duration, pac) = {
                    let verge = Config::verge();
                    let verge = verge.latest();
                    (
                        verge.enable_system_proxy.unwrap_or(false),
                        verge.enable_proxy_guard.unwrap_or(false),
                        verge.proxy_guard_duration.unwrap_or(10),
                        verge.proxy_auto_config.unwrap_or(false),
                    )
                };

                // stop loop
                if !enable || !guard {
                    continue;
                }

                // update duration
                wait_secs = guard_duration;

                log::debug!(target: "app", "try to guard the system proxy");

                let sysproxy = Sysproxy::get_system_proxy();
                let autoproxy = Autoproxy::get_auto_proxy();
                if sysproxy.is_err() || autoproxy.is_err() {
                    log::error!(target: "app", "failed to get the system proxy");
                    continue;
                }

                let sysproxy_enable = sysproxy.ok().map(|s| s.enable).unwrap_or(false);
                let autoproxy_enable = autoproxy.ok().map(|s| s.enable).unwrap_or(false);

                if sysproxy_enable || autoproxy_enable {
                    continue;
                }

                let port = {
                    Config::verge()
                        .latest()
                        .verge_mixed_port
                        .unwrap_or(Config::clash().data().get_mixed_port())
                };
                let pac_port = IVerge::get_singleton_port();
                #[cfg(not(target_os = "windows"))]
                {
                    if pac {
                        let autoproxy = Autoproxy {
                            enable: true,
                            url: format!("http://127.0.0.1:{pac_port}/commands/pac"),
                        };
                        log_err!(autoproxy.set_auto_proxy());
                    } else {
                        let sysproxy = Sysproxy {
                            enable: true,
                            host: "127.0.0.1".into(),
                            port,
                            bypass: get_bypass(),
                        };

                        log_err!(sysproxy.set_system_proxy());
                    }
                }

                #[cfg(target_os = "windows")]
                {
                    use crate::{core::handle::Handle, utils::dirs};
                    use tauri_plugin_shell::ShellExt;

                    let app_handle = Handle::global().app_handle().unwrap();

                    let binary_path = dirs::service_path().unwrap();
                    let sysproxy_exe = binary_path.with_file_name("sysproxy.exe");
                    if !sysproxy_exe.exists() {
                        break;
                    }

                    let shell = app_handle.shell();
                    let output = if pac {
                        let address = format!("http://{}:{}/commands/pac", "127.0.0.1", pac_port);

                        shell
                            .command(sysproxy_exe.as_path().to_str().unwrap())
                            .args(["pac", address.as_str()])
                            .output()
                            .await
                            .unwrap()
                    } else {
                        let address = format!("{}:{}", "127.0.0.1", port);
                        let bypass = get_bypass();

                        shell
                            .command(sysproxy_exe.as_path().to_str().unwrap())
                            .args(["global", address.as_str(), bypass.as_ref()])
                            .output()
                            .await
                            .unwrap()
                    };
                    if !output.status.success() {
                        break;
                    }
                };
            }
        });
    }
}
