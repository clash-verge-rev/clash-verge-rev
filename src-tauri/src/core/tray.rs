use super::handle;
use crate::{
    APP_VERSION, cmds,
    config::{Config, IProfiles},
    feat,
    utils::{dirs, resolve},
};
use anyhow::{Result, bail};
use rust_i18n::t;
use tauri::{
    AppHandle, Runtime,
    image::Image,
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};

pub const TRAY_ID: &str = "verge_tray";

pub struct Tray;

impl Tray {
    fn get_tray_icon() -> Image<'static> {
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

        match (sysproxy_enabled, tun_enabled) {
            (_, true) => {
                if tun_tray_icon {
                    let mut icon_path = icon_dir_path.join("tun.ico");
                    if !icon_path.exists() {
                        icon_path = icon_dir_path.join("tun.png");
                    }
                    // Icon::File(icon_path)
                    Image::from_path(icon_path).unwrap()
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
                    // Icon::Raw(icon)
                    Image::from_bytes(&icon).unwrap()
                }
            }
            (true, _) => {
                if sysproxy_tray_icon {
                    let mut icon_path = icon_dir_path.join("sysproxy.ico");
                    if !icon_path.exists() {
                        icon_path = icon_dir_path.join("sysproxy.png");
                    }
                    // Icon::File(icon_path)
                    Image::from_path(icon_path).unwrap()
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
                    // Icon::Raw(icon)
                    Image::from_bytes(&icon).unwrap()
                }
            }
            _ => {
                if common_tray_icon {
                    let mut icon_path = icon_dir_path.join("common.ico");
                    if !icon_path.exists() {
                        icon_path = icon_dir_path.join("common.png");
                    }
                    // Icon::File(icon_path)
                    Image::from_path(icon_path).unwrap()
                } else {
                    #[cfg(target_os = "macos")]
                    let icon = match tray_icon.as_str() {
                        "monochrome" => include_bytes!("../../icons/tray-icon-mono.ico").to_vec(),
                        "colorful" => include_bytes!("../../icons/tray-icon.ico").to_vec(),
                        _ => include_bytes!("../../icons/tray-icon-mono.ico").to_vec(),
                    };
                    #[cfg(not(target_os = "macos"))]
                    let icon = include_bytes!("../../icons/tray-icon.png").to_vec();
                    // Icon::Raw(icon)
                    Image::from_bytes(&icon).unwrap()
                }
            }
        }
    }

    pub fn tray_menu<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Menu<R>> {
        let version = APP_VERSION.get().unwrap();
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let current = profiles.get_current().unwrap_or_default();
        let profiles = profiles.get_profiles();
        let mut switch_menu = SubmenuBuilder::new(app_handle, t!("profiles.switch"));
        for profile in profiles {
            let uid = profile.uid.unwrap();
            let name = profile.name.unwrap();
            if current == uid {
                let checkmenu =
                    CheckMenuItem::with_id(app_handle, uid, name, true, true, None::<&str>)?;
                switch_menu = switch_menu.item(&checkmenu);
            } else {
                let checkmenu =
                    CheckMenuItem::with_id(app_handle, uid, name, true, false, None::<&str>)?;
                switch_menu = switch_menu.item(&checkmenu);
            }
        }

        let menu = MenuBuilder::new(app_handle)
            .text("open_window", t!("dashboard"))
            .separator()
            .check("rule_mode", t!("mode.rule"))
            .check("global_mode", t!("mode.global"))
            .check("direct_mode", t!("mode.direct"))
            .separator()
            .check("system_proxy", t!("proxy.system"))
            .check("tun_mode", t!("proxy.tun"))
            .separator()
            .item(&switch_menu.build()?)
            .separator()
            .check("service_mode", t!("service"))
            .separator()
            .text("copy_env", t!("copy.env"))
            .item(
                &SubmenuBuilder::new(app_handle, t!("open.dir"))
                    .text("open_app_dir", t!("app.dir"))
                    .text("open_core_dir", t!("core.dir"))
                    .text("open_logs_dir", t!("log.dir"))
                    .build()?,
            )
            .item(
                &SubmenuBuilder::new(app_handle, t!("more"))
                    .text("open_devtools", t!("open.devtools"))
                    .text("restart_clash", t!("restart.clash"))
                    .text("restart_app", t!("restart"))
                    .item(
                        &MenuItemBuilder::new(format!("Version: {version}"))
                            .enabled(false)
                            .build(app_handle)?,
                    )
                    // .text("app_version", format!("Version: {}", version))
                    .build()?,
            )
            .separator()
            .text("quit", t!("quit"));

        Ok(menu.build()?)
    }

    pub fn init() -> Result<()> {
        let app_handle = handle::Handle::get_app_handle();
        let menu = Self::tray_menu(app_handle)?;
        let tray = TrayIconBuilder::with_id(TRAY_ID)
            .icon(Self::get_tray_icon())
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_tray_icon_event(Self::on_click)
            .on_menu_event(Self::on_system_tray_event)
            .build(app_handle)?;
        #[cfg(target_os = "macos")]
        tray.set_icon_as_template(true)?;

        let enable_tray = { Config::verge().latest().enable_tray.unwrap_or(true) };
        if !enable_tray {
            tray.set_visible(false)?;
        }
        Self::update_systray(app_handle)?;
        Ok(())
    }

    /// There is some bug in Linux: Tray cannot be created when opening then hiding then reopening it by clicking the switch button
    pub fn set_tray_visible(app_handle: &AppHandle, visible: bool) -> Result<()> {
        match app_handle.tray_by_id(TRAY_ID) {
            Some(tray) => {
                tray.set_visible(visible)?;
                Ok(())
            }
            None => {
                bail!("set tray visible failed, because tray not found")
            }
        }
    }

    pub fn update_systray(app_handle: &AppHandle) -> Result<()> {
        let enable_tray = { Config::verge().latest().enable_tray.unwrap_or(true) };
        if enable_tray {
            Self::update_part(app_handle)?;
        }
        Ok(())
    }

    pub fn update_part<R: Runtime>(app_handle: &AppHandle<R>) -> Result<()> {
        let verge = Config::verge().latest().clone();
        let enable_tray = verge.enable_tray.unwrap_or(true);
        if !enable_tray {
            return Ok(());
        }
        let clash = Config::clash().latest().clone();
        let mode = clash.get_mode();
        let sysproxy_enabled = verge.enable_system_proxy.unwrap_or(false);
        let tun_enabled = clash.get_enable_tun();
        let service_enabled = verge.enable_service_mode.unwrap_or(false);

        let tray = app_handle.tray_by_id(TRAY_ID).expect("tray not found");
        let menu = Self::tray_menu(app_handle)?;

        let _ = menu
            .get("rule_mode")
            .and_then(|item| item.as_check_menuitem()?.set_checked(mode == "rule").ok());
        let _ = menu
            .get("global_mode")
            .and_then(|item| item.as_check_menuitem()?.set_checked(mode == "global").ok());
        let _ = menu
            .get("direct_mode")
            .and_then(|item| item.as_check_menuitem()?.set_checked(mode == "direct").ok());

        let _ = menu
            .get("system_proxy")
            .and_then(|item| item.as_check_menuitem()?.set_checked(sysproxy_enabled).ok());

        let _ = menu
            .get("tun_mode")
            .and_then(|item| item.as_check_menuitem()?.set_checked(tun_enabled).ok());

        let _ = menu
            .get("service_mode")
            .and_then(|item| item.as_check_menuitem()?.set_checked(service_enabled).ok());

        tray.set_menu(Some(menu))?;

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
        tray.set_icon(Some(Self::get_tray_icon()))?;

        #[cfg(not(target_os = "linux"))]
        {
            let version = app_handle.package_info().version.to_string();
            let mut current_profile_name = "None".to_string();
            let profiles = Config::profiles().latest().clone();
            if let Some(current_profile_uid) = profiles.get_current()
                && let Ok(current_profile) = profiles.get_item(&current_profile_uid)
                && let Some(profile_name) = &current_profile.name
            {
                current_profile_name = profile_name.to_string();
            };
            let switch_map = |status| {
                if status { "ON" } else { "OFF" }
            };
            tray.set_tooltip(Some(&format!(
                "Clash Verge {version}\n{}: {}\n{}: {}\n{}: {}",
                t!("proxy.system"),
                switch_map(sysproxy_enabled),
                t!("proxy.tun"),
                switch_map(tun_enabled),
                t!("current.profile"),
                current_profile_name
            )))?;
        }
        Ok(())
    }

    pub fn on_click(_tray: &TrayIcon, event: TrayIconEvent) {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            let tray_event = Config::verge().latest().tray_event.clone();
            let tray_event = tray_event.unwrap_or("main_window".into());
            match tray_event.as_str() {
                "system_proxy" => feat::toggle_system_proxy(),
                "service_mode" => feat::toggle_service_mode(),
                "tun_mode" => feat::toggle_tun_mode(),
                "main_window" => resolve::create_window(),
                _ => {}
            }
        }
    }

    pub fn on_system_tray_event(app_handle: &AppHandle, event: MenuEvent) {
        let app_handle_ = app_handle.clone();
        let config_profiles = Config::profiles().latest().clone();
        let profiles = config_profiles.get_profiles();
        let profile_uids = profiles
            .iter()
            .map(|item| item.uid.clone().unwrap_or_default())
            .collect::<Vec<String>>();
        match event.id.as_ref() {
            mode @ ("rule_mode" | "global_mode" | "direct_mode") => {
                let mode = &mode[0..mode.len() - 5];
                feat::change_clash_mode(mode.into());
            }
            "open_window" => resolve::create_window(),
            "system_proxy" => feat::toggle_system_proxy(),
            "tun_mode" => feat::toggle_tun_mode(),
            profile if profile_uids.contains(&profile.to_string()) => {
                let clicked_profile = profile.to_string();
                let current = config_profiles.get_current().unwrap_or_default();
                if current != clicked_profile {
                    tauri::async_runtime::spawn(async move {
                        match cmds::profile::patch_profiles_config(IProfiles {
                            current: Some(clicked_profile),
                            chain: None,
                            items: None,
                        })
                        .await
                        {
                            Ok(_) => {
                                let _ = handle::Handle::notification(
                                    t!("profiles.switch"),
                                    t!("profiles.switch.success"),
                                );
                                handle::Handle::refresh_profiles();
                                tracing::info!("switch profile successfully");
                            }
                            Err(e) => {
                                let _ = handle::Handle::notification(
                                    t!("profiles.switch"),
                                    t!("profiles.switch.failed"),
                                );
                                tracing::error!("failed to switch profile, error: {:?}", e);
                            }
                        }
                    });
                } else {
                    let _ = Self::update_systray(app_handle);
                }
            }
            "service_mode" => feat::toggle_service_mode(),
            "copy_env" => feat::copy_clash_env(app_handle),
            "open_app_dir" => crate::log_err!(cmds::common::open_app_dir(app_handle_)),
            "open_core_dir" => crate::log_err!(cmds::common::open_core_dir(app_handle_)),
            "open_logs_dir" => crate::log_err!(cmds::common::open_logs_dir(app_handle_)),
            "open_devtools" => crate::log_err!(cmds::common::open_devtools(app_handle_)),
            "restart_clash" => feat::restart_clash_core(),
            "restart_app" => cmds::common::restart_app(app_handle_),
            "quit" => cmds::common::exit_app(app_handle_),
            _ => {}
        }
    }
}
