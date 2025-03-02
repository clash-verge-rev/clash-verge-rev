use std::fmt::{self, Debug, Formatter};

pub struct PlatformSpecification {
    pub system_name: String,
    pub system_version: String,
    pub system_kernel_version: String,
    pub system_arch: String,
}

impl Debug for PlatformSpecification {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "System Name: {}\nSystem Version: {}\nSystem kernel Version: {}\nSystem Arch: {}",
            self.system_name, self.system_version, self.system_kernel_version, self.system_arch
        )
    }
}