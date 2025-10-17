use crate::utils::logging::Type;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;

const DRM_PATH: &str = "/sys/class/drm";
const INTEL_VENDOR_ID: &str = "0x8086";

#[derive(Debug, Default, Clone, Copy)]
struct IntelGpuDetection {
    has_intel: bool,
    intel_is_primary: bool,
    inconclusive: bool,
}

impl IntelGpuDetection {
    fn should_disable_dmabuf(&self) -> bool {
        self.intel_is_primary || self.inconclusive
    }
}

#[derive(Debug)]
struct SessionEnv {
    is_kde_plasma: bool,
    is_hyprland: bool,
    is_wayland: bool,
    prefer_native_wayland: bool,
    compositor_label: String,
}

impl SessionEnv {
    fn gather() -> Self {
        let desktop_env = env::var("XDG_CURRENT_DESKTOP")
            .unwrap_or_default()
            .to_uppercase();
        let session_desktop = env::var("XDG_SESSION_DESKTOP")
            .unwrap_or_default()
            .to_uppercase();
        let desktop_session = env::var("DESKTOP_SESSION")
            .unwrap_or_default()
            .to_uppercase();

        let is_kde_plasma = desktop_env.contains("KDE")
            || session_desktop.contains("KDE")
            || desktop_session.contains("KDE")
            || desktop_env.contains("PLASMA")
            || session_desktop.contains("PLASMA")
            || desktop_session.contains("PLASMA");
        let is_hyprland = desktop_env.contains("HYPR")
            || session_desktop.contains("HYPR")
            || desktop_session.contains("HYPR");
        let is_wayland = env::var("XDG_SESSION_TYPE")
            .map(|value| value.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
            || env::var("WAYLAND_DISPLAY").is_ok();
        let prefer_native_wayland = is_wayland && (is_kde_plasma || is_hyprland);
        let compositor_label = if is_hyprland {
            String::from("Hyprland")
        } else if is_kde_plasma {
            String::from("KDE Plasma")
        } else {
            String::from("Wayland compositor")
        };

        Self {
            is_kde_plasma,
            is_hyprland,
            is_wayland,
            prefer_native_wayland,
            compositor_label,
        }
    }
}

#[derive(Debug)]
struct DmabufOverrides {
    user_preference: Option<bool>,
    dmabuf_override: Option<String>,
}

impl DmabufOverrides {
    fn gather() -> Self {
        let user_preference = env::var("CLASH_VERGE_DMABUF").ok().and_then(|value| {
            match value.trim().to_ascii_lowercase().as_str() {
                "1" | "true" | "enable" | "on" => Some(true),
                "0" | "false" | "disable" | "off" => Some(false),
                _ => None,
            }
        });
        let dmabuf_override = env::var("WEBKIT_DISABLE_DMABUF_RENDERER").ok();

        Self {
            user_preference,
            dmabuf_override,
        }
    }

    fn has_env_override(&self) -> bool {
        self.dmabuf_override.is_some()
    }

    fn should_override_env(&self) -> bool {
        self.user_preference.is_some() || !self.has_env_override()
    }
}

#[derive(Debug)]
struct DmabufDecision {
    enable_dmabuf: bool,
    force_x11_backend: bool,
    warn: bool,
    message: Option<String>,
}

impl DmabufDecision {
    fn resolve(
        session: &SessionEnv,
        overrides: &DmabufOverrides,
        intel_gpu: IntelGpuDetection,
    ) -> Self {
        let mut decision = Self {
            enable_dmabuf: true,
            force_x11_backend: false,
            warn: false,
            message: None,
        };

        match overrides.user_preference {
            Some(true) => {
                decision.enable_dmabuf = true;
                decision.message =
                    Some("CLASH_VERGE_DMABUF=1: 强制启用 WebKit DMABUF 渲染。".into());
            }
            Some(false) => {
                decision.enable_dmabuf = false;
                decision.message =
                    Some("CLASH_VERGE_DMABUF=0: 强制禁用 WebKit DMABUF 渲染。".into());
                if session.is_wayland && !session.prefer_native_wayland {
                    decision.force_x11_backend = true;
                }
            }
            None => {
                if overrides.has_env_override() {
                    if overrides.dmabuf_override.as_deref() == Some("1") {
                        decision.enable_dmabuf = false;
                        decision.message = Some(
                            "检测到 WEBKIT_DISABLE_DMABUF_RENDERER=1，沿用用户的软件渲染配置。"
                                .into(),
                        );
                        if session.is_wayland && !session.prefer_native_wayland {
                            decision.force_x11_backend = true;
                        }
                    } else {
                        decision.enable_dmabuf = true;
                        let value = overrides.dmabuf_override.clone().unwrap_or_default();
                        decision.message = Some(format!(
                            "检测到 WEBKIT_DISABLE_DMABUF_RENDERER={}，沿用用户配置。",
                            value
                        ));
                    }
                } else if session.prefer_native_wayland && !intel_gpu.should_disable_dmabuf() {
                    decision.enable_dmabuf = true;
                    decision.message = Some(format!(
                        "Wayland + {} detected: 使用原生 DMABUF 渲染。",
                        session.compositor_label
                    ));
                } else {
                    decision.enable_dmabuf = false;
                    if session.is_wayland && !session.prefer_native_wayland {
                        decision.force_x11_backend = true;
                    }

                    if intel_gpu.should_disable_dmabuf() && session.is_wayland {
                        decision.warn = true;
                        if intel_gpu.inconclusive {
                            decision.message = Some("Wayland 上检测到 Intel GPU，但缺少 boot_vga 信息：预防性禁用 WebKit DMABUF，若确认非主 GPU 可通过 CLASH_VERGE_DMABUF=1 覆盖。".into());
                        } else {
                            decision.message = Some("Wayland 上检测到 Intel 主 GPU (0x8086)：禁用 WebKit DMABUF 以避免帧缓冲失败。".into());
                        }
                    } else if session.is_wayland {
                        decision.message = Some(
                            "Wayland 会话未匹配受支持的合成器：禁用 WebKit DMABUF 渲染。".into(),
                        );
                    } else {
                        decision.message =
                            Some("禁用 WebKit DMABUF 渲染以获得更稳定的输出。".into());
                    }
                }
            }
        }

        decision
    }
}

fn detect_intel_gpu() -> IntelGpuDetection {
    let Ok(entries) = fs::read_dir(DRM_PATH) else {
        return IntelGpuDetection::default();
    };

    let mut detection = IntelGpuDetection::default();
    let mut seen_devices: HashSet<PathBuf> = HashSet::new();
    let mut missing_boot_vga = false;

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if !(name.starts_with("renderD") || name.starts_with("card")) {
            continue;
        }

        let device_path = entry.path().join("device");
        let device_key = fs::canonicalize(&device_path).unwrap_or(device_path);

        if !seen_devices.insert(device_key.clone()) {
            continue;
        }

        let vendor_path = device_key.join("vendor");
        let Ok(vendor) = fs::read_to_string(&vendor_path) else {
            continue;
        };

        if !vendor.trim().eq_ignore_ascii_case(INTEL_VENDOR_ID) {
            continue;
        }

        detection.has_intel = true;

        let boot_vga_path = device_key.join("boot_vga");
        match fs::read_to_string(&boot_vga_path) {
            Ok(flag) => {
                if flag.trim() == "1" {
                    detection.intel_is_primary = true;
                }
            }
            Err(_) => {
                missing_boot_vga = true;
            }
        }
    }

    if detection.has_intel && !detection.intel_is_primary && missing_boot_vga {
        detection.inconclusive = true;
    }

    detection
}

pub fn configure_environment() {
    let session = SessionEnv::gather();
    let overrides = DmabufOverrides::gather();
    let intel_gpu = detect_intel_gpu();
    let decision = DmabufDecision::resolve(&session, &overrides, intel_gpu);

    if overrides.should_override_env() {
        unsafe {
            if decision.enable_dmabuf {
                env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
            } else {
                env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
    }

    if let Some(message) = decision.message {
        if decision.warn {
            logging!(warn, Type::Setup, "{}", message);
        } else {
            logging!(info, Type::Setup, "{}", message);
        }
    }

    if decision.force_x11_backend {
        unsafe {
            env::set_var("GDK_BACKEND", "x11");
            env::remove_var("WAYLAND_DISPLAY");
        }
        logging!(
            info,
            Type::Setup,
            "Wayland detected: Forcing X11 backend for WebKit stability."
        );
    }

    if session.is_kde_plasma {
        unsafe {
            env::set_var("GTK_CSD", "0");
        }
        logging!(
            info,
            Type::Setup,
            "KDE/Plasma detected: Disabled GTK CSD for better titlebar stability."
        );
    }
}
