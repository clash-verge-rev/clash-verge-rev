use crate::{cmds, config::Config, feat, utils::resolve};
use anyhow::Result;
use std::error::Error;
use std::marker::Sync;
use tauri::menu::{MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{ClickType, TrayIconBuilder};
use tauri::{AppHandle, Manager};
pub struct Tray {}

impl Tray {
    pub fn update_systray(app_handle: &AppHandle) -> Result<()> {
        let zh = { Config::verge().latest().language == Some("zh".into()) };

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

        let open_window = MenuItemBuilder::with_id("open_window", t!("Dashboard", "打开面板"))
            .build(app_handle)?;
        let rule_mode =
            MenuItemBuilder::with_id("rule_mode", t!("Rule Mode", "规则模式")).build(app_handle)?;
        let global_mode = MenuItemBuilder::with_id("global_mode", t!("Global Mode", "全局模式"))
            .build(app_handle)?;
        let direct_mode = MenuItemBuilder::with_id("direct_mode", t!("Direct Mode", "直连模式"))
            .build(app_handle)?;
        let system_proxy = MenuItemBuilder::with_id("system_proxy", t!("System Proxy", "系统代理"))
            .build(app_handle)?;
        let tun_mode =
            MenuItemBuilder::with_id("tun_mode", t!("TUN Mode", "Tun 模式")).build(app_handle)?;
        let copy_env = MenuItemBuilder::with_id("copy_env", t!("Copy Env", "复制环境变量"))
            .build(app_handle)?;
        let open_app_dir = MenuItemBuilder::with_id("open_app_dir", t!("App Dir", "应用目录"))
            .build(app_handle)?;
        let open_core_dir = MenuItemBuilder::with_id("open_core_dir", t!("Core Dir", "内核目录"))
            .build(app_handle)?;
        let open_logs_dir = MenuItemBuilder::with_id("open_logs_dir", t!("Logs Dir", "日志目录"))
            .build(app_handle)?;
        let open_dir = SubmenuBuilder::with_id(app_handle, "open_dir", t!("Open Dir", "打开目录"))
            .items(&[&open_app_dir, &open_core_dir, &open_logs_dir])
            .build()?;
        let restart_clash =
            MenuItemBuilder::with_id("restart_clash", t!("Restart Clash", "重启 Clash"))
                .build(app_handle)?;
        let restart_app = MenuItemBuilder::with_id("restart_app", t!("Restart App", "重启应用"))
            .build(app_handle)?;
        let app_version = MenuItemBuilder::with_id("app_version", format!("Version {version}"))
            .build(app_handle)?;
        let more = SubmenuBuilder::with_id(app_handle, "more", t!("More", "更多"))
            .items(&[&restart_clash, &restart_app, &app_version])
            .build()?;
        let quit = MenuItemBuilder::with_id("quit", t!("Quit", "退出"))
            .accelerator("CmdOrControl+Q")
            .build(app_handle)?;
        let separator = PredefinedMenuItem::separator(app_handle)?;
        let menu = MenuBuilder::new(app_handle)
            .items(&[
                &open_window,
                &separator,
                &rule_mode,
                &global_mode,
                &direct_mode,
                &separator,
                &system_proxy,
                &tun_mode,
                &copy_env,
                &open_dir,
                &more,
                &separator,
                &quit,
            ])
            .build()?;
        let tray = TrayIconBuilder::new()
            .menu(&menu)
            .on_menu_event(Self::on_menu_event)
            .on_tray_icon_event(|tray, event| {
                let tray_event = { Config::verge().latest().tray_event.clone() };
                let tray_event = tray_event.unwrap_or("main_window".into());
                if event.click_type == ClickType::Left {
                    let app = tray.app_handle();
                    match tray_event.as_str() {
                        "system_proxy" => feat::toggle_system_proxy(),
                        "tun_mode" => feat::toggle_tun_mode(),
                        "main_window" => resolve::create_window(app),
                        _ => {}
                    }
                }
            })
            .build(app_handle);
        Tray::update_part(app_handle)?;
        Ok(())
    }

    pub fn update_part(app_handle: &AppHandle) -> Result<()> {
        let zh = { Config::verge().latest().language == Some("zh".into()) };

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

        let mode = {
            Config::clash()
                .latest()
                .0
                .get("mode")
                .map(|val| val.as_str().unwrap_or("rule"))
                .unwrap_or("rule")
                .to_owned()
        };
        if let Some(menu) = app_handle.menu() {
            if let Some(item) = menu.get("rule_mode") {
                let item = item.as_check_menuitem().unwrap();
                let _ = item.set_checked(mode == "rule");
            }
            if let Some(item) = menu.get("global_mode") {
                let item = item.as_check_menuitem().unwrap();
                let _ = item.set_checked(mode == "global");
            }
            if let Some(item) = menu.get("direct_mode") {
                let item = item.as_check_menuitem().unwrap();
                let _ = item.set_checked(mode == "direct");
            }

            let verge = Config::verge();
            let verge = verge.latest();
            let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
            let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

            if let Some(item) = menu.get("system_proxy") {
                let item = item.as_check_menuitem().unwrap();
                let _ = item.set_checked(*system_proxy);
            }
            if let Some(item) = menu.get("tun_mode") {
                let item = item.as_check_menuitem().unwrap();
                let _ = item.set_checked(*tun_mode);
            }

            let mut indication_icon = if *system_proxy {
                #[cfg(not(target_os = "macos"))]
                let icon = include_bytes!("../../icons/tray-icon-sys.png").to_vec();
                #[cfg(target_os = "macos")]
                let icon = include_bytes!("../../icons/mac-tray-icon-sys.png").to_vec();
                icon
            } else {
                #[cfg(not(target_os = "macos"))]
                let icon = include_bytes!("../../icons/tray-icon.png").to_vec();
                #[cfg(target_os = "macos")]
                let icon = include_bytes!("../../icons/mac-tray-icon.png").to_vec();
                icon
            };

            if *tun_mode {
                #[cfg(not(target_os = "macos"))]
                let icon = include_bytes!("../../icons/tray-icon-tun.png").to_vec();
                #[cfg(target_os = "macos")]
                let icon = include_bytes!("../../icons/mac-tray-icon-tun.png").to_vec();
                indication_icon = icon
            }
            if let Some(tray) = app_handle.tray() {
                let _ = tray.set_icon(Some(tauri::Icon::Raw(indication_icon)));
                let switch_map = {
                    let mut map = std::collections::HashMap::new();
                    map.insert(true, "on");
                    map.insert(false, "off");
                    map
                };
                let _ = tray.set_tooltip(Some(&format!(
                    "Clash Verge {version}\n{}: {}\n{}: {}",
                    t!("System Proxy", "系统代理"),
                    switch_map[system_proxy],
                    t!("TUN Mode", "Tun 模式"),
                    switch_map[tun_mode]
                )));
            }
        }

        Ok(())
    }

    pub fn on_menu_event(app_handle: &AppHandle, event: MenuEvent) {
        match event.id.as_ref() {
            mode @ ("rule_mode" | "global_mode" | "direct_mode") => {
                let mode = &mode[0..mode.len() - 5];
                feat::change_clash_mode(mode.into());
            }
            "open_window" => resolve::create_window(app_handle),
            "system_proxy" => feat::toggle_system_proxy(),
            "tun_mode" => feat::toggle_tun_mode(),
            "copy_env" => feat::copy_clash_env(app_handle),
            "open_app_dir" => crate::log_err!(cmds::open_app_dir()),
            "open_core_dir" => crate::log_err!(cmds::open_core_dir()),
            "open_logs_dir" => crate::log_err!(cmds::open_logs_dir()),
            "restart_clash" => feat::restart_clash_core(),
            "restart_app" => tauri::process::restart(&app_handle.env()),
            "quit" => cmds::exit_app(app_handle.clone()),
            _ => {}
        }
    }
}
