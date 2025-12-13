use once_cell::sync::OnceCell;
use tauri::tray::TrayIconBuilder;
use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;
use tauri_plugin_mihomo::models::Proxies;
use tokio::fs;
#[cfg(target_os = "macos")]
pub mod speed_rate;
use crate::config::{IProfilePreview, IVerge};
use crate::core::service;
use crate::module::lightweight;
use crate::process::AsyncHandler;
use crate::singleton;
use crate::utils::window_manager::WindowManager;
use crate::{
    Type, cmd,
    config::Config,
    feat, logging,
    module::lightweight::is_in_lightweight_mode,
    utils::{dirs::find_target_icons, i18n},
};

use super::handle;
use anyhow::Result;
use parking_lot::Mutex;
use smartstring::alias::String;
use std::collections::HashMap;
use std::sync::Arc;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Wry,
    menu::{CheckMenuItem, IsMenuItem, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
};
mod menu_def;
use menu_def::{MenuIds, MenuTexts};

// TODO: 是否需要将可变菜单抽离存储起来，后续直接更新对应菜单实例，无需重新创建菜单(待考虑)

type ProxyMenuItem = (Option<Submenu<Wry>>, Vec<Box<dyn IsMenuItem<Wry>>>);

#[derive(Clone)]
struct TrayState {}

// 托盘点击防抖机制
static TRAY_CLICK_DEBOUNCE: OnceCell<Mutex<Instant>> = OnceCell::new();
const TRAY_CLICK_DEBOUNCE_MS: u64 = 300;

fn get_tray_click_debounce() -> &'static Mutex<Instant> {
    TRAY_CLICK_DEBOUNCE.get_or_init(|| Mutex::new(Instant::now() - Duration::from_secs(1)))
}

fn should_handle_tray_click() -> bool {
    let debounce_lock = get_tray_click_debounce();
    let now = Instant::now();

    if now.duration_since(*debounce_lock.lock()) >= Duration::from_millis(TRAY_CLICK_DEBOUNCE_MS) {
        *debounce_lock.lock() = now;
        true
    } else {
        logging!(
            debug,
            Type::Tray,
            "托盘点击被防抖机制忽略，距离上次点击 {}ms",
            now.duration_since(*debounce_lock.lock()).as_millis()
        );
        false
    }
}

#[cfg(target_os = "macos")]
pub struct Tray {
    last_menu_update: Mutex<Option<Instant>>,
    menu_updating: AtomicBool,
}

#[cfg(not(target_os = "macos"))]
pub struct Tray {
    last_menu_update: Mutex<Option<Instant>>,
    menu_updating: AtomicBool,
}

impl TrayState {
    async fn get_common_tray_icon(verge: &IVerge) -> (bool, Vec<u8>) {
        let is_common_tray_icon = verge.common_tray_icon.unwrap_or(false);
        if is_common_tray_icon
            && let Ok(Some(common_icon_path)) = find_target_icons("common")
            && let Ok(icon_data) = fs::read(common_icon_path).await
        {
            return (true, icon_data);
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.clone().unwrap_or_else(|| "monochrome".into());
            if tray_icon_colorful == "monochrome" {
                (false, include_bytes!("../../../icons/tray-icon-mono.ico").to_vec())
            } else {
                (false, include_bytes!("../../../icons/tray-icon.ico").to_vec())
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            (false, include_bytes!("../../../icons/tray-icon.ico").to_vec())
        }
    }

    async fn get_sysproxy_tray_icon(verge: &IVerge) -> (bool, Vec<u8>) {
        let is_sysproxy_tray_icon = verge.sysproxy_tray_icon.unwrap_or(false);
        if is_sysproxy_tray_icon
            && let Ok(Some(sysproxy_icon_path)) = find_target_icons("sysproxy")
            && let Ok(icon_data) = fs::read(sysproxy_icon_path).await
        {
            return (true, icon_data);
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.clone().unwrap_or_else(|| "monochrome".into());
            if tray_icon_colorful == "monochrome" {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-sys-mono-new.ico").to_vec(),
                )
            } else {
                (false, include_bytes!("../../../icons/tray-icon-sys.ico").to_vec())
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            (false, include_bytes!("../../../icons/tray-icon-sys.ico").to_vec())
        }
    }

    async fn get_tun_tray_icon(verge: &IVerge) -> (bool, Vec<u8>) {
        let is_tun_tray_icon = verge.tun_tray_icon.unwrap_or(false);
        if is_tun_tray_icon
            && let Ok(Some(tun_icon_path)) = find_target_icons("tun")
            && let Ok(icon_data) = fs::read(tun_icon_path).await
        {
            return (true, icon_data);
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.clone().unwrap_or_else(|| "monochrome".into());
            if tray_icon_colorful == "monochrome" {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-tun-mono-new.ico").to_vec(),
                )
            } else {
                (false, include_bytes!("../../../icons/tray-icon-tun.ico").to_vec())
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            (false, include_bytes!("../../../icons/tray-icon-tun.ico").to_vec())
        }
    }
}

impl Default for Tray {
    fn default() -> Self {
        Self {
            last_menu_update: Mutex::new(None),
            menu_updating: AtomicBool::new(false),
        }
    }
}

singleton!(Tray, TRAY);

impl Tray {
    fn new() -> Self {
        Self::default()
    }

    pub async fn init(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘初始化");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        match self.create_tray_from_handle(app_handle).await {
            Ok(_) => {
                logging!(info, Type::Tray, "System tray created successfully");
            }
            Err(e) => {
                // Don't return error, let application continue running without tray
                logging!(
                    warn,
                    Type::Tray,
                    "System tray creation failed: {e}, Application will continue running without tray icon",
                );
            }
        }
        Ok(())
    }

    /// 更新托盘点击行为
    pub async fn update_click_behavior(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘点击行为更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();
        let tray_event = { Config::verge().await.latest_arc().tray_event.clone() };
        let tray_event = tray_event.unwrap_or_else(|| "main_window".into());
        let tray = app_handle
            .tray_by_id("main")
            .ok_or_else(|| anyhow::anyhow!("Failed to get main tray"))?;
        match tray_event.as_str() {
            "tray_menu" => tray.set_show_menu_on_left_click(true)?,
            _ => tray.set_show_menu_on_left_click(false)?,
        }
        Ok(())
    }

    /// 更新托盘菜单
    pub async fn update_menu(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘菜单更新");
            return Ok(());
        }
        // 调整最小更新间隔，确保状态及时刷新
        const MIN_UPDATE_INTERVAL: Duration = Duration::from_millis(100);

        // 检查是否正在更新
        if self.menu_updating.load(Ordering::Acquire) {
            return Ok(());
        }

        // 检查更新频率，但允许重要事件跳过频率限制
        let should_force_update = match std::thread::current().name() {
            Some("main") => true,
            _ => {
                let last_update = self.last_menu_update.lock();
                if let Some(last_time) = *last_update {
                    last_time.elapsed() >= MIN_UPDATE_INTERVAL
                } else {
                    true
                }
            }
        };

        if !should_force_update {
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        // 设置更新状态
        self.menu_updating.store(true, Ordering::Release);

        let result = self.update_menu_internal(app_handle).await;

        {
            let mut last_update = self.last_menu_update.lock();
            *last_update = Some(Instant::now());
        }
        self.menu_updating.store(false, Ordering::Release);

        result
    }

    async fn update_menu_internal(&self, app_handle: &AppHandle) -> Result<()> {
        let verge = Config::verge().await.latest_arc();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);
        let tun_mode_available =
            is_current_app_handle_admin(app_handle) || service::is_service_available().await.is_ok();
        let mode = {
            Config::clash()
                .await
                .latest_arc()
                .0
                .get("mode")
                .map(|val| val.as_str().unwrap_or("rule"))
                .unwrap_or("rule")
                .to_owned()
        };
        let profiles_config = Config::profiles().await;
        let profiles_arc = profiles_config.latest_arc();
        let profiles_preview = profiles_arc.profiles_preview().unwrap_or_default();
        let is_lightweight_mode = is_in_lightweight_mode();

        match app_handle.tray_by_id("main") {
            Some(tray) => {
                let _ = tray.set_menu(Some(
                    create_tray_menu(
                        app_handle,
                        Some(mode.as_str()),
                        *system_proxy,
                        *tun_mode,
                        tun_mode_available,
                        profiles_preview,
                        is_lightweight_mode,
                    )
                    .await?,
                ));
                logging!(debug, Type::Tray, "托盘菜单更新成功");
                Ok(())
            }
            None => {
                logging!(warn, Type::Tray, "Failed to update tray menu: tray not found");
                Ok(())
            }
        }
    }

    /// 更新托盘图标
    #[cfg(target_os = "macos")]
    pub async fn update_icon(&self, verge: &IVerge) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘图标更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let tray = match app_handle.tray_by_id("main") {
            Some(tray) => tray,
            None => {
                logging!(warn, Type::Tray, "Failed to update tray icon: tray not found");
                return Ok(());
            }
        };

        let system_mode = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let (_is_custom_icon, icon_bytes) = match (*system_mode, *tun_mode) {
            (true, true) => TrayState::get_tun_tray_icon(verge).await,
            (true, false) => TrayState::get_sysproxy_tray_icon(verge).await,
            (false, true) => TrayState::get_tun_tray_icon(verge).await,
            (false, false) => TrayState::get_common_tray_icon(verge).await,
        };

        let colorful = verge.tray_icon.clone().unwrap_or_else(|| "monochrome".into());
        let is_colorful = colorful == "colorful";

        let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));
        let _ = tray.set_icon_as_template(!is_colorful);
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn update_icon(&self, verge: &IVerge) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘图标更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let tray = match app_handle.tray_by_id("main") {
            Some(tray) => tray,
            None => {
                logging!(warn, Type::Tray, "Failed to update tray icon: tray not found");
                return Ok(());
            }
        };

        let system_mode = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let (_is_custom_icon, icon_bytes) = match (*system_mode, *tun_mode) {
            (true, true) => TrayState::get_tun_tray_icon(verge).await,
            (true, false) => TrayState::get_sysproxy_tray_icon(verge).await,
            (false, true) => TrayState::get_tun_tray_icon(verge).await,
            (false, false) => TrayState::get_common_tray_icon(verge).await,
        };

        let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));
        Ok(())
    }

    /// 更新托盘提示
    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘提示更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        i18n::sync_locale().await;

        let verge = Config::verge().await.latest_arc();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let switch_map = {
            let mut map = std::collections::HashMap::new();
            map.insert(true, "on");
            map.insert(false, "off");
            map
        };

        let mut current_profile_name = "None".into();
        {
            let profiles = Config::profiles().await;
            let profiles = profiles.latest_arc();
            if let Some(current_profile_uid) = profiles.get_current()
                && let Ok(profile) = profiles.get_item(current_profile_uid)
            {
                current_profile_name = match &profile.name {
                    Some(profile_name) => profile_name.to_string(),
                    None => current_profile_name,
                };
            }
        }

        // Get localized strings before using them
        let sys_proxy_text = rust_i18n::t!("tray.tooltip.systemProxy");
        let tun_text = rust_i18n::t!("tray.tooltip.tun");
        let profile_text = rust_i18n::t!("tray.tooltip.profile");

        let v = env!("CARGO_PKG_VERSION");
        let reassembled_version = v.split_once('+').map_or_else(
            || v.into(),
            |(main, rest)| format!("{main}+{}", rest.split('.').next().unwrap_or("")),
        );

        let tooltip = format!(
            "Clash Verge {}\n{}: {}\n{}: {}\n{}: {}",
            reassembled_version,
            sys_proxy_text,
            switch_map[system_proxy],
            tun_text,
            switch_map[tun_mode],
            profile_text,
            current_profile_name
        );

        if let Some(tray) = app_handle.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(&tooltip));
        } else {
            logging!(warn, Type::Tray, "Failed to update tray tooltip: tray not found");
        }

        Ok(())
    }

    pub async fn update_part(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘局部更新");
            return Ok(());
        }
        let verge = Config::verge().await.data_arc();
        self.update_menu().await?;
        self.update_icon(&verge).await?;
        self.update_tooltip().await?;
        Ok(())
    }

    async fn create_tray_from_handle(&self, app_handle: &AppHandle) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘创建");
            return Ok(());
        }

        logging!(info, Type::Tray, "正在从AppHandle创建系统托盘");

        let verge = Config::verge().await.data_arc();

        // 获取图标
        let icon_bytes = TrayState::get_common_tray_icon(&verge).await.1;
        let icon = tauri::image::Image::from_bytes(&icon_bytes)?;

        #[cfg(target_os = "linux")]
        let builder = TrayIconBuilder::with_id("main").icon(icon).icon_as_template(false);

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let show_menu_on_left_click = {
            // TODO 优化这里 复用 verge
            let tray_event = { Config::verge().await.latest_arc().tray_event.clone() };
            tray_event.is_some_and(|v| v == "tray_menu")
        };

        #[cfg(not(target_os = "linux"))]
        let mut builder = TrayIconBuilder::with_id("main").icon(icon).icon_as_template(false);
        #[cfg(target_os = "macos")]
        {
            let is_monochrome = verge.tray_icon.clone().is_none_or(|v| v == "monochrome");
            builder = builder.icon_as_template(is_monochrome);
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            if !show_menu_on_left_click {
                builder = builder.show_menu_on_left_click(false);
            }
        }

        let tray = builder.build(app_handle)?;

        tray.on_tray_icon_event(|_app_handle, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Down,
                ..
            } = event
            {
                // 添加防抖检查，防止快速连击
                if !should_handle_tray_click() {
                    logging!(info, Type::Tray, "click tray icon too fast, ignore");
                    return;
                }
                AsyncHandler::spawn(|| async move {
                    let tray_event = { Config::verge().await.latest_arc().tray_event.clone() };
                    let tray_event: String = tray_event.unwrap_or_else(|| "main_window".into());
                    logging!(debug, Type::Tray, "tray event: {tray_event:?}");

                    match tray_event.as_str() {
                        "system_proxy" => feat::toggle_system_proxy().await,
                        "tun_mode" => feat::toggle_tun_mode(None).await,
                        "main_window" => {
                            if !lightweight::exit_lightweight_mode().await {
                                WindowManager::show_main_window().await;
                            };
                        }
                        _ => {
                            logging!(warn, Type::Tray, "invalid tray event: {}", tray_event);
                        }
                    };
                });
            }
        });
        tray.on_menu_event(on_menu_event);
        Ok(())
    }
}

fn create_hotkeys(hotkeys: &Option<Vec<String>>) -> HashMap<String, String> {
    hotkeys
        .as_ref()
        .map(|h| {
            h.iter()
                .filter_map(|item| {
                    let mut parts = item.split(',');
                    match (parts.next(), parts.next()) {
                        (Some(func), Some(key)) => {
                            // 托盘菜单中的 `accelerator` 属性，在 Linux/Windows 中都不支持小键盘按键的解析
                            if key.to_uppercase().contains("NUMPAD") {
                                None
                            } else {
                                Some((func.into(), key.into()))
                            }
                        }
                        _ => None,
                    }
                })
                .collect::<std::collections::HashMap<String, String>>()
        })
        .unwrap_or_default()
}

fn create_profile_menu_item(
    app_handle: &AppHandle,
    profiles_preview: Vec<IProfilePreview<'_>>,
) -> Result<Vec<CheckMenuItem<Wry>>> {
    profiles_preview
        .into_iter()
        .map(|profile| {
            CheckMenuItem::with_id(
                app_handle,
                format!("profiles_{}", profile.uid),
                profile.name,
                true,
                profile.is_current,
                None::<&str>,
            )
            .map_err(|e| e.into())
        })
        .collect()
}

fn create_subcreate_proxy_menu_item(
    app_handle: &AppHandle,
    proxy_mode: &str,
    proxy_group_order_map: Option<HashMap<String, usize>>,
    proxy_nodes_data: Option<Proxies>,
) -> Vec<Submenu<Wry>> {
    let proxy_submenus: Vec<Submenu<Wry>> = {
        let mut submenus: Vec<(String, usize, Submenu<Wry>)> = Vec::new();

        // TODO: 应用启动时，内核还未启动完全，无法获取代理节点信息
        if let Some(proxy_nodes_data) = proxy_nodes_data {
            for (group_name, group_data) in proxy_nodes_data.proxies.iter() {
                // Filter groups based on mode and hidden flag
                let should_show = match proxy_mode {
                    "global" => group_name == "GLOBAL",
                    _ => group_name != "GLOBAL",
                } && !group_data.hidden.unwrap_or_default();

                if !should_show {
                    continue;
                }

                let Some(all_proxies) = group_data.all.as_ref() else {
                    continue;
                };

                let now_proxy = group_data.now.as_deref().unwrap_or_default();

                // Create proxy items
                let group_items: Vec<CheckMenuItem<Wry>> = all_proxies
                    .iter()
                    .filter_map(|proxy_str| {
                        let is_selected = *proxy_str == now_proxy;
                        let item_id = format!("proxy_{}_{}", group_name, proxy_str);

                        // Get delay for display
                        let delay_text = proxy_nodes_data
                            .proxies
                            .get(proxy_str)
                            .and_then(|h| h.history.last())
                            .map(|h| match h.delay {
                                0 => "-ms".into(),
                                delay if delay >= 10000 => "-ms".into(),
                                _ => format!("{}ms", h.delay),
                            })
                            .unwrap_or_else(|| "-ms".into());

                        let display_text = format!("{}   | {}", proxy_str, delay_text);

                        CheckMenuItem::with_id(app_handle, item_id, display_text, true, is_selected, None::<&str>)
                            .map_err(|e| logging!(warn, Type::Tray, "Failed to create proxy menu item: {}", e))
                            .ok()
                    })
                    .collect();

                if group_items.is_empty() {
                    continue;
                }

                let group_display_name = group_name.to_string();

                let group_items_refs: Vec<&dyn IsMenuItem<Wry>> =
                    group_items.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect();

                if let Ok(submenu) = Submenu::with_id_and_items(
                    app_handle,
                    format!("proxy_group_{}", group_name),
                    group_display_name,
                    true,
                    &group_items_refs,
                ) {
                    let insertion_index = submenus.len();
                    submenus.push((group_name.into(), insertion_index, submenu));
                } else {
                    logging!(warn, Type::Tray, "Failed to create proxy group submenu: {}", group_name);
                }
            }
        }

        if let Some(order_map) = proxy_group_order_map.as_ref() {
            submenus.sort_by(|(name_a, original_index_a, _), (name_b, original_index_b, _)| {
                match (order_map.get(name_a), order_map.get(name_b)) {
                    (Some(index_a), Some(index_b)) => index_a.cmp(index_b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => original_index_a.cmp(original_index_b),
                }
            });
        }

        submenus.into_iter().map(|(_, _, submenu)| submenu).collect()
    };
    proxy_submenus
}

fn create_proxy_menu_item(
    app_handle: &AppHandle,
    show_proxy_groups_inline: bool,
    proxy_submenus: Vec<Submenu<Wry>>,
    proxies_text: &Arc<str>,
) -> Result<ProxyMenuItem> {
    // 创建代理主菜单
    let (proxies_submenu, inline_proxy_items) = if show_proxy_groups_inline {
        (
            None,
            proxy_submenus
                .into_iter()
                .map(|submenu| Box::new(submenu) as Box<dyn IsMenuItem<Wry>>)
                .collect(),
        )
    } else if !proxy_submenus.is_empty() {
        let proxy_submenu_refs: Vec<&dyn IsMenuItem<Wry>> = proxy_submenus
            .iter()
            .map(|submenu| submenu as &dyn IsMenuItem<Wry>)
            .collect();

        (
            Some(Submenu::with_id_and_items(
                app_handle,
                MenuIds::PROXIES,
                proxies_text,
                true,
                &proxy_submenu_refs,
            )?),
            Vec::new(),
        )
    } else {
        (None, Vec::new())
    };
    Ok((proxies_submenu, inline_proxy_items))
}

async fn create_tray_menu(
    app_handle: &AppHandle,
    mode: Option<&str>,
    system_proxy_enabled: bool,
    tun_mode_enabled: bool,
    tun_mode_available: bool,
    profiles_preview: Vec<IProfilePreview<'_>>,
    is_lightweight_mode: bool,
) -> Result<tauri::menu::Menu<Wry>> {
    let current_proxy_mode = mode.unwrap_or("");

    i18n::sync_locale().await;

    // TODO: should update tray menu again when it was timeout error
    let proxy_nodes_data = tokio::time::timeout(
        Duration::from_millis(1000),
        handle::Handle::mihomo().await.get_proxies(),
    )
    .await
    .map_or(None, |res| res.ok());

    let runtime_proxy_groups_order = cmd::get_runtime_config()
        .await
        .map_err(|e| {
            logging!(
                error,
                Type::Cmd,
                "Failed to fetch runtime proxy groups for tray menu: {e}"
            );
        })
        .ok()
        .flatten()
        .map(|config| {
            config
                .get("proxy-groups")
                .and_then(|groups| groups.as_sequence())
                .map(|groups| {
                    groups
                        .iter()
                        .filter_map(|group| group.get("name"))
                        .filter_map(|name| name.as_str())
                        .map(|name| name.into())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_default()
        });

    let proxy_group_order_map: Option<HashMap<smartstring::SmartString<smartstring::LazyCompact>, usize>> =
        runtime_proxy_groups_order.as_ref().map(|group_names| {
            group_names
                .iter()
                .enumerate()
                .map(|(index, name)| (name.clone(), index))
                .collect::<HashMap<String, usize>>()
        });

    let verge_settings = Config::verge().await.latest_arc();
    let show_proxy_groups_inline = verge_settings.tray_inline_proxy_groups.unwrap_or(true);

    let version = env!("CARGO_PKG_VERSION");

    let hotkeys = create_hotkeys(&verge_settings.hotkeys);

    let profile_menu_items: Vec<CheckMenuItem<Wry>> = create_profile_menu_item(app_handle, profiles_preview)?;

    // Pre-fetch all localized strings
    let texts = MenuTexts::new();
    // Convert to references only when needed
    let profile_menu_items_refs: Vec<&dyn IsMenuItem<Wry>> = profile_menu_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<Wry>)
        .collect();

    let open_window = &MenuItem::with_id(
        app_handle,
        MenuIds::DASHBOARD,
        &texts.dashboard,
        true,
        hotkeys.get("open_or_close_dashboard").map(|s| s.as_str()),
    )?;

    let current_mode_text = match current_proxy_mode {
        "global" => rust_i18n::t!("tray.global"),
        "direct" => rust_i18n::t!("tray.direct"),
        _ => rust_i18n::t!("tray.rule"),
    };
    let outbound_modes_label = format!("{} ({})", texts.outbound_modes, current_mode_text);

    let rule_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::RULE_MODE,
        &texts.rule_mode,
        true,
        current_proxy_mode == "rule",
        hotkeys.get("clash_mode_rule").map(|s| s.as_str()),
    )?;

    let global_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::GLOBAL_MODE,
        &texts.global_mode,
        true,
        current_proxy_mode == "global",
        hotkeys.get("clash_mode_global").map(|s| s.as_str()),
    )?;

    let direct_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::DIRECT_MODE,
        &texts.direct_mode,
        true,
        current_proxy_mode == "direct",
        hotkeys.get("clash_mode_direct").map(|s| s.as_str()),
    )?;

    let outbound_modes = &Submenu::with_id_and_items(
        app_handle,
        MenuIds::OUTBOUND_MODES,
        outbound_modes_label.as_str(),
        true,
        &[
            rule_mode as &dyn IsMenuItem<Wry>,
            global_mode as &dyn IsMenuItem<Wry>,
            direct_mode as &dyn IsMenuItem<Wry>,
        ],
    )?;

    let profiles = &Submenu::with_id_and_items(
        app_handle,
        MenuIds::PROFILES,
        &texts.profiles,
        true,
        &profile_menu_items_refs,
    )?;

    let proxy_sub_menus =
        create_subcreate_proxy_menu_item(app_handle, current_proxy_mode, proxy_group_order_map, proxy_nodes_data);

    let (proxies_menu, inline_proxy_items) =
        create_proxy_menu_item(app_handle, show_proxy_groups_inline, proxy_sub_menus, &texts.proxies)?;

    let system_proxy = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::SYSTEM_PROXY,
        &texts.system_proxy,
        true,
        system_proxy_enabled,
        hotkeys.get("toggle_system_proxy").map(|s| s.as_str()),
    )?;

    let tun_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::TUN_MODE,
        &texts.tun_mode,
        tun_mode_available,
        tun_mode_enabled,
        hotkeys.get("toggle_tun_mode").map(|s| s.as_str()),
    )?;

    let close_all_connections = &MenuItem::with_id(
        app_handle,
        MenuIds::CLOSE_ALL_CONNECTIONS,
        &texts.close_all_connections,
        true,
        None::<&str>,
    )?;

    let lightweight_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::LIGHTWEIGHT_MODE,
        &texts.lightweight_mode,
        true,
        is_lightweight_mode,
        hotkeys.get("entry_lightweight_mode").map(|s| s.as_str()),
    )?;

    let copy_env = &MenuItem::with_id(app_handle, MenuIds::COPY_ENV, &texts.copy_env, true, None::<&str>)?;

    let open_app_dir = &MenuItem::with_id(app_handle, MenuIds::CONF_DIR, &texts.conf_dir, true, None::<&str>)?;

    let open_core_dir = &MenuItem::with_id(app_handle, MenuIds::CORE_DIR, &texts.core_dir, true, None::<&str>)?;

    let open_logs_dir = &MenuItem::with_id(app_handle, MenuIds::LOGS_DIR, &texts.logs_dir, true, None::<&str>)?;

    let open_app_log = &MenuItem::with_id(app_handle, MenuIds::APP_LOG, &texts.app_log, true, None::<&str>)?;

    let open_core_log = &MenuItem::with_id(app_handle, MenuIds::CORE_LOG, &texts.core_log, true, None::<&str>)?;

    let open_dir = &Submenu::with_id_and_items(
        app_handle,
        MenuIds::OPEN_DIR,
        &texts.open_dir,
        true,
        &[open_app_dir, open_core_dir, open_logs_dir, open_app_log, open_core_log],
    )?;

    let restart_clash = &MenuItem::with_id(
        app_handle,
        MenuIds::RESTART_CLASH,
        &texts.restart_clash,
        true,
        None::<&str>,
    )?;

    let restart_app = &MenuItem::with_id(app_handle, MenuIds::RESTART_APP, &texts.restart_app, true, None::<&str>)?;

    let app_version = &MenuItem::with_id(
        app_handle,
        MenuIds::VERGE_VERSION,
        format!("{} {version}", &texts.verge_version),
        true,
        None::<&str>,
    )?;

    let more = &Submenu::with_id_and_items(
        app_handle,
        MenuIds::MORE,
        &texts.more,
        true,
        &[
            copy_env as &dyn IsMenuItem<Wry>,
            close_all_connections,
            restart_clash,
            restart_app,
            app_version,
        ],
    )?;

    let quit = &MenuItem::with_id(app_handle, MenuIds::EXIT, &texts.exit, true, Some("CmdOrControl+Q"))?;

    let separator = &PredefinedMenuItem::separator(app_handle)?;

    // 动态构建菜单项
    let mut menu_items: Vec<&dyn IsMenuItem<Wry>> = vec![open_window, outbound_modes, separator, profiles];

    // 如果有代理节点，添加代理节点菜单
    if show_proxy_groups_inline {
        if !inline_proxy_items.is_empty() {
            menu_items.extend(inline_proxy_items.iter().map(|item| item.as_ref()));
        }
    } else if let Some(ref proxies_menu) = proxies_menu {
        menu_items.push(proxies_menu);
    }

    menu_items.extend_from_slice(&[
        separator,
        system_proxy as &dyn IsMenuItem<Wry>,
        tun_mode as &dyn IsMenuItem<Wry>,
        separator,
        lightweight_mode as &dyn IsMenuItem<Wry>,
        open_dir as &dyn IsMenuItem<Wry>,
        more as &dyn IsMenuItem<Wry>,
        separator,
        quit as &dyn IsMenuItem<Wry>,
    ]);

    let menu = tauri::menu::MenuBuilder::new(app_handle).items(&menu_items).build()?;
    Ok(menu)
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    AsyncHandler::spawn(|| async move {
        match event.id.as_ref() {
            mode @ (MenuIds::RULE_MODE | MenuIds::GLOBAL_MODE | MenuIds::DIRECT_MODE) => {
                // Removing the the "tray_" prefix and "_mode" suffix
                let mode = &mode[5..mode.len() - 5];
                logging!(info, Type::ProxyMode, "Switch Proxy Mode To: {}", mode);
                feat::change_clash_mode(mode.into()).await;
            }
            MenuIds::DASHBOARD => {
                logging!(info, Type::Tray, "托盘菜单点击: 打开窗口");

                if !should_handle_tray_click() {
                    return;
                }
                if !lightweight::exit_lightweight_mode().await {
                    WindowManager::show_main_window().await;
                };
            }
            MenuIds::SYSTEM_PROXY => {
                feat::toggle_system_proxy().await;
            }
            MenuIds::TUN_MODE => {
                feat::toggle_tun_mode(None).await;
            }
            MenuIds::CLOSE_ALL_CONNECTIONS => {
                if let Err(err) = handle::Handle::mihomo().await.close_all_connections().await {
                    logging!(error, Type::Tray, "Failed to close all connections from tray: {err}");
                }
            }
            MenuIds::COPY_ENV => feat::copy_clash_env().await,
            MenuIds::CONF_DIR => {
                println!("Open directory submenu clicked");
                let _ = cmd::open_app_dir().await;
            }
            MenuIds::CORE_DIR => {
                let _ = cmd::open_core_dir().await;
            }
            MenuIds::LOGS_DIR => {
                let _ = cmd::open_logs_dir().await;
            }
            MenuIds::APP_LOG => {
                let _ = cmd::open_app_log().await;
            }
            MenuIds::CORE_LOG => {
                let _ = cmd::open_core_log().await;
            }
            MenuIds::RESTART_CLASH => feat::restart_clash_core().await,
            MenuIds::RESTART_APP => feat::restart_app().await,
            MenuIds::LIGHTWEIGHT_MODE => {
                if !should_handle_tray_click() {
                    return;
                }
                if !is_in_lightweight_mode() {
                    lightweight::entry_lightweight_mode().await;
                } else {
                    lightweight::exit_lightweight_mode().await;
                }
            }
            MenuIds::EXIT => {
                feat::quit().await;
            }
            id if id.starts_with("profiles_") => {
                let profile_index = &id["profiles_".len()..];
                feat::toggle_proxy_profile(profile_index.into()).await;
            }
            id if id.starts_with("proxy_") => {
                // proxy_{group_name}_{proxy_name}
                let rest = match id.strip_prefix("proxy_") {
                    Some(r) => r,
                    None => return,
                };
                let (group_name, proxy_name) = match rest.split_once('_') {
                    Some((g, p)) => (g, p),
                    None => return,
                };
                feat::switch_proxy_node(group_name, proxy_name).await;
            }
            _ => {
                logging!(debug, Type::Tray, "Unhandled tray menu event: {:?}", event.id);
            }
        }

        // We dont expected to refresh tray state here
        // as the inner handle function (SHOULD) already takes care of it
    });
}
