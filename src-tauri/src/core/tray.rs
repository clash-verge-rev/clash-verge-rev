use crate::{
    cmds,
    config::Config,
    feat,
    utils::{dirs, resolve},
};
use anyhow::Result;
use tauri::{
    AppHandle, CustomMenuItem, Icon, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
    SystemTraySubmenu,
};

pub struct Tray {}

impl Tray {
    fn get_tray_icon() -> Icon {
        let verge = Config::verge().latest().clone();
        let clash = Config::clash().latest().clone();
        let icon_dir_path = dirs::app_home_dir().unwrap().join("icons");
        let sysproxy_enabled = verge.enable_system_proxy.unwrap_or(false);
        let tun_enabled = clash.get_enable_tun();
        #[cfg(target_os = "macos")]
        let tray_icon = verge.tray_icon.unwrap_or("monochrome".to_string());
        // get icon
        let common_tray_icon = verge.common_tray_icon.unwrap_or(false);
        let sysproxy_tray_icon = verge.sysproxy_tray_icon.unwrap_or(false);
        let tun_tray_icon = verge.tun_tray_icon.unwrap_or(false);
        let icon = match (sysproxy_enabled, tun_enabled) {
            (_, true) => {
                if tun_tray_icon {
                    let mut icon_path = icon_dir_path.join("tun.ico");
                    if !icon_path.exists() {
                        icon_path = icon_dir_path.join("tun.png");
                    }
                    Icon::File(icon_path)
                } else {
                    #[cfg(target_os = "macos")]
                    let icon = match tray_icon.as_str() {
                        "monochrome" => {
                            include_bytes!("../../icons/tray-icon-tun-mono.ico").to_vec()
                        }
                        "colorful" => include_bytes!("../../icons/tray-icon-tun.ico").to_vec(),
                        _ => include_bytes!("../../icons/tray-icon-tun-mono.ico").to_vec(),
                    };
                    #[cfg(not(target_os = "macos"))]
                    let icon = include_bytes!("../../icons/tray-icon-tun.png").to_vec();
                    Icon::Raw(icon)
                }
            }
            (true, _) => {
                if sysproxy_tray_icon {
                    let mut icon_path = icon_dir_path.join("sysproxy.ico");
                    if !icon_path.exists() {
                        icon_path = icon_dir_path.join("sysproxy.png");
                    }
                    Icon::File(icon_path)
                } else {
                    #[cfg(target_os = "macos")]
                    let icon = match tray_icon.as_str() {
                        "monochrome" => {
                            include_bytes!("../../icons/tray-icon-sys-mono.ico").to_vec()
                        }
                        "colorful" => include_bytes!("../../icons/tray-icon-sys.ico").to_vec(),
                        _ => include_bytes!("../../icons/tray-icon-sys-mono.ico").to_vec(),
                    };
                    #[cfg(not(target_os = "macos"))]
                    let icon = include_bytes!("../../icons/tray-icon-sys.png").to_vec();
                    Icon::Raw(icon)
                }
            }
            _ => {
                if common_tray_icon {
                    let mut icon_path = icon_dir_path.join("common.ico");
                    if !icon_path.exists() {
                        icon_path = icon_dir_path.join("common.png");
                    }
                    Icon::File(icon_path)
                } else {
                    #[cfg(target_os = "macos")]
                    let icon = match tray_icon.as_str() {
                        "monochrome" => include_bytes!("../../icons/tray-icon-mono.ico").to_vec(),
                        "colorful" => include_bytes!("../../icons/tray-icon.ico").to_vec(),
                        _ => include_bytes!("../../icons/tray-icon-mono.ico").to_vec(),
                    };
                    #[cfg(not(target_os = "macos"))]
                    let icon = include_bytes!("../../icons/tray-icon.png").to_vec();
                    Icon::Raw(icon)
                }
            }
        };
        icon
    }

    pub fn tray_menu(app_handle: &AppHandle) -> SystemTrayMenu {
        let verge = Config::verge().latest().clone();
        let zh = verge.language == Some("zh".into());
        let version = app_handle.package_info().version.to_string();
        macro_rules! t {
            ($en: expr, $zh: expr) => {
                if zh {
                    $zh
                } else {
                    $en
                }
            };
        }

        let open_window = CustomMenuItem::new("open_window", t!("Dashboard", "打开面板"));
        let rule_mode = CustomMenuItem::new("rule_mode", t!("Rule Mode", "规则模式"));
        let global_mode = CustomMenuItem::new("global_mode", t!("Global Mode", "全局模式"));
        let direct_mode = CustomMenuItem::new("direct_mode", t!("Direct Mode", "直连模式"));
        let system_proxy = CustomMenuItem::new("system_proxy", t!("System Proxy", "系统代理"));
        let tun_mode = CustomMenuItem::new("tun_mode", t!("TUN Mode", "Tun 模式"));
        let service_mode = CustomMenuItem::new("service_mode", t!("Service Mode", "服务模式"));
        let copy_env = CustomMenuItem::new("copy_env", t!("Copy Env", "复制环境变量"));
        let open_app_dir = CustomMenuItem::new("open_app_dir", t!("App Dir", "应用目录"));
        let open_core_dir = CustomMenuItem::new("open_core_dir", t!("Core Dir", "核心目录"));
        let open_logs_dir = CustomMenuItem::new("open_logs_dir", t!("Log Dir", "日志目录"));
        let open_dir = SystemTraySubmenu::new(
            t!("Open Dir", "打开目录"),
            SystemTrayMenu::new()
                .add_item(open_app_dir)
                .add_item(open_core_dir)
                .add_item(open_logs_dir),
        );
        let restart_clash = CustomMenuItem::new("restart_clash", t!("Restart Clash", "重启 Clash"));
        let restart_app = CustomMenuItem::new("restart_app", t!("Restart", "重启应用"));
        let app_version =
            CustomMenuItem::new("app_version", format!("Version {version}")).disabled();
        let more = SystemTraySubmenu::new(
            t!("More", "更多"),
            SystemTrayMenu::new()
                .add_item(restart_clash)
                .add_item(restart_app)
                .add_item(app_version),
        );
        let quit = CustomMenuItem::new("quit", t!("Quit", "退出"));
        let separator = SystemTrayMenuItem::Separator;

        SystemTrayMenu::new()
            .add_item(open_window)
            .add_native_item(separator.clone())
            .add_item(rule_mode)
            .add_item(global_mode)
            .add_item(direct_mode)
            .add_native_item(separator.clone())
            .add_item(system_proxy)
            .add_item(tun_mode)
            .add_native_item(separator.clone())
            .add_item(service_mode)
            .add_native_item(separator.clone())
            .add_item(copy_env)
            .add_submenu(open_dir)
            .add_submenu(more)
            .add_native_item(separator)
            .add_item(quit)
    }

    pub fn update_systray(app_handle: &AppHandle) -> Result<()> {
        app_handle
            .tray_handle()
            .set_menu(Tray::tray_menu(app_handle))?;
        Tray::update_part(app_handle)?;
        Ok(())
    }

    pub fn update_part(app_handle: &AppHandle) -> Result<()> {
        let tray = app_handle.tray_handle();
        let verge = Config::verge().latest().clone();
        let clash = Config::clash().latest().clone();
        let zh = verge.language == Some("zh".into());
        macro_rules! t {
            ($en: expr, $zh: expr) => {
                if zh {
                    $zh
                } else {
                    $en
                }
            };
        }
        let mode = clash.get_mode();
        let sysproxy_enabled = verge.enable_system_proxy.unwrap_or(false);
        let tun_enabled = clash.get_enable_tun();
        let service_enabled = verge.enable_service_mode.unwrap_or(false);

        let rule_menu = tray.get_item("rule_mode");
        let global_menu = tray.get_item("global_mode");
        let direct_menu = tray.get_item("direct_mode");
        match mode.as_str() {
            "rule" => {
                #[cfg(not(target_os = "linux"))]
                {
                    rule_menu.set_selected(true)?;
                    global_menu.set_selected(false)?;
                    direct_menu.set_selected(false)?;
                }
                #[cfg(target_os = "linux")]
                {
                    rule_menu.set_title(t!("Rule Mode ✔", "规则模式 ✔"))?;
                    global_menu.set_title(t!("Global Mode", "全局模式"))?;
                    direct_menu.set_title(t!("Direct Mode", "直连模式"))?;
                }
            }
            "global" => {
                #[cfg(not(target_os = "linux"))]
                {
                    rule_menu.set_selected(false)?;
                    global_menu.set_selected(true)?;
                    direct_menu.set_selected(false)?;
                }
                #[cfg(target_os = "linux")]
                {
                    rule_menu.set_title(t!("Rule Mode", "规则模式"))?;
                    global_menu.set_title(t!("Global Mode ✔", "全局模式 ✔"))?;
                    direct_menu.set_title(t!("Direct Mode", "直连模式"))?;
                }
            }
            "direct" => {
                #[cfg(not(target_os = "linux"))]
                {
                    rule_menu.set_selected(false)?;
                    global_menu.set_selected(false)?;
                    direct_menu.set_selected(true)?;
                }
                #[cfg(target_os = "linux")]
                {
                    rule_menu.set_title(t!("Rule Mode", "规则模式"))?;
                    global_menu.set_title(t!("Global Mode", "全局模式"))?;
                    direct_menu.set_title(t!("Direct Mode ✔", "直连模式 ✔"))?;
                }
            }
            _ => (),
        }

        let system_proxy_menu = tray.get_item("system_proxy");
        if sysproxy_enabled {
            #[cfg(not(target_os = "linux"))]
            system_proxy_menu.set_selected(true)?;
            #[cfg(target_os = "linux")]
            system_proxy_menu.set_title(t!("System Proxy ✔", "系统代理 ✔"))?;
        } else {
            #[cfg(not(target_os = "linux"))]
            system_proxy_menu.set_selected(false)?;
            #[cfg(target_os = "linux")]
            system_proxy_menu.set_title(t!("System Proxy", "系统代理"))?;
        }

        let tun_mode_menu = tray.get_item("tun_mode");
        if tun_enabled {
            #[cfg(not(target_os = "linux"))]
            tun_mode_menu.set_selected(true)?;
            #[cfg(target_os = "linux")]
            tun_mode_menu.set_title(t!("TUN Mode ✔", "TUN 模式 ✔"))?;
        } else {
            #[cfg(not(target_os = "linux"))]
            tun_mode_menu.set_selected(false)?;
            #[cfg(target_os = "linux")]
            tun_mode_menu.set_title(t!("TUN Mode", "TUN 模式"))?;
        }

        let service_mode_menu = tray.get_item("service_mode");
        if service_enabled {
            #[cfg(not(target_os = "linux"))]
            service_mode_menu.set_selected(true)?;
            #[cfg(target_os = "linux")]
            service_mode_menu.set_title(t!("Service Mode ✔", "服务模式 ✔"))?;
        } else {
            #[cfg(not(target_os = "linux"))]
            service_mode_menu.set_selected(false)?;
            #[cfg(target_os = "linux")]
            service_mode_menu.set_title(t!("Service Mode", "服务模式"))?;
        }

        #[cfg(target_os = "macos")]
        {
            let tray_icon = verge.tray_icon.unwrap_or("monochrome".to_string());
            match tray_icon.as_str() {
                "monochrome" => {
                    let _ = tray.set_icon_as_template(true);
                }
                "colorful" => {
                    let _ = tray.set_icon_as_template(false);
                }
                _ => {}
            }
        }

        // set tray icon
        tray.set_icon(Self::get_tray_icon())?;

        #[cfg(not(target_os = "linux"))]
        {
            let version = app_handle.package_info().version.to_string();
            let mut current_profile_name = "None".to_string();
            let profiles = Config::profiles().latest().clone();
            if let Some(current_profile_uid) = profiles.get_current() {
                let current_profile = profiles.get_item(&current_profile_uid);
                current_profile_name = match &current_profile.unwrap().name {
                    Some(profile_name) => profile_name.to_string(),
                    None => current_profile_name,
                };
            };
            let switch_map = |status| {
                if status {
                    "ON"
                } else {
                    "OFF"
                }
            };
            tray.set_tooltip(&format!(
                "Clash Verge {version}\n{}: {}\n{}: {}\n{}: {}",
                t!("System Proxy", "系统代理"),
                switch_map(sysproxy_enabled),
                t!("TUN Mode", "Tun 模式"),
                switch_map(tun_enabled),
                t!("Curent Profile", "当前订阅"),
                current_profile_name
            ))?;
        }
        Ok(())
    }

    pub fn on_click(app_handle: &AppHandle) {
        let tray_event = Config::verge().latest().tray_event.clone();
        let tray_event = tray_event.unwrap_or("main_window".into());
        match tray_event.as_str() {
            "system_proxy" => feat::toggle_system_proxy(),
            "service_mode" => feat::toggle_service_mode(),
            "tun_mode" => feat::toggle_tun_mode(),
            "main_window" => resolve::create_window(app_handle),
            _ => {}
        }
    }

    pub fn on_system_tray_event(app_handle: &AppHandle, event: SystemTrayEvent) {
        match event {
            #[cfg(not(target_os = "macos"))]
            SystemTrayEvent::LeftClick { .. } => Tray::on_click(app_handle),
            #[cfg(target_os = "macos")]
            SystemTrayEvent::RightClick { .. } => Tray::on_click(app_handle),
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                mode @ ("rule_mode" | "global_mode" | "direct_mode") => {
                    let mode = &mode[0..mode.len() - 5];
                    feat::change_clash_mode(mode.into());
                }
                "open_window" => resolve::create_window(app_handle),
                "system_proxy" => feat::toggle_system_proxy(),
                "service_mode" => feat::toggle_service_mode(),
                "tun_mode" => feat::toggle_tun_mode(),
                "copy_env" => feat::copy_clash_env(app_handle),
                "open_app_dir" => crate::log_err!(cmds::open_app_dir()),
                "open_core_dir" => crate::log_err!(cmds::open_core_dir()),
                "open_logs_dir" => crate::log_err!(cmds::open_logs_dir()),
                "restart_clash" => feat::restart_clash_core(),
                "restart_app" => cmds::restart_app(app_handle.clone()),
                "quit" => cmds::exit_app(app_handle.clone()),
                _ => {}
            },
            _ => {}
        }
    }
}
