use crate::{
    config::{Config, IVerge},
    log_err,
};
use anyhow::{anyhow, Result};
use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::env::current_exe;
use std::sync::Arc;
use sysproxy::{Autoproxy, Sysproxy};
use tauri::async_runtime::Mutex as TokioMutex;

pub struct Sysopt {
    /// current system proxy setting
    cur_sysproxy: Arc<Mutex<Option<Sysproxy>>>,

    /// record the original system proxy
    /// recover it when exit
    old_sysproxy: Arc<Mutex<Option<Sysproxy>>>,

    /// current auto proxy setting
    cur_autoproxy: Arc<Mutex<Option<Autoproxy>>>,

    /// record the original auto proxy
    /// recover it when exit
    old_autoproxy: Arc<Mutex<Option<Autoproxy>>>,

    /// helps to auto launch the app
    auto_launch: Arc<Mutex<Option<AutoLaunch>>>,

    /// record whether the guard async is running or not
    guard_state: Arc<TokioMutex<bool>>,
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

fn get_bypass() -> String {
    // let bypass = DEFAULT_BYPASS.to_string();
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
    #[cfg(target_os = "windows")]
    let bypass = if custom_bypass.is_empty() {
        DEFAULT_BYPASS.to_string()
    } else {
        if use_default {
            format!("{};{}", DEFAULT_BYPASS, custom_bypass)
        } else {
            custom_bypass
        }
    };
    #[cfg(not(target_os = "windows"))]
    let bypass = if custom_bypass.is_empty() {
        DEFAULT_BYPASS.to_string()
    } else {
        if use_default {
            format!("{},{}", DEFAULT_BYPASS, custom_bypass)
        } else {
            custom_bypass
        }
    };

    bypass
}

impl Sysopt {
    pub fn global() -> &'static Sysopt {
        static SYSOPT: OnceCell<Sysopt> = OnceCell::new();

        SYSOPT.get_or_init(|| Sysopt {
            cur_sysproxy: Arc::new(Mutex::new(None)),
            old_sysproxy: Arc::new(Mutex::new(None)),
            cur_autoproxy: Arc::new(Mutex::new(None)),
            old_autoproxy: Arc::new(Mutex::new(None)),
            auto_launch: Arc::new(Mutex::new(None)),
            guard_state: Arc::new(TokioMutex::new(false)),
        })
    }

    /// init the sysproxy
    pub fn init_sysproxy(&self) -> Result<()> {
        let port = Config::verge()
            .latest()
            .verge_mixed_port
            .unwrap_or(Config::clash().data().get_mixed_port());
        let pac_port = IVerge::get_singleton_port();

        let (enable, pac) = {
            let verge = Config::verge();
            let verge = verge.latest();
            (
                verge.enable_system_proxy.unwrap_or(false),
                verge.proxy_auto_config.unwrap_or(false),
            )
        };
        let mut sys = Sysproxy {
            enable,
            host: String::from("127.0.0.1"),
            port,
            bypass: get_bypass(),
        };
        let mut auto = Autoproxy {
            enable,
            url: format!("http://127.0.0.1:{pac_port}/commands/pac"),
        };
        if pac {
            sys.enable = false;
            let old = Sysproxy::get_system_proxy().ok();
            sys.set_system_proxy()?;
            *self.old_sysproxy.lock() = old;
            *self.cur_sysproxy.lock() = Some(sys);

            let old = Autoproxy::get_auto_proxy().ok();
            auto.set_auto_proxy()?;
            *self.old_autoproxy.lock() = old;
            *self.cur_autoproxy.lock() = Some(auto);
        } else {
            auto.enable = false;
            let old = Autoproxy::get_auto_proxy().ok();
            auto.set_auto_proxy()?;
            *self.old_autoproxy.lock() = old;
            *self.cur_autoproxy.lock() = Some(auto);

            let old = Sysproxy::get_system_proxy().ok();
            sys.set_system_proxy()?;
            *self.old_sysproxy.lock() = old;
            *self.cur_sysproxy.lock() = Some(sys);
        }

        // run the system proxy guard
        self.guard_proxy();
        Ok(())
    }

    /// update the system proxy
    pub fn update_sysproxy(&self) -> Result<()> {
        let mut cur_sysproxy = self.cur_sysproxy.lock();
        let old_sysproxy = self.old_sysproxy.lock();
        let mut cur_autoproxy = self.cur_autoproxy.lock();
        let old_autoproxy = self.old_autoproxy.lock();

        let (enable, pac) = {
            let verge = Config::verge();
            let verge = verge.latest();
            (
                verge.enable_system_proxy.unwrap_or(false),
                verge.proxy_auto_config.unwrap_or(false),
            )
        };
        if pac && (cur_autoproxy.is_none() || old_autoproxy.is_none()) {
            drop(cur_autoproxy);
            drop(old_autoproxy);
            return self.init_sysproxy();
        }

        if !pac && (cur_sysproxy.is_none() || old_sysproxy.is_none()) {
            drop(cur_sysproxy);
            drop(old_sysproxy);
            return self.init_sysproxy();
        }

        let port = Config::verge()
            .latest()
            .verge_mixed_port
            .unwrap_or(Config::clash().data().get_mixed_port());
        let pac_port = IVerge::get_singleton_port();

        let mut sysproxy = cur_sysproxy.take().unwrap();
        sysproxy.bypass = get_bypass();
        sysproxy.port = port;

        let mut autoproxy = cur_autoproxy.take().unwrap();
        autoproxy.url = format!("http://127.0.0.1:{pac_port}/commands/pac");

        if pac {
            sysproxy.enable = false;
            sysproxy.set_system_proxy()?;
            *cur_sysproxy = Some(sysproxy);
            autoproxy.enable = enable;
            autoproxy.set_auto_proxy()?;
            *cur_autoproxy = Some(autoproxy);
        } else {
            autoproxy.enable = false;
            autoproxy.set_auto_proxy()?;
            *cur_autoproxy = Some(autoproxy);
            sysproxy.enable = enable;
            sysproxy.set_system_proxy()?;
            *cur_sysproxy = Some(sysproxy);
        }

        Ok(())
    }

    /// reset the sysproxy
    pub fn reset_sysproxy(&self) -> Result<()> {
        let mut cur_sysproxy = self.cur_sysproxy.lock();
        let mut old_sysproxy = self.old_sysproxy.lock();
        let mut cur_autoproxy = self.cur_autoproxy.lock();
        let mut old_autoproxy = self.old_autoproxy.lock();

        let cur_sysproxy = cur_sysproxy.take();
        let cur_autoproxy = cur_autoproxy.take();

        if let Some(mut old) = old_sysproxy.take() {
            // 如果原代理和当前代理 端口一致，就disable关闭，否则就恢复原代理设置
            // 当前没有设置代理的时候，不确定旧设置是否和当前一致，全关了
            let port_same = cur_sysproxy.map_or(true, |cur| old.port == cur.port);

            if old.enable && port_same {
                old.enable = false;
                log::info!(target: "app", "reset proxy by disabling the original proxy");
            } else {
                log::info!(target: "app", "reset proxy to the original proxy");
            }

            old.set_system_proxy()?;
        } else if let Some(mut cur @ Sysproxy { enable: true, .. }) = cur_sysproxy {
            // 没有原代理，就按现在的代理设置disable即可
            log::info!(target: "app", "reset proxy by disabling the current proxy");
            cur.enable = false;
            cur.set_system_proxy()?;
        } else {
            log::info!(target: "app", "reset proxy with no action");
        }

        if let Some(mut old) = old_autoproxy.take() {
            // 如果原代理和当前代理 URL一致，就disable关闭，否则就恢复原代理设置
            // 当前没有设置代理的时候，不确定旧设置是否和当前一致，全关了
            let url_same = cur_autoproxy.map_or(true, |cur| old.url == cur.url);

            if old.enable && url_same {
                old.enable = false;
                log::info!(target: "app", "reset proxy by disabling the original proxy");
            } else {
                log::info!(target: "app", "reset proxy to the original proxy");
            }

            old.set_auto_proxy()?;
        } else if let Some(mut cur @ Autoproxy { enable: true, .. }) = cur_autoproxy {
            // 没有原代理，就按现在的代理设置disable即可
            log::info!(target: "app", "reset proxy by disabling the current proxy");
            cur.enable = false;
            cur.set_auto_proxy()?;
        } else {
            log::info!(target: "app", "reset proxy with no action");
        }

        Ok(())
    }

    /// init the auto launch
    pub fn init_launch(&self) -> Result<()> {
        let app_exe = current_exe()?;
        // let app_exe = dunce::canonicalize(app_exe)?;
        let app_name = app_exe
            .file_stem()
            .and_then(|f| f.to_str())
            .ok_or(anyhow!("failed to get file stem"))?;

        let app_path = app_exe
            .as_os_str()
            .to_str()
            .ok_or(anyhow!("failed to get app_path"))?
            .to_string();

        // fix issue #26
        #[cfg(target_os = "windows")]
        let app_path = format!("\"{app_path}\"");

        // use the /Applications/Clash Verge.app path
        #[cfg(target_os = "macos")]
        let app_path = (|| -> Option<String> {
            let path = std::path::PathBuf::from(&app_path);
            let path = path.parent()?.parent()?.parent()?;
            let extension = path.extension()?.to_str()?;
            match extension == "app" {
                true => Some(path.as_os_str().to_str()?.to_string()),
                false => None,
            }
        })()
        .unwrap_or(app_path);

        // fix #403
        #[cfg(target_os = "linux")]
        let app_path = {
            use crate::core::handle::Handle;
            use tauri::Manager;

            let handle = Handle::global();
            match handle.app_handle.lock().as_ref() {
                Some(app_handle) => {
                    let appimage = app_handle.env().appimage;
                    appimage
                        .and_then(|p| p.to_str().map(|s| s.to_string()))
                        .unwrap_or(app_path)
                }
                None => app_path,
            }
        };

        let auto = AutoLaunchBuilder::new()
            .set_app_name(app_name)
            .set_app_path(&app_path)
            .build()?;

        *self.auto_launch.lock() = Some(auto);

        Ok(())
    }

    /// update the startup
    pub fn update_launch(&self) -> Result<()> {
        let auto_launch = self.auto_launch.lock();

        if auto_launch.is_none() {
            drop(auto_launch);
            return self.init_launch();
        }
        let enable = { Config::verge().latest().enable_auto_launch };
        let enable = enable.unwrap_or(false);
        let auto_launch = auto_launch.as_ref().unwrap();

        match enable {
            true => auto_launch.enable()?,
            false => log_err!(auto_launch.disable()), // 忽略关闭的错误
        };

        Ok(())
    }

    /// launch a system proxy guard
    /// read config from file directly
    pub fn guard_proxy(&self) {
        use tokio::time::{sleep, Duration};

        let guard_state = self.guard_state.clone();

        tauri::async_runtime::spawn(async move {
            // if it is running, exit
            let mut state = guard_state.lock().await;
            if *state {
                return;
            }
            *state = true;
            drop(state);

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
                    break;
                }

                // update duration
                wait_secs = guard_duration;

                log::debug!(target: "app", "try to guard the system proxy");

                let port = {
                    Config::verge()
                        .latest()
                        .verge_mixed_port
                        .unwrap_or(Config::clash().data().get_mixed_port())
                };
                let pac_port = IVerge::get_singleton_port();
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

            let mut state = guard_state.lock().await;
            *state = false;
            drop(state);
        });
    }
}
