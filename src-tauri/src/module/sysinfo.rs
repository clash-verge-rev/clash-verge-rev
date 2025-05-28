use crate::{
    cmd::system,
    core::{handle, CoreManager},
};
use std::fmt::{self, Debug, Formatter};
use sysinfo::System;

pub struct PlatformSpecification {
    system_name: String,
    system_version: String,
    system_kernel_version: String,
    system_arch: String,
    verge_version: String,
    running_mode: String,
    is_admin: bool,
}

impl Debug for PlatformSpecification {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "System Name: {}\nSystem Version: {}\nSystem kernel Version: {}\nSystem Arch: {}\nVerge Version: {}\nRunning Mode: {}\nIs Admin: {}",
            self.system_name, self.system_version, self.system_kernel_version, self.system_arch, self.verge_version, self.running_mode, self.is_admin
        )
    }
}

impl PlatformSpecification {
    pub fn new() -> Self {
        let system_name = System::name().unwrap_or("Null".into());
        let system_version = System::long_os_version().unwrap_or("Null".into());
        let system_kernel_version = System::kernel_version().unwrap_or("Null".into());
        let system_arch = System::cpu_arch();

        let handler = handle::Handle::global().app_handle().unwrap();
        let verge_version = handler.package_info().version.to_string();

        // 使用默认值避免在同步上下文中执行异步操作
        let running_mode = "NotRunning".to_string();

        let is_admin = system::is_admin().unwrap_or_default();

        Self {
            system_name,
            system_version,
            system_kernel_version,
            system_arch,
            verge_version,
            running_mode,
            is_admin,
        }
    }

    // 异步方法来获取完整的系统信息
    pub async fn new_async() -> Self {
        let mut info = Self::new();

        let running_mode = CoreManager::global().get_running_mode().await;
        info.running_mode = running_mode.to_string();

        info
    }
}
