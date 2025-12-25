//! Best-effort platform workarounds for known upstream issues.
//!
//! NOTE:
//! These helpers are not fixes and may stop working as environments change.

use clash_verge_logging::{Type, logging};
use std::{fs, path::Path};

pub fn apply_nvidia_dmabuf_renderer_workaround() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }

    if has_nvidia_gpu() {
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        logging!(
            info,
            Type::Setup,
            "Detected NVIDIA GPU, set WEBKIT_DISABLE_DMABUF_RENDERER=1"
        );
    }
}

fn has_nvidia_gpu() -> bool {
    if Path::new("/proc/driver/nvidia/version").exists()
        || Path::new("/sys/module/nvidia").exists()
        || Path::new("/sys/module/nvidia_drm").exists()
    {
        return true;
    }

    let Ok(entries) = fs::read_dir("/sys/class/drm") else {
        return false;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("card") || name.contains('-') {
            continue;
        }

        let vendor_path = entry.path().join("device/vendor");
        let Ok(vendor) = fs::read_to_string(vendor_path) else {
            continue;
        };
        if vendor.trim().eq_ignore_ascii_case("0x10de") {
            return true;
        }
    }

    false
}
