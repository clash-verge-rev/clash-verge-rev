#[cfg(target_os = "windows")]
use crate::utils::autostart as startup_shortcut;
use crate::{
    config::{Config, IVerge},
    core::handle::Handle,
    singleton,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging, logging_error};
use parking_lot::RwLock;
use scopeguard::defer;
use smartstring::alias::String;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use sysproxy::{Autoproxy, GuardMonitor, GuardType, Sysproxy};
use tauri_plugin_autostart::ManagerExt as _;

pub struct Sysopt {
    update_sysproxy: AtomicBool,
    reset_sysproxy: AtomicBool,
    inner_proxy: Arc<RwLock<(Sysproxy, Autoproxy)>>,
    guard: Arc<RwLock<GuardMonitor>>,
}

impl Default for Sysopt {
    fn default() -> Self {
        Self {
            update_sysproxy: AtomicBool::new(false),
            reset_sysproxy: AtomicBool::new(false),
            inner_proxy: Arc::new(RwLock::new((Sysproxy::default(), Autoproxy::default()))),
            guard: Arc::new(RwLock::new(GuardMonitor::new(GuardType::None, Duration::from_secs(30)))),
        }
    }
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

async fn get_bypass() -> String {
    let use_default = Config::verge().await.latest_arc().use_default_bypass.unwrap_or(true);
    let res = {
        let verge = Config::verge().await;
        let verge = verge.latest_arc();
        verge.system_proxy_bypass.clone()
    };
    let custom_bypass = match res {
        Some(bypass) => bypass,
        None => "".into(),
    };

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.into()
    } else if use_default {
        format!("{DEFAULT_BYPASS},{custom_bypass}").into()
    } else {
        custom_bypass
    }
}

singleton!(Sysopt, SYSOPT);

impl Sysopt {
    fn new() -> Self {
        Self::default()
    }

    fn access_guard(&self) -> Arc<RwLock<GuardMonitor>> {
        Arc::clone(&self.guard)
    }

    pub async fn refresh_guard(&self) {
        logging!(info, Type::Core, "Refreshing system proxy guard...");
        let verge = Config::verge().await.latest_arc();
        if !verge.enable_system_proxy.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy is disabled.");
            self.access_guard().write().stop();
            return;
        }
        if !verge.enable_proxy_guard.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy guard is disabled.");
            return;
        }
        logging!(
            info,
            Type::Core,
            "Updating system proxy with duration: {} seconds",
            verge.proxy_guard_duration.unwrap_or(30)
        );
        {
            let guard = self.access_guard();
            guard
                .write()
                .set_interval(Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30)));
        }
        logging!(info, Type::Core, "Starting system proxy guard...");
        {
            let guard = self.access_guard();
            guard.write().start();
        }
    }

    /// init the sysproxy
    pub async fn update_sysproxy(&self) -> Result<()> {
        if self.update_sysproxy.load(Ordering::Acquire) {
            logging!(info, Type::Core, "Sysproxy update is already in progress.");
            return Ok(());
        }
        if self
            .update_sysproxy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            logging!(info, Type::Core, "Sysproxy update is already in progress.");
            return Ok(());
        }
        defer! {
            logging!(info, Type::Core, "Sysproxy update completed.");
            self.update_sysproxy.store(false, Ordering::Release);
        }

        let verge = Config::verge().await.latest_arc();
        let port = {
            let verge_port = verge.verge_mixed_port;
            match verge_port {
                Some(port) => port,
                None => Config::clash().await.latest_arc().get_mixed_port(),
            }
        };
        let pac_port = IVerge::get_singleton_port();

        let (sys_enable, pac_enable, proxy_host, proxy_guard) = {
            (
                verge.enable_system_proxy.unwrap_or_default(),
                verge.proxy_auto_config.unwrap_or_default(),
                verge.proxy_host.clone().unwrap_or_else(|| String::from("127.0.0.1")),
                verge.enable_proxy_guard.unwrap_or_default(),
            )
        };

        // 先 await, 避免持有锁导致的 Send 问题
        let bypass = get_bypass().await;

        let (sys, auto) = &mut *self.inner_proxy.write();
        sys.enable = false;
        sys.host = proxy_host.clone().into();
        sys.port = port;
        sys.bypass = bypass.into();

        auto.enable = false;
        auto.url = format!("http://{proxy_host}:{pac_port}/commands/pac");

        self.access_guard().write().set_guard_type(GuardType::None);

        if !sys_enable && !pac_enable {
            // disable proxy
            sys.set_system_proxy()?;
            auto.set_auto_proxy()?;
            return Ok(());
        }

        if pac_enable {
            sys.enable = false;
            auto.enable = true;
            sys.set_system_proxy()?;
            auto.set_auto_proxy()?;
            if proxy_guard {
                self.access_guard()
                    .write()
                    .set_guard_type(GuardType::Autoproxy(auto.clone()));
            }
            return Ok(());
        }

        if sys_enable {
            auto.enable = false;
            sys.enable = true;
            auto.set_auto_proxy()?;
            sys.set_system_proxy()?;
            if proxy_guard {
                self.access_guard()
                    .write()
                    .set_guard_type(GuardType::Sysproxy(sys.clone()));
            }
            return Ok(());
        }

        Ok(())
    }

    /// reset the sysproxy
    #[allow(clippy::unused_async)]
    pub async fn reset_sysproxy(&self) -> Result<()> {
        if self
            .reset_sysproxy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        defer! {
            self.reset_sysproxy.store(false, Ordering::SeqCst);
        }

        // close proxy guard
        self.access_guard().write().set_guard_type(GuardType::None);

        // 直接关闭所有代理
        let (sys, auto) = &mut *self.inner_proxy.write();
        sys.enable = false;
        sys.set_system_proxy()?;
        auto.enable = false;
        auto.set_auto_proxy()?;

        Ok(())
    }

    /// update the startup
    pub async fn update_launch(&self) -> Result<()> {
        let enable_auto_launch = { Config::verge().await.latest_arc().enable_auto_launch };
        let is_enable = enable_auto_launch.unwrap_or(false);
        logging!(info, Type::System, "Setting auto-launch state to: {:?}", is_enable);

        // 首先尝试使用快捷方式方法
        #[cfg(target_os = "windows")]
        {
            if is_enable {
                if let Err(e) = startup_shortcut::create_shortcut().await {
                    logging!(error, Type::Setup, "创建启动快捷方式失败: {e}");
                    // 如果快捷方式创建失败，回退到原来的方法
                    self.try_original_autostart_method(is_enable);
                } else {
                    return Ok(());
                }
            } else if let Err(e) = startup_shortcut::remove_shortcut().await {
                logging!(error, Type::Setup, "删除启动快捷方式失败: {e}");
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
        let app_handle = Handle::app_handle();
        let autostart_manager = app_handle.autolaunch();

        if is_enable {
            logging_error!(Type::System, "{:?}", autostart_manager.enable());
        } else {
            logging_error!(Type::System, "{:?}", autostart_manager.disable());
        }
    }

    /// 获取当前自启动的实际状态
    pub fn get_launch_status(&self) -> Result<bool> {
        // 首先尝试检查快捷方式是否存在
        #[cfg(target_os = "windows")]
        {
            match startup_shortcut::is_shortcut_enabled() {
                Ok(enabled) => {
                    logging!(info, Type::System, "快捷方式自启动状态: {enabled}");
                    return Ok(enabled);
                }
                Err(e) => {
                    logging!(error, Type::System, "检查快捷方式失败，尝试原来的方法: {e}");
                }
            }
        }

        // 回退到原来的方法
        let app_handle = Handle::app_handle();
        let autostart_manager = app_handle.autolaunch();

        match autostart_manager.is_enabled() {
            Ok(status) => {
                logging!(info, Type::System, "Auto launch status: {status}");
                Ok(status)
            }
            Err(e) => {
                logging!(error, Type::System, "Failed to get auto launch status: {e}");
                Err(anyhow::anyhow!("Failed to get auto launch status: {}", e))
            }
        }
    }
}
