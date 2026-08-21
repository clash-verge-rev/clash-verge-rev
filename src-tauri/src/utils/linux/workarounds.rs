//! Best-effort platform workarounds for known upstream issues.
//!
//! NOTE:
//! These helpers are not fixes and may stop working as environments change.

use clash_verge_logging::{Type, logging};
use std::{env, fs, path::Path, process::Command};

/// WebKitGTK's DMA-BUF renderer fails to paint the webview (blank window) on
/// GPUs whose EGL implementation falls back to software rendering, such as the
/// NVIDIA proprietary driver and virtual GPUs (VMware, VirtualBox, QEMU…).
/// Disabling it forces a compatible rendering path.
pub fn apply_gpu_dmabuf_renderer_workaround() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }

    if has_unreliable_gpu() {
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        logging!(
            info,
            Type::Setup,
            "Detected GPU with unreliable DMA-BUF rendering, set WEBKIT_DISABLE_DMABUF_RENDERER=1"
        );
    }
}

/// !Might cause more memory footpoint
pub fn apply_wayland_webkit_fix() {
    let is_wayland = env::var("XDG_SESSION_TYPE").unwrap_or_default() == "wayland";

    if !is_wayland {
        return;
    }

    let version = Command::new("pkg-config")
        .args(["--modversion", "wayland-client"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok());

    if let Some(v) = version
        && v.trim() <= "1.23.0"
    {
        unsafe {
            env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

/// Environments where the DMA-BUF renderer is known to leave a blank webview.
fn has_unreliable_gpu() -> bool {
    if has_nvidia_gpu() {
        return true;
    }

    const VIRTUAL_GPU_VENDORS: &[&str] = &[
        "0x15ad", // VMware SVGA
        "0x80ee", // VirtualBox
        "0x1af4", // Red Hat virtio-gpu
        "0x1b36", // Red Hat QXL
        "0x1234", // QEMU stdvga / bochs
        "0x1414", // Microsoft Hyper-V
    ];

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
        let vendor = vendor.trim().to_ascii_lowercase();
        if VIRTUAL_GPU_VENDORS.contains(&vendor.as_str()) {
            return true;
        }
    }

    false
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
