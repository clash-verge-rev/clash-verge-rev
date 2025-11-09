use crate::logging;
use crate::utils::logging::Type;
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::PathBuf;

const DRM_PATH: &str = "/sys/class/drm";
const INTEL_VENDOR_ID: &str = "0x8086";
const NVIDIA_VENDOR_ID: &str = "0x10de";
const NVIDIA_VERSION_PATH: &str = "/proc/driver/nvidia/version";

#[derive(Debug, Default, Clone, Copy)]
struct IntelGpuDetection {
    has_intel: bool,
    intel_is_primary: bool,
    inconclusive: bool,
}

impl IntelGpuDetection {
    const fn should_disable_dmabuf(&self) -> bool {
        self.intel_is_primary || self.inconclusive
    }
}

#[derive(Debug, Default, Clone)]
struct NvidiaGpuDetection {
    has_nvidia: bool,
    nvidia_is_primary: bool,
    missing_boot_vga: bool,
    open_kernel_module: bool,
    driver_summary: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NvidiaDmabufDisableReason {
    PrimaryOpenKernelModule,
    MissingBootVga,
    PreferNativeWayland,
}

impl NvidiaGpuDetection {
    const fn disable_reason(&self, session: &SessionEnv) -> Option<NvidiaDmabufDisableReason> {
        if !session.is_wayland {
            return None;
        }

        if !self.has_nvidia {
            return None;
        }

        if !self.open_kernel_module {
            return None;
        }

        if self.nvidia_is_primary {
            return Some(NvidiaDmabufDisableReason::PrimaryOpenKernelModule);
        }

        if self.missing_boot_vga {
            return Some(NvidiaDmabufDisableReason::MissingBootVga);
        }

        if session.prefer_native_wayland {
            return Some(NvidiaDmabufDisableReason::PreferNativeWayland);
        }

        None
    }
}

#[derive(Debug)]
struct SessionEnv {
    is_kde_plasma: bool,
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

    const fn has_env_override(&self) -> bool {
        self.dmabuf_override.is_some()
    }

    const fn should_override_env(&self, decision: &DmabufDecision) -> bool {
        if self.user_preference.is_some() {
            return true;
        }

        if decision.enable_dmabuf {
            return true;
        }

        !self.has_env_override()
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
        nvidia_gpu: &NvidiaGpuDetection,
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
                } else if let Some(reason) = nvidia_gpu.disable_reason(session) {
                    decision.enable_dmabuf = false;
                    decision.warn = true;
                    if session.is_wayland && !session.prefer_native_wayland {
                        decision.force_x11_backend = true;
                    }
                    let summary = nvidia_gpu
                        .driver_summary
                        .as_deref()
                        .and_then(|line| {
                            extract_nvidia_driver_version(line)
                                .map(|version| format!("NVIDIA Open Kernel Module {}", version))
                        })
                        .unwrap_or_else(|| String::from("NVIDIA Open Kernel Module"));
                    let message = match reason {
                        NvidiaDmabufDisableReason::PrimaryOpenKernelModule => format!(
                            "Wayland 会话检测到 {}：禁用 WebKit DMABUF 渲染以规避协议错误。",
                            summary
                        ),
                        NvidiaDmabufDisableReason::MissingBootVga => format!(
                            "Wayland 会话检测到 {}，但缺少 boot_vga 信息：预防性禁用 WebKit DMABUF。",
                            summary
                        ),
                        NvidiaDmabufDisableReason::PreferNativeWayland => format!(
                            "Wayland ({}) + {}：检测到 NVIDIA Open Kernel Module 在辅 GPU 上运行，预防性禁用 WebKit DMABUF。",
                            session.compositor_label, summary
                        ),
                    };
                    decision.message = Some(message);
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
                            decision.message = Some(
                                "Wayland 上检测到 Intel 主 GPU (0x8086)：禁用 WebKit DMABUF 以避免帧缓冲失败。".into(),
                            );
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

fn detect_nvidia_gpu() -> NvidiaGpuDetection {
    let mut detection = NvidiaGpuDetection::default();
    let entries = match fs::read_dir(DRM_PATH) {
        Ok(entries) => entries,
        Err(err) => {
            logging!(
                info,
                Type::Setup,
                "无法读取 DRM 设备目录 {}（{}），尝试通过 NVIDIA 驱动摘要进行降级检测。",
                DRM_PATH,
                err
            );
            detection.driver_summary = read_nvidia_driver_summary();
            if let Some(summary) = detection.driver_summary.as_ref() {
                detection.open_kernel_module = summary_indicates_open_kernel_module(summary);
                detection.has_nvidia = true;
                detection.missing_boot_vga = true;
            } else {
                logging!(
                    info,
                    Type::Setup,
                    "降级检测失败：未能读取 NVIDIA 驱动摘要，保留 WebKit DMABUF。"
                );
            }
            return detection;
        }
    };

    let mut seen_devices: HashSet<PathBuf> = HashSet::new();

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

        if !vendor.trim().eq_ignore_ascii_case(NVIDIA_VENDOR_ID) {
            continue;
        }

        detection.has_nvidia = true;

        let boot_vga_path = device_key.join("boot_vga");
        match fs::read_to_string(&boot_vga_path) {
            Ok(flag) => {
                if flag.trim() == "1" {
                    detection.nvidia_is_primary = true;
                }
            }
            Err(_) => {
                detection.missing_boot_vga = true;
            }
        }
    }

    if detection.has_nvidia {
        detection.driver_summary = read_nvidia_driver_summary();
        match detection.driver_summary.as_ref() {
            Some(summary) => {
                detection.open_kernel_module = summary_indicates_open_kernel_module(summary);
            }
            None => {
                logging!(
                    info,
                    Type::Setup,
                    "检测到 NVIDIA 设备，但无法读取 {}，默认视为未启用开源内核模块。",
                    NVIDIA_VERSION_PATH
                );
            }
        }
    }

    detection
}

fn read_nvidia_driver_summary() -> Option<String> {
    match fs::read_to_string(NVIDIA_VERSION_PATH) {
        Ok(content) => content
            .lines()
            .next()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty()),
        Err(err) => {
            logging!(
                info,
                Type::Setup,
                "读取 {} 失败：{}",
                NVIDIA_VERSION_PATH,
                err
            );
            None
        }
    }
}

fn summary_indicates_open_kernel_module(summary: &str) -> bool {
    let normalized = summary.to_ascii_lowercase();
    const PATTERNS: [&str; 4] = [
        "open kernel module",
        "open kernel modules",
        "open gpu kernel module",
        "open gpu kernel modules",
    ];

    let is_open = PATTERNS.iter().any(|pattern| normalized.contains(pattern));

    if !is_open && normalized.contains("open") {
        logging!(
            info,
            Type::Setup,
            "检测到 NVIDIA 驱动摘要包含 open 关键字但未匹配已知开源模块格式：{}",
            summary
        );
    }

    is_open
}

fn extract_nvidia_driver_version(summary: &str) -> Option<&str> {
    summary
        .split_whitespace()
        .find(|token| token.chars().all(|c| c.is_ascii_digit() || c == '.'))
}

pub fn ensure_mimeapps_entries(desktop_file: &str, schemes: &[&str]) -> Result<()> {
    let Some(path) = mimeapps_list_path() else {
        return Ok(());
    };

    if !path.exists() {
        return Ok(());
    }

    let original = fs::read_to_string(&path)?;
    let mut changed = false;

    let mut output_lines: Vec<String> = Vec::new();
    let mut current_section: Option<SectionKind> = None;
    let mut section_buffer: Vec<String> = Vec::new();
    let mut default_present = false;

    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if let Some(kind) = current_section.take() {
                flush_section(
                    &mut output_lines,
                    &mut section_buffer,
                    desktop_file,
                    schemes,
                    kind,
                    &mut changed,
                );
            }

            if trimmed.eq_ignore_ascii_case("[Default Applications]") {
                default_present = true;
                current_section = Some(SectionKind::DefaultApplications);
                output_lines.push("[Default Applications]".to_string());
                continue;
            } else if trimmed.eq_ignore_ascii_case("[Added Associations]") {
                current_section = Some(SectionKind::AddedAssociations);
                output_lines.push("[Added Associations]".to_string());
                continue;
            }
        }

        if current_section.is_some() {
            section_buffer.push(line.to_string());
        } else {
            output_lines.push(line.to_string());
        }
    }

    if let Some(kind) = current_section.take() {
        flush_section(
            &mut output_lines,
            &mut section_buffer,
            desktop_file,
            schemes,
            kind,
            &mut changed,
        );
    }

    if !default_present {
        changed = true;
        if output_lines.last().is_some_and(|line| !line.is_empty()) {
            output_lines.push(String::new());
        }
        output_lines.push("[Default Applications]".to_string());
        for &scheme in schemes {
            output_lines.push(format!("x-scheme-handler/{scheme}={desktop_file};"));
        }
    }

    if !changed {
        return Ok(());
    }

    let mut new_content = output_lines.join("\n");
    if !new_content.ends_with('\n') {
        new_content.push('\n');
    }

    fs::write(path, new_content)?;
    Ok(())
}

fn mimeapps_list_path() -> Option<PathBuf> {
    let config_path = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(PathBuf::from).map(|mut home| {
                home.push(".config");
                home
            })
        })
        .map(|mut dir| {
            dir.push("mimeapps.list");
            dir
        });

    if config_path.as_ref().is_some_and(|path| path.exists()) {
        return config_path;
    }

    let data_path = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(PathBuf::from).map(|mut home| {
                home.push(".local");
                home.push("share");
                home
            })
        })
        .map(|mut dir| {
            dir.push("applications");
            dir.push("mimeapps.list");
            dir
        });

    if data_path.as_ref().is_some_and(|path| path.exists()) {
        return data_path;
    }

    config_path
}

#[derive(Clone, Copy)]
enum SectionKind {
    DefaultApplications,
    AddedAssociations,
}

fn flush_section(
    output: &mut Vec<String>,
    section: &mut Vec<String>,
    desktop_file: &str,
    schemes: &[&str],
    kind: SectionKind,
    changed: &mut bool,
) {
    let mut seen: HashMap<&str, usize> = HashMap::new();
    let mut processed: Vec<String> = Vec::with_capacity(section.len());

    for line in section.drain(..) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            processed.push(line);
            continue;
        }

        let Some((raw_key, raw_value)) = trimmed.split_once('=') else {
            processed.push(line);
            continue;
        };

        if let Some(scheme) = match_scheme(raw_key.trim(), schemes) {
            let mut values: Vec<String> = raw_value
                .split(';')
                .filter_map(|value| {
                    let trimmed = value.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                })
                .collect();

            if let Some(&index) = seen.get(scheme) {
                let existing_line = &mut processed[index];
                let existing_prefix: String = existing_line
                    .chars()
                    .take_while(|c| c.is_whitespace())
                    .collect();
                let Some((_, existing_raw_value)) = existing_line.trim().split_once('=') else {
                    processed.push(line);
                    continue;
                };

                let mut merged_values: Vec<String> = existing_raw_value
                    .split(';')
                    .filter_map(|value| {
                        let trimmed = value.trim();
                        (!trimmed.is_empty()).then(|| trimmed.to_string())
                    })
                    .collect();

                for value in values {
                    if !merged_values.iter().any(|existing| existing == &value) {
                        merged_values.push(value);
                    }
                }

                if let Some(pos) = merged_values.iter().position(|value| value == desktop_file) {
                    if pos != 0 {
                        let moved = merged_values.remove(pos);
                        merged_values.insert(0, moved);
                    }
                } else {
                    merged_values.insert(0, desktop_file.to_string());
                }

                let mut merged_line = format!("{existing_prefix}x-scheme-handler/{scheme}=");
                merged_line.push_str(&merged_values.join(";"));
                merged_line.push(';');

                if *existing_line != merged_line {
                    *existing_line = merged_line;
                }

                // Dropping the duplicate entry alters the section even if nothing new was added.
                *changed = true;
                continue;
            }

            if let Some(pos) = values.iter().position(|value| value == desktop_file) {
                if pos != 0 {
                    values.remove(pos);
                    values.insert(0, desktop_file.to_string());
                    *changed = true;
                }
            } else {
                values.insert(0, desktop_file.to_string());
                *changed = true;
            }

            let prefix = line
                .chars()
                .take_while(|c| c.is_whitespace())
                .collect::<String>();
            let mut new_line = format!("{prefix}x-scheme-handler/{scheme}=");
            new_line.push_str(&values.join(";"));
            new_line.push(';');

            if new_line != line {
                *changed = true;
            }

            let index = processed.len();
            processed.push(new_line);
            seen.insert(scheme, index);
            continue;
        }

        processed.push(line);
    }

    let ensure_all = matches!(
        kind,
        SectionKind::DefaultApplications | SectionKind::AddedAssociations
    );

    if ensure_all {
        for &scheme in schemes {
            if !seen.contains_key(scheme) {
                processed.push(format!("x-scheme-handler/{scheme}={desktop_file};"));
                *changed = true;
            }
        }
    }

    output.extend(processed);
}

fn match_scheme<'a>(key: &str, schemes: &'a [&str]) -> Option<&'a str> {
    if let Some(rest) = key.strip_prefix("x-scheme-handler/") {
        return schemes.iter().copied().find(|candidate| *candidate == rest);
    }

    schemes.iter().copied().find(|candidate| *candidate == key)
}

pub fn configure_environment() {
    let session = SessionEnv::gather();
    let overrides = DmabufOverrides::gather();
    let intel_gpu = detect_intel_gpu();
    let nvidia_gpu = detect_nvidia_gpu();
    let decision = DmabufDecision::resolve(&session, &overrides, intel_gpu, &nvidia_gpu);

    if overrides.should_override_env(&decision) {
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
