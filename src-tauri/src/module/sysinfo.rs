use crate::core::{handle, CoreManager};
use std::fmt::{self, Debug, Formatter};
use sysinfo::System;

pub struct PlatformSpecification {
    system_name: String,
    system_version: String,
    system_kernel_version: String,
    system_arch: String,
    verge_version: String,
    running_mode: String,
}

impl Debug for PlatformSpecification {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "System Name: {}\nSystem Version: {}\nSystem kernel Version: {}\nSystem Arch: {}\nVerge Version: {}\nRunning Mode: {}",
            self.system_name, self.system_version, self.system_kernel_version, self.system_arch, self.verge_version, self.running_mode
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
        let config = handler.config();
        let verge_version = config.version.clone().unwrap_or("Null".into());

        // Get running mode asynchronously
        let running_mode = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                match CoreManager::global().get_running_mode().await {
                    crate::core::RunningMode::Service => "Service".to_string(),
                    crate::core::RunningMode::Sidecar => "Sidecar".to_string(),
                    crate::core::RunningMode::NotRunning => "Not Running".to_string(),
                }
            })
        });

        Self {
            system_name,
            system_version,
            system_kernel_version,
            system_arch,
            verge_version,
            running_mode,
        }
    }
}
