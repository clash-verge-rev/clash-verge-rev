use crate::model::sysinfo::PlatformSpecification;

use sysinfo::System;

impl PlatformSpecification {
    pub fn new() -> Self {
        let system_name = System::name().unwrap_or("Null".into());
        let system_version = System::long_os_version().unwrap_or("Null".into());
        let system_kernel_version = System::kernel_version().unwrap_or("Null".into());
        let system_arch = std::env::consts::ARCH.to_string();

        Self {
            system_name,
            system_version,
            system_kernel_version,
            system_arch
        }
    }
}
