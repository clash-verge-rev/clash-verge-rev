use crate::{
    cmds,
    config::Config,
    feat, t,
    utils::{
        dirs,
        resolve::{self, VERSION},
    },
};
use anyhow::Result;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{
    menu::{MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    Wry,
};
use tauri::{AppHandle, Manager};
pub struct Tray {}

impl Tray {
    pub fn update_systray(app_handle: &AppHandle) -> Result<()> {
        let tray = app_handle.tray_by_id("main").unwrap();
        tray.on_tray_icon_event(|tray, event| {
            let tray_event = { Config::verge().latest().tray_event.clone() };
            let tray_event: String = tray_event.unwrap_or("main_window".into());
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                match tray_event.as_str() {
                    "system_proxy" => feat::toggle_system_proxy(),
                    "tun_mode" => feat::toggle_tun_mode(),
                    "main_window" => resolve::create_window(app),
                    _ => {}
                }
            }
        });
        tray.on_menu_event(on_menu_event);

        Ok(())
    }

    pub fn update_part(app_handle: &AppHandle) -> Result<()> {
        let use_zh = { Config::verge().latest().language == Some("zh".into()) };
        let version = VERSION.get().unwrap();
        let mode = {
            Config::clash()
                .latest()
                .0
                .get("mode")
                .map(|val| val.as_str().unwrap_or("rule"))
                .unwrap_or("rule")
                .to_owned()
        };

        let verge = Config::verge().latest().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);
        #[cfg(target_os = "macos")]
        let tray_icon = verge.tray_icon.clone().unwrap_or("monochrome".to_string());
        let common_tray_icon = verge.common_tray_icon.as_ref().unwrap_or(&false);
        let sysproxy_tray_icon = verge.sysproxy_tray_icon.as_ref().unwrap_or(&false);
        let tun_tray_icon = verge.tun_tray_icon.as_ref().unwrap_or(&false);
        let tray = app_handle.tray_by_id("main").unwrap();

        let _ = tray.set_menu(Some(create_tray_menu(
            app_handle,
            Some(mode.as_str()),
            *system_proxy,
            *tun_mode,
        )?));

        // let _ = tray.
        #[cfg(target_os = "macos")]
        match tray_icon.as_str() {
            "monochrome" => {
                let _ = tray.set_icon_as_template(true);
            }
            "colorful" => {
                let _ = tray.set_icon_as_template(false);
            }
            _ => {}
        }

        let mut indication_icon = if *system_proxy {
            #[cfg(target_os = "macos")]
            let mut icon = match tray_icon.as_str() {
                "monochrome" => include_bytes!("../../icons/tray-icon-sys-mono.ico").to_vec(),
                "colorful" => include_bytes!("../../icons/tray-icon-sys.ico").to_vec(),
                _ => include_bytes!("../../icons/tray-icon-sys-mono.ico").to_vec(),
            };
            #[cfg(not(target_os = "macos"))]
            let mut icon = include_bytes!("../../icons/tray-icon-sys.ico").to_vec();

            if *sysproxy_tray_icon {
                let icon_dir_path = dirs::app_home_dir()?.join("icons");
                let png_path = icon_dir_path.join("sysproxy.png");
                let ico_path = icon_dir_path.join("sysproxy.ico");
                if ico_path.exists() {
                    icon = std::fs::read(ico_path).unwrap();
                } else if png_path.exists() {
                    icon = std::fs::read(png_path).unwrap();
                }
            }
            icon
        } else {
            #[cfg(target_os = "macos")]
            let mut icon = match tray_icon.as_str() {
                "monochrome" => include_bytes!("../../icons/tray-icon-mono.ico").to_vec(),
                "colorful" => include_bytes!("../../icons/tray-icon.ico").to_vec(),
                _ => include_bytes!("../../icons/tray-icon-mono.ico").to_vec(),
            };
            #[cfg(not(target_os = "macos"))]
            let mut icon = include_bytes!("../../icons/tray-icon.ico").to_vec();
            if *common_tray_icon {
                let icon_dir_path = dirs::app_home_dir()?.join("icons");
                let png_path = icon_dir_path.join("common.png");
                let ico_path = icon_dir_path.join("common.ico");
                if ico_path.exists() {
                    icon = std::fs::read(ico_path).unwrap();
                } else if png_path.exists() {
                    icon = std::fs::read(png_path).unwrap();
                }
            }
            icon
        };

        if *tun_mode {
            #[cfg(target_os = "macos")]
            let mut icon = match tray_icon.as_str() {
                "monochrome" => include_bytes!("../../icons/tray-icon-tun-mono.ico").to_vec(),
                "colorful" => include_bytes!("../../icons/tray-icon-tun.ico").to_vec(),
                _ => include_bytes!("../../icons/tray-icon-tun-mono.ico").to_vec(),
            };
            #[cfg(not(target_os = "macos"))]
            let mut icon = include_bytes!("../../icons/tray-icon-tun.ico").to_vec();
            if *tun_tray_icon {
                let icon_dir_path = dirs::app_home_dir()?.join("icons");
                let png_path = icon_dir_path.join("tun.png");
                let ico_path = icon_dir_path.join("tun.ico");
                if ico_path.exists() {
                    icon = std::fs::read(ico_path).unwrap();
                } else if png_path.exists() {
                    icon = std::fs::read(png_path).unwrap();
                }
            }
            indication_icon = icon
        }
        let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&indication_icon)?));

        let switch_map = {
            let mut map = std::collections::HashMap::new();
            map.insert(true, "on");
            map.insert(false, "off");
            map
        };

        let mut current_profile_name = "None".to_string();
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        if let Some(current_profile_uid) = profiles.get_current() {
            let current_profile = profiles.get_item(&current_profile_uid);
            current_profile_name = match &current_profile.unwrap().name {
                Some(profile_name) => profile_name.to_string(),
                None => current_profile_name,
            };
        };

        let _ = tray.set_tooltip(Some(&format!(
            "Clash Verge {version}\n{}: {}\n{}: {}\n{}: {}",
            t!("SysProxy", "系统代理", use_zh),
            switch_map[system_proxy],
            t!("TUN", "Tun模式", use_zh),
            switch_map[tun_mode],
            t!("Profile", "当前订阅", use_zh),
            current_profile_name
        )));
        Ok(())
    }
}

fn create_tray_menu(
    app_handle: &AppHandle,
    mode: Option<&str>,
    system_proxy_enabled: bool,
    tun_mode_enabled: bool,
) -> Result<tauri::menu::Menu<Wry>> {
    let mode = mode.unwrap_or("");
    let use_zh = { Config::verge().latest().language == Some("zh".into()) };
    let version = VERSION.get().unwrap();

    let rule_mode_text = if mode == "rule" {
        "✓ 规则模式"
    } else {
        "规则模式"
    };

    let global_mode_text = if mode == "global" {
        "✓ 全局模式"
    } else {
        "全局模式"
    };

    let direct_mode_text = if mode == "direct" {
        "✓ 直连模式"
    } else {
        "直连模式"
    };

    let system_proxy_text = if system_proxy_enabled {
        "✓ 系统代理"
    } else {
        "系统代理"
    };

    let tun_mode_text = if tun_mode_enabled {
        "✓ Tun 模式"
    } else {
        "Tun 模式"
    };

    let restart_clash = &MenuItem::with_id(
        app_handle,
        "restart_clash",
        t!("Restart App", "重启 Clash", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let restart_app = &MenuItem::with_id(
        app_handle,
        "restart_app",
        t!("Restart App", "重启应用", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let app_version = &MenuItem::with_id(
        app_handle,
        "app_version",
        format!("Version {version}"),
        true,
        None::<&str>,
    )
    .unwrap();

    let menu = tauri::menu::MenuBuilder::new(app_handle)
        .item(
            &MenuItem::with_id(
                app_handle,
                "open_window",
                t!("Dashboard", "打开面板", use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(&PredefinedMenuItem::separator(app_handle).unwrap())
        .item(
            &MenuItem::with_id(
                app_handle,
                "rule_mode",
                t!("Rule Mode", rule_mode_text, use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(
            &MenuItem::with_id(
                app_handle,
                "global_mode",
                t!("Global Mode", global_mode_text, use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(
            &MenuItem::with_id(
                app_handle,
                "direct_mode",
                t!("Direct Mode", direct_mode_text, use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(&PredefinedMenuItem::separator(app_handle).unwrap())
        .item(
            &MenuItem::with_id(
                app_handle,
                "system_proxy",
                t!("System Proxy", system_proxy_text, use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(
            &MenuItem::with_id(
                app_handle,
                "tun_mode",
                t!("TUN Mode", tun_mode_text, use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(
            &MenuItem::with_id(
                app_handle,
                "copy_env",
                t!("Copy Env", "复制环境变量", use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(
            &MenuItem::with_id(
                app_handle,
                "open_dir",
                t!("Open Dir", "打开目录", use_zh),
                true,
                None::<&str>,
            )
            .unwrap(),
        )
        .item(
            &Submenu::with_id_and_items(
                app_handle,
                "more",
                t!("More", "更多", use_zh),
                true,
                &[restart_clash, restart_app, app_version],
            )
            .unwrap(),
        )
        .item(&PredefinedMenuItem::separator(app_handle).unwrap())
        .item(
            &MenuItem::with_id(
                app_handle,
                "quit",
                t!("Quit", "退出", use_zh),
                true,
                Some("CmdOrControl+Q"),
            )
            .unwrap(),
        )
        .build()
        .unwrap();

    Ok(menu)
}

fn on_menu_event(app_handle: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        mode @ ("rule_mode" | "global_mode" | "direct_mode") => {
            let mode = &mode[0..mode.len() - 5];
            println!("change mode to: {}", mode);
            feat::change_clash_mode(mode.into());
        }
        "open_window" => resolve::create_window(app_handle),
        "system_proxy" => feat::toggle_system_proxy(),
        "tun_mode" => feat::toggle_tun_mode(),
        "copy_env" => feat::copy_clash_env(app_handle),
        "open_dir" => crate::log_err!(cmds::open_app_dir()),
        "restart_clash" => feat::restart_clash_core(),
        "restart_app" => tauri::process::restart(&app_handle.env()),
        "quit" => cmds::exit_app(app_handle.clone()),
        _ => {}
    }
}
