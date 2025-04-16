use once_cell::sync::OnceCell;
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "macos")]
pub mod speed_rate;
use crate::{
    cmd,
    config::Config,
    feat,
    module::{lightweight::entry_lightweight_mode, mihomo::Rate},
    process::AsyncHandler,
    resolve,
    utils::{dirs::find_target_icons, i18n::t, logging::Type, resolve::VERSION},
};

use anyhow::Result;
#[cfg(target_os = "macos")]
use futures::StreamExt;
#[cfg(target_os = "macos")]
use parking_lot::Mutex;
#[cfg(target_os = "macos")]
use parking_lot::RwLock;
#[cfg(target_os = "macos")]
pub use speed_rate::{SpeedRate, Traffic};
use std::fs;
#[cfg(target_os = "macos")]
use std::sync::Arc;
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    App, AppHandle, Wry,
};
#[cfg(target_os = "macos")]
use tokio::sync::broadcast;

use super::handle;

#[derive(Clone)]
struct TrayState {}

#[cfg(target_os = "macos")]
pub struct Tray {
    pub speed_rate: Arc<Mutex<Option<SpeedRate>>>,
    shutdown_tx: Arc<RwLock<Option<broadcast::Sender<()>>>>,
    is_subscribed: Arc<RwLock<bool>>,
    pub rate_cache: Arc<Mutex<Option<Rate>>>,
}

#[cfg(not(target_os = "macos"))]
pub struct Tray {}

impl TrayState {
    pub fn get_common_tray_icon() -> (bool, Vec<u8>) {
        let verge = Config::verge().latest().clone();
        let is_common_tray_icon = verge.common_tray_icon.unwrap_or(false);
        if is_common_tray_icon {
            if let Some(common_icon_path) = find_target_icons("common").unwrap() {
                let icon_data = fs::read(common_icon_path).unwrap();
                return (true, icon_data);
            }
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.unwrap_or("monochrome".to_string());
            if tray_icon_colorful == "monochrome" {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-mono.ico").to_vec(),
                )
            } else {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon.ico").to_vec(),
                )
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            (
                false,
                include_bytes!("../../../icons/tray-icon.ico").to_vec(),
            )
        }
    }

    pub fn get_sysproxy_tray_icon() -> (bool, Vec<u8>) {
        let verge = Config::verge().latest().clone();
        let is_sysproxy_tray_icon = verge.sysproxy_tray_icon.unwrap_or(false);
        if is_sysproxy_tray_icon {
            if let Some(sysproxy_icon_path) = find_target_icons("sysproxy").unwrap() {
                let icon_data = fs::read(sysproxy_icon_path).unwrap();
                return (true, icon_data);
            }
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.clone().unwrap_or("monochrome".to_string());
            if tray_icon_colorful == "monochrome" {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-sys-mono.ico").to_vec(),
                )
            } else {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-sys.ico").to_vec(),
                )
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            (
                false,
                include_bytes!("../../../icons/tray-icon-sys.ico").to_vec(),
            )
        }
    }

    pub fn get_tun_tray_icon() -> (bool, Vec<u8>) {
        let verge = Config::verge().latest().clone();
        let is_tun_tray_icon = verge.tun_tray_icon.unwrap_or(false);
        if is_tun_tray_icon {
            if let Some(tun_icon_path) = find_target_icons("tun").unwrap() {
                let icon_data = fs::read(tun_icon_path).unwrap();
                return (true, icon_data);
            }
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.clone().unwrap_or("monochrome".to_string());
            if tray_icon_colorful == "monochrome" {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-tun-mono.ico").to_vec(),
                )
            } else {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-tun.ico").to_vec(),
                )
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            (
                false,
                include_bytes!("../../../icons/tray-icon-tun.ico").to_vec(),
            )
        }
    }
}

impl Tray {
    pub fn global() -> &'static Tray {
        static TRAY: OnceCell<Tray> = OnceCell::new();

        #[cfg(target_os = "macos")]
        return TRAY.get_or_init(|| Tray {
            speed_rate: Arc::new(Mutex::new(None)),
            shutdown_tx: Arc::new(RwLock::new(None)),
            is_subscribed: Arc::new(RwLock::new(false)),
            rate_cache: Arc::new(Mutex::new(None)),
        });

        #[cfg(not(target_os = "macos"))]
        return TRAY.get_or_init(|| Tray {});
    }

    pub fn init(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            let mut speed_rate = self.speed_rate.lock();
            *speed_rate = Some(SpeedRate::new());
        }
        Ok(())
    }

    pub fn create_systray(&self, app: &App) -> Result<()> {
        let mut builder = TrayIconBuilder::with_id("main")
            .icon(app.default_window_icon().unwrap().clone())
            .icon_as_template(false);

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let tray_event = { Config::verge().latest().tray_event.clone() };
            let tray_event: String = tray_event.unwrap_or("main_window".into());
            if tray_event.as_str() != "tray_menu" {
                builder = builder.show_menu_on_left_click(false);
            }
        }

        let tray = builder.build(app)?;

        tray.on_tray_icon_event(|_, event| {
            let tray_event = { Config::verge().latest().tray_event.clone() };
            let tray_event: String = tray_event.unwrap_or("main_window".into());
            log::debug!(target: "app","tray event: {:?}", tray_event);

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Down,
                ..
            } = event
            {
                match tray_event.as_str() {
                    "system_proxy" => feat::toggle_system_proxy(),
                    "tun_mode" => feat::toggle_tun_mode(None),
                    "main_window" => resolve::create_window(true),
                    _ => {}
                }
            }
        });
        tray.on_menu_event(on_menu_event);
        Ok(())
    }

    /// 更新托盘点击行为
    pub fn update_click_behavior(&self) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let tray_event = { Config::verge().latest().tray_event.clone() };
        let tray_event: String = tray_event.unwrap_or("main_window".into());
        let tray = app_handle.tray_by_id("main").unwrap();
        match tray_event.as_str() {
            "tray_menu" => tray.set_show_menu_on_left_click(true)?,
            _ => tray.set_show_menu_on_left_click(false)?,
        }
        Ok(())
    }

    /// 更新托盘菜单
    pub fn update_menu(&self) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let verge = Config::verge().latest().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);
        let mode = {
            Config::clash()
                .latest()
                .0
                .get("mode")
                .map(|val| val.as_str().unwrap_or("rule"))
                .unwrap_or("rule")
                .to_owned()
        };
        let profile_uid_and_name = Config::profiles()
            .data()
            .all_profile_uid_and_name()
            .unwrap_or_default();

        let tray = app_handle.tray_by_id("main").unwrap();
        let _ = tray.set_menu(Some(create_tray_menu(
            &app_handle,
            Some(mode.as_str()),
            *system_proxy,
            *tun_mode,
            profile_uid_and_name,
        )?));
        Ok(())
    }

    /// 更新托盘图标
    pub fn update_icon(&self, rate: Option<Rate>) -> Result<()> {
        let verge = Config::verge().latest().clone();
        let system_mode = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let app_handle = handle::Handle::global().app_handle().unwrap();
        let tray = app_handle.tray_by_id("main").unwrap();

        let (is_custom_icon, icon_bytes) = match (*system_mode, *tun_mode) {
            (true, true) => TrayState::get_tun_tray_icon(),
            (true, false) => TrayState::get_sysproxy_tray_icon(),
            (false, true) => TrayState::get_tun_tray_icon(),
            (false, false) => TrayState::get_common_tray_icon(),
        };
        #[cfg(target_os = "macos")]
        {
            let enable_tray_speed = verge.enable_tray_speed.unwrap_or(true);
            let enable_tray_icon = verge.enable_tray_icon.unwrap_or(true);
            let colorful = verge.tray_icon.clone().unwrap_or("monochrome".to_string());
            let is_colorful = colorful == "colorful";

            if !enable_tray_speed {
                let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));
                let _ = tray.set_icon_as_template(!is_colorful);
                return Ok(());
            }

            let rate = if let Some(rate) = rate {
                Some(rate)
            } else {
                let guard = self.speed_rate.lock();
                if let Some(rate) = guard.as_ref().unwrap().get_curent_rate() {
                    Some(rate)
                } else {
                    Some(Rate::default())
                }
            };

            let mut rate_guard = self.rate_cache.lock();
            if *rate_guard != rate {
                *rate_guard = rate;

                let bytes = if enable_tray_icon {
                    Some(icon_bytes)
                } else {
                    None
                };

                let rate = rate_guard.as_ref();
                let rate_bytes = SpeedRate::add_speed_text(is_custom_icon, bytes, rate).unwrap();
                let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&rate_bytes)?));
                let _ = tray.set_icon_as_template(!is_custom_icon && !is_colorful);
            }
            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));
            Ok(())
        }
    }

    /// 更新托盘提示
    pub fn update_tooltip(&self) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let version = VERSION.get().unwrap();

        let verge = Config::verge().latest().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

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

        let tray = app_handle.tray_by_id("main").unwrap();
        let _ = tray.set_tooltip(Some(&format!(
            "Clash Max {version}\n{}: {}\n{}: {}\n{}: {}",
            t("SysProxy"),
            switch_map[system_proxy],
            t("TUN"),
            switch_map[tun_mode],
            t("Profile"),
            current_profile_name
        )));
        Ok(())
    }

    pub fn update_part(&self) -> Result<()> {
        self.update_menu()?;
        self.update_icon(None)?;
        self.update_tooltip()?;
        Ok(())
    }

    /// 订阅流量数据
    #[cfg(target_os = "macos")]
    pub async fn subscribe_traffic(&self) -> Result<()> {
        log::info!(target: "app", "subscribe traffic");

        // 如果已经订阅，先取消订阅
        if *self.is_subscribed.read() {
            self.unsubscribe_traffic();
        }

        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        *self.shutdown_tx.write() = Some(shutdown_tx);
        *self.is_subscribed.write() = true;

        let speed_rate = Arc::clone(&self.speed_rate);
        let is_subscribed = Arc::clone(&self.is_subscribed);

        AsyncHandler::spawn(move || {
            let mut shutdown = shutdown_rx;
            let speed_rate = speed_rate.clone(); // 确保 Arc 被正确克隆
            let is_subscribed = is_subscribed.clone();

            Box::pin(async move {
                'outer: loop {
                    match Traffic::get_traffic_stream().await {
                        Ok(mut stream) => loop {
                            tokio::select! {
                                Some(traffic) = stream.next() => {
                                    if let Ok(traffic) = traffic {
                                        let guard = speed_rate.lock();
                                        let enable_tray_speed: bool = Config::verge()
                                            .latest()
                                            .enable_tray_speed
                                            .unwrap_or(true);
                                        if !enable_tray_speed {
                                            continue;
                                        }
                                        if let Some(sr) = guard.as_ref() {
                                            if let Some(rate) = sr.update_and_check_changed(traffic.up, traffic.down) {
                                                let _ = Tray::global().update_icon(Some(rate));
                                            }
                                        }
                                    }
                                }
                                _ = shutdown.recv() => break 'outer,
                            }
                        },
                        Err(e) => {
                            log::error!(target: "app", "Failed to get traffic stream: {}", e);
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            if !*is_subscribed.read() {
                                break;
                            }
                        }
                    }
                }
            })
        });

        Ok(())
    }

    /// 取消订阅 traffic 数据
    #[cfg(target_os = "macos")]
    pub fn unsubscribe_traffic(&self) {
        log::info!(target: "app", "unsubscribe traffic");
        *self.is_subscribed.write() = false;
        if let Some(tx) = self.shutdown_tx.write().take() {
            drop(tx);
        }
    }
}

fn create_tray_menu(
    app_handle: &AppHandle,
    mode: Option<&str>,
    system_proxy_enabled: bool,
    tun_mode_enabled: bool,
    profile_uid_and_name: Vec<(String, String)>,
) -> Result<tauri::menu::Menu<Wry>> {
    let mode = mode.unwrap_or("");
    let version = VERSION.get().unwrap();
    let hotkeys = Config::verge()
        .latest()
        .hotkeys
        .as_ref()
        .map(|h| {
            h.iter()
                .filter_map(|item| {
                    let mut parts = item.split(',');
                    match (parts.next(), parts.next()) {
                        (Some(func), Some(key)) => Some((func.to_string(), key.to_string())),
                        _ => None,
                    }
                })
                .collect::<std::collections::HashMap<String, String>>()
        })
        .unwrap_or_default();

    let profile_menu_items: Vec<CheckMenuItem<Wry>> = profile_uid_and_name
        .iter()
        .map(|(profile_uid, profile_name)| {
            let is_current_profile = Config::profiles()
                .data()
                .is_current_profile_index(profile_uid.to_string());
            CheckMenuItem::with_id(
                app_handle,
                format!("profiles_{}", profile_uid),
                t(profile_name),
                true,
                is_current_profile,
                None::<&str>,
            )
            .unwrap()
        })
        .collect();
    let profile_menu_items: Vec<&dyn IsMenuItem<Wry>> = profile_menu_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<Wry>)
        .collect();

    let open_window = &MenuItem::with_id(
        app_handle,
        "open_window",
        t("Dashboard"),
        true,
        hotkeys.get("open_or_close_dashboard").map(|s| s.as_str()),
    )
    .unwrap();

    let rule_mode = &CheckMenuItem::with_id(
        app_handle,
        "rule_mode",
        t("Rule Mode"),
        true,
        mode == "rule",
        hotkeys.get("clash_mode_rule").map(|s| s.as_str()),
    )
    .unwrap();

    let global_mode = &CheckMenuItem::with_id(
        app_handle,
        "global_mode",
        t("Global Mode"),
        true,
        mode == "global",
        hotkeys.get("clash_mode_global").map(|s| s.as_str()),
    )
    .unwrap();

    let direct_mode = &CheckMenuItem::with_id(
        app_handle,
        "direct_mode",
        t("Direct Mode"),
        true,
        mode == "direct",
        hotkeys.get("clash_mode_direct").map(|s| s.as_str()),
    )
    .unwrap();

    let profiles = &Submenu::with_id_and_items(
        app_handle,
        "profiles",
        t("Profiles"),
        true,
        &profile_menu_items,
    )
    .unwrap();

    let system_proxy = &CheckMenuItem::with_id(
        app_handle,
        "system_proxy",
        t("System Proxy"),
        true,
        system_proxy_enabled,
        hotkeys.get("toggle_system_proxy").map(|s| s.as_str()),
    )
    .unwrap();

    let tun_mode = &CheckMenuItem::with_id(
        app_handle,
        "tun_mode",
        t("TUN Mode"),
        true,
        tun_mode_enabled,
        hotkeys.get("toggle_tun_mode").map(|s| s.as_str()),
    )
    .unwrap();

    let lighteweight_mode = &MenuItem::with_id(
        app_handle,
        "entry_lightweight_mode",
        t("LightWeight Mode"),
        true,
        hotkeys.get("entry_lightweight_mode").map(|s| s.as_str()),
    )
    .unwrap();

    let copy_env =
        &MenuItem::with_id(app_handle, "copy_env", t("Copy Env"), true, None::<&str>).unwrap();

    let open_app_dir = &MenuItem::with_id(
        app_handle,
        "open_app_dir",
        t("Conf Dir"),
        true,
        None::<&str>,
    )
    .unwrap();

    let open_core_dir = &MenuItem::with_id(
        app_handle,
        "open_core_dir",
        t("Core Dir"),
        true,
        None::<&str>,
    )
    .unwrap();

    let open_logs_dir = &MenuItem::with_id(
        app_handle,
        "open_logs_dir",
        t("Logs Dir"),
        true,
        None::<&str>,
    )
    .unwrap();

    let open_dir = &Submenu::with_id_and_items(
        app_handle,
        "open_dir",
        t("Open Dir"),
        true,
        &[open_app_dir, open_core_dir, open_logs_dir],
    )
    .unwrap();

    let restart_clash = &MenuItem::with_id(
        app_handle,
        "restart_clash",
        t("Restart Clash Core"),
        true,
        None::<&str>,
    )
    .unwrap();

    let restart_app = &MenuItem::with_id(
        app_handle,
        "restart_app",
        t("Restart App"),
        true,
        None::<&str>,
    )
    .unwrap();

    let app_version = &MenuItem::with_id(
        app_handle,
        "app_version",
        format!("{} {version}", t("Max Version")),
        true,
        None::<&str>,
    )
    .unwrap();

    let more = &Submenu::with_id_and_items(
        app_handle,
        "more",
        t("More"),
        true,
        &[restart_clash, restart_app, app_version],
    )
    .unwrap();

    let quit =
        &MenuItem::with_id(app_handle, "quit", t("Exit"), true, Some("CmdOrControl+Q")).unwrap();

    let separator = &PredefinedMenuItem::separator(app_handle).unwrap();

    let menu = tauri::menu::MenuBuilder::new(app_handle)
        .items(&[
            open_window,
            separator,
            rule_mode,
            global_mode,
            direct_mode,
            separator,
            profiles,
            separator,
            system_proxy,
            tun_mode,
            separator,
            lighteweight_mode,
            copy_env,
            open_dir,
            more,
            separator,
            quit,
        ])
        .build()
        .unwrap();
    Ok(menu)
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        mode @ ("rule_mode" | "global_mode" | "direct_mode") => {
            let mode = &mode[0..mode.len() - 5];
            println!("change mode to: {}", mode);
            feat::change_clash_mode(mode.into());
        }
        "open_window" => resolve::create_window(true),
        "system_proxy" => feat::toggle_system_proxy(),
        "tun_mode" => feat::toggle_tun_mode(None),
        "copy_env" => feat::copy_clash_env(),
        "open_app_dir" => crate::logging_error!(Type::Cmd, true, cmd::open_app_dir()),
        "open_core_dir" => crate::logging_error!(Type::Cmd, true, cmd::open_core_dir()),
        "open_logs_dir" => crate::logging_error!(Type::Cmd, true, cmd::open_logs_dir()),
        "restart_clash" => feat::restart_clash_core(),
        "restart_app" => feat::restart_app(),
        "entry_lightweight_mode" => entry_lightweight_mode(),
        "quit" => {
            feat::quit();
        }
        id if id.starts_with("profiles_") => {
            let profile_index = &id["profiles_".len()..];
            feat::toggle_proxy_profile(profile_index.into());
        }
        _ => {}
    }
}
