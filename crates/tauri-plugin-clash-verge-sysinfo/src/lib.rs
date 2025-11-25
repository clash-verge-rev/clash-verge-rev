use std::{
    fmt::{Debug, Display},
    time::Instant,
};

pub mod commands;

#[cfg(windows)]
use deelevate::{PrivilegeLevel, Token};
use parking_lot::RwLock;
use sysinfo::{Networks, System};
use tauri::{
    Manager as _, Runtime,
    plugin::{Builder, TauriPlugin},
};

pub struct SysInfo {
    system_name: String,
    system_version: String,
    system_kernel_version: String,
    system_arch: String,
}

impl Default for SysInfo {
    #[inline]
    fn default() -> Self {
        let system_name = System::name().unwrap_or_else(|| "Null".into());
        let system_version = System::long_os_version().unwrap_or_else(|| "Null".into());
        let system_kernel_version = System::kernel_version().unwrap_or_else(|| "Null".into());
        let system_arch = System::cpu_arch();
        Self {
            system_name,
            system_version,
            system_kernel_version,
            system_arch,
        }
    }
}

pub struct AppInfo {
    app_version: String,
    app_core_mode: String,
    pub app_startup_time: Instant,
    pub app_is_admin: bool,
}

impl Default for AppInfo {
    #[inline]
    fn default() -> Self {
        let app_version = "0.0.0".into();
        let app_core_mode = "NotRunning".into();
        let app_is_admin = false;
        let app_startup_time = Instant::now();
        Self {
            app_version,
            app_core_mode,
            app_startup_time,
            app_is_admin,
        }
    }
}

#[derive(Default)]
pub struct Platform {
    pub sysinfo: SysInfo,
    pub appinfo: AppInfo,
}

impl Debug for Platform {
    #[inline]
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Platform")
            .field("system_name", &self.sysinfo.system_name)
            .field("system_version", &self.sysinfo.system_version)
            .field("system_kernel_version", &self.sysinfo.system_kernel_version)
            .field("system_arch", &self.sysinfo.system_arch)
            .field("app_version", &self.appinfo.app_version)
            .field("app_core_mode", &self.appinfo.app_core_mode)
            .field("app_is_admin", &self.appinfo.app_is_admin)
            .finish()
    }
}

impl Display for Platform {
    #[inline]
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "System Name: {}\nSystem Version: {}\nSystem kernel Version: {}\nSystem Arch: {}\nVerge Version: {}\nRunning Mode: {}\nIs Admin: {}",
            self.sysinfo.system_name,
            self.sysinfo.system_version,
            self.sysinfo.system_kernel_version,
            self.sysinfo.system_arch,
            self.appinfo.app_version,
            self.appinfo.app_core_mode,
            self.appinfo.app_is_admin
        )
    }
}

impl Platform {
    #[inline]
    fn new() -> Self {
        Self::default()
    }
}

#[inline]
fn is_binary_admin() -> bool {
    #[cfg(not(windows))]
    unsafe {
        libc::geteuid() == 0
    }
    #[cfg(windows)]
    Token::with_current_process()
        .and_then(|token| token.privilege_level())
        .map(|level| level != PrivilegeLevel::NotPrivileged)
        .unwrap_or(false)
}

#[inline]
pub fn list_network_interfaces() -> Vec<String> {
    let mut networks = Networks::new();
    networks.refresh(false);
    networks.keys().map(|name| name.to_owned()).collect()
}

#[inline]
pub fn set_app_core_mode<R: Runtime>(app: &tauri::AppHandle<R>, mode: impl Into<String>) {
    let platform_spec = app.state::<RwLock<Platform>>();
    let mut spec = platform_spec.write();
    spec.appinfo.app_core_mode = mode.into();
}

#[inline]
pub fn is_current_app_handle_admin<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    let platform_spec = app.state::<RwLock<Platform>>();
    let spec = platform_spec.read();
    spec.appinfo.app_is_admin
}

#[inline]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("clash_verge_sysinfo")
        // TODO 现在 crate 还不是真正的 tauri 插件，必须由主 lib 自行注册
        // TODO 从 clash-verge 中迁移获取系统信息的 commnand 并实现优雅 structure.field 访问
        // .invoke_handler(tauri::generate_handler![
        //     commands::get_system_info,
        //     commands::get_app_uptime,
        //     commands::app_is_admin,
        //     commands::export_diagnostic_info,
        // ])
        .setup(move |app, _api| {
            let app_version = app.package_info().version.to_string();
            let is_admin = is_binary_admin();

            let mut platform_spec = Platform::new();
            platform_spec.appinfo.app_version = app_version;
            platform_spec.appinfo.app_is_admin = is_admin;

            app.manage(RwLock::new(platform_spec));
            Ok(())
        })
        .build()
}
