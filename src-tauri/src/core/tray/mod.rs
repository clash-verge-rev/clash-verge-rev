use crate::config::{IProfilePreview, IVerge};
use crate::core::tray::menu_def::TrayAction;
use crate::module::lightweight;
use crate::process::AsyncHandler;
use crate::singleton;
use crate::utils::window_manager::WindowManager;
use crate::{
    Type, cmd,
    config::Config,
    feat, logging,
    module::lightweight::is_in_lightweight_mode,
    utils::{dirs::find_target_icons, help},
};
use clash_verge_limiter::{Limiter, SystemClock, SystemLimiter};
use clash_verge_logging::logging_error;
use parking_lot::RwLock;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_mihomo::models::Proxies;
use tokio::fs;

use super::handle;
use anyhow::Result;
use smartstring::alias::String;
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{
    AppHandle, Wry,
    menu::{CheckMenuItem, IsMenuItem, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
};

mod menu_def;
#[cfg(target_os = "macos")]
mod speed_task;
use menu_def::{MenuIds, MenuTexts};

// TODO: 是否需要将可变菜单抽离存储起来，后续直接更新对应菜单实例，无需重新创建菜单(待考虑)

type ProxyMenuItem = (Option<Submenu<Wry>>, Vec<Box<dyn IsMenuItem<Wry>>>);

const TRAY_CLICK_DEBOUNCE_MS: u64 = 300;
const PROXY_MENU_ITEM_PREFIX: &str = "proxy_";
pub const TRAY_ID: &str = "clash-verge-rev-tray";

#[derive(Clone, Copy)]
struct TrayMenuOptions {
    is_lightweight_mode: bool,
    include_proxy_groups: bool,
}

#[derive(Clone)]
struct TrayState {}

#[derive(Default)]
struct TrayMenuState {
    system_proxy: Option<CheckMenuItem<Wry>>,
    tun_mode: Option<CheckMenuItem<Wry>>,
    proxy_items: HashMap<(String, String), CheckMenuItem<Wry>>,
    selected_proxies: HashMap<String, String>,
}

struct CreatedTrayMenu {
    menu: tauri::menu::Menu<Wry>,
    state: TrayMenuState,
}

enum IconKind {
    Common,
    SysProxy,
    Tun,
}

pub struct Tray {
    limiter: SystemLimiter,
    menu_state: RwLock<TrayMenuState>,
    #[cfg(target_os = "macos")]
    speed_controller: speed_task::TraySpeedController,
}

impl TrayState {
    async fn get_tray_icon(verge: &IVerge) -> (bool, Cow<'_, [u8]>) {
        let tun_mode = verge.enable_tun_mode.unwrap_or(false);
        let system_mode = verge.enable_system_proxy.unwrap_or(false);
        let kind = if tun_mode {
            IconKind::Tun
        } else if system_mode {
            IconKind::SysProxy
        } else {
            IconKind::Common
        };
        Self::load_icon(verge, kind).await
    }

    async fn load_icon(verge: &IVerge, kind: IconKind) -> (bool, Cow<'_, [u8]>) {
        let (custom_enabled, icon_name) = match kind {
            IconKind::Common => (verge.common_tray_icon.unwrap_or(false), "common"),
            IconKind::SysProxy => (verge.sysproxy_tray_icon.unwrap_or(false), "sysproxy"),
            IconKind::Tun => (verge.tun_tray_icon.unwrap_or(false), "tun"),
        };

        if custom_enabled
            && let Ok(Some(path)) = find_target_icons(icon_name)
            && let Ok(data) = fs::read(path).await
        {
            return (true, Cow::Owned(data));
        }

        Self::default_icon(verge, kind)
    }

    #[allow(clippy::missing_const_for_fn)]
    fn default_icon(verge: &IVerge, kind: IconKind) -> (bool, Cow<'_, [u8]>) {
        #[cfg(target_os = "macos")]
        {
            let is_mono = verge.tray_icon.as_deref().unwrap_or("monochrome") == "monochrome";
            if is_mono {
                return (
                    false,
                    match kind {
                        IconKind::Common => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-mono.ico")),
                        IconKind::SysProxy => {
                            Cow::Borrowed(include_bytes!("../../../icons/tray-icon-sys-mono-new.ico"))
                        }
                        IconKind::Tun => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-tun-mono-new.ico")),
                    },
                );
            }
        }

        #[cfg(not(target_os = "macos"))]
        let _ = verge;

        (
            false,
            match kind {
                IconKind::Common => Cow::Borrowed(include_bytes!("../../../icons/tray-icon.ico")),
                IconKind::SysProxy => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-sys.ico")),
                IconKind::Tun => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-tun.ico")),
            },
        )
    }
}

impl Default for Tray {
    #[allow(clippy::unwrap_used)]
    fn default() -> Self {
        Self {
            limiter: Limiter::new(Duration::from_millis(TRAY_CLICK_DEBOUNCE_MS), SystemClock),
            menu_state: RwLock::new(TrayMenuState::default()),
            #[cfg(target_os = "macos")]
            speed_controller: speed_task::TraySpeedController::new(),
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
        let tray_event = TrayAction::from(tray_event.as_deref().unwrap_or("main_window"));
        let tray = app_handle
            .tray_by_id(TRAY_ID)
            .ok_or_else(|| anyhow::anyhow!("Failed to get main tray"))?;
        match tray_event {
            TrayAction::TrayMenu => tray.set_show_menu_on_left_click(true)?,
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
        let app_handle = handle::Handle::app_handle();
        self.update_menu_internal(app_handle, true).await
    }

    async fn update_menu_internal(&self, app_handle: &AppHandle, include_proxy_groups: bool) -> Result<()> {
        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray menu: tray not found");
            return Ok(());
        };

        let verge = Config::verge().await.latest_arc();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);
        let tun_mode_available = crate::core::runstate::RUN_STATE.state().tun_capable();
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

        let CreatedTrayMenu { menu, state } = create_tray_menu(
            app_handle,
            Some(mode.as_str()),
            *system_proxy,
            *tun_mode,
            tun_mode_available,
            profiles_preview,
            TrayMenuOptions {
                is_lightweight_mode,
                include_proxy_groups,
            },
        )
        .await?;

        match tray.set_menu(Some(menu)) {
            Ok(()) => *self.menu_state.write() = state,
            Err(error) => logging!(error, Type::Tray, "Failed to set tray menu: {error}"),
        }

        logging!(debug, Type::Tray, "托盘菜单更新成功");
        Ok(())
    }

    /// Update only the fixed toggle items. Rebuilding the full native menu here is expensive
    /// when a profile exposes thousands of proxy nodes, and these settings do not change the
    /// menu's structure.
    pub async fn update_toggle_states(&self) -> Result<()> {
        let verge = Config::verge().await.latest_arc();
        let system_proxy_enabled = verge.enable_system_proxy.unwrap_or(false);
        let tun_mode_enabled = verge.enable_tun_mode.unwrap_or(false);
        let tun_mode_available = crate::core::runstate::RUN_STATE.state().tun_capable();

        let toggle_items = {
            let state = self.menu_state.read();
            state.system_proxy.clone().zip(state.tun_mode.clone())
        };
        let Some((system_proxy, tun_mode)) = toggle_items else {
            return self.update_menu().await;
        };

        logging_error!(Type::Tray, system_proxy.set_checked(system_proxy_enabled));
        logging_error!(Type::Tray, tun_mode.set_checked(tun_mode_enabled));
        logging_error!(Type::Tray, tun_mode.set_enabled(tun_mode_available));
        Ok(())
    }

    /// Update a proxy selection in-place instead of rebuilding every group and node in the
    /// native menu. Missing items are expected when proxy groups are hidden or a profile switch
    /// is already rebuilding the menu, so they are a no-op.
    pub fn update_proxy_selection(&self, group_name: &str, proxy_name: &str) -> Result<()> {
        let mut state = self.menu_state.write();
        let key = (group_name.into(), proxy_name.into());
        let Some(next_item) = state.proxy_items.get(&key).cloned() else {
            return Ok(());
        };

        let previous_name = state.selected_proxies.get(group_name).cloned();
        if previous_name.as_deref() == Some(proxy_name) {
            return Ok(());
        }

        let previous_item = previous_name
            .as_ref()
            .and_then(|name| state.proxy_items.get(&(group_name.into(), name.clone())))
            .cloned();

        if let Some(previous_item) = &previous_item {
            previous_item.set_checked(false)?;
        }
        if let Err(error) = next_item.set_checked(true) {
            if let Some(previous_item) = previous_item {
                logging_error!(Type::Tray, previous_item.set_checked(true));
            }
            return Err(error.into());
        }

        state.selected_proxies.insert(group_name.into(), proxy_name.into());
        drop(state);
        Ok(())
    }

    /// 更新托盘图标
    pub async fn update_icon(&self, verge: &IVerge) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘图标更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray icon: tray not found");
            return Ok(());
        };

        let (_is_custom_icon, icon_bytes) = TrayState::get_tray_icon(verge).await;

        let template = {
            #[cfg(target_os = "macos")]
            {
                verge.tray_icon.as_ref().is_none_or(|v| v == "monochrome")
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        };
        let icon = Some(tauri::image::Image::from_bytes(&icon_bytes)?);

        logging_error!(Type::Tray, tray.set_icon_with_as_template(icon, template));

        Ok(())
    }

    /// 更新托盘提示
    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘提示更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let verge = Config::verge().await.latest_arc();
        let system_proxy = verge.enable_system_proxy.unwrap_or(false);
        let tun_mode = verge.enable_tun_mode.unwrap_or(false);

        let switch_str = |flag: bool| {
            if flag { "on" } else { "off" }
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
        let sys_proxy_text = clash_verge_i18n::t!("tray.tooltip.systemProxy");
        let tun_text = clash_verge_i18n::t!("tray.tooltip.tun");
        let profile_text = clash_verge_i18n::t!("tray.tooltip.profile");

        let v = env!("CARGO_PKG_VERSION");
        let reassembled_version = v.split_once('+').map_or_else(
            || v.into(),
            |(main, rest)| format!("{main}+{}", rest.split('.').next().unwrap_or("")),
        );

        let tooltip = format!(
            "Clash Verge {}\n{}: {}\n{}: {}\n{}: {}",
            reassembled_version,
            sys_proxy_text,
            switch_str(system_proxy),
            tun_text,
            switch_str(tun_mode),
            profile_text,
            current_profile_name
        );

        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray tooltip: tray not found");
            return Ok(());
        };

        logging_error!(Type::Tray, tray.set_tooltip(Some(&tooltip)));

        Ok(())
    }

    pub async fn update_part(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘局部更新");
            return Ok(());
        }
        let verge = Config::verge().await.data_arc();
        let app_handle = handle::Handle::app_handle();
        self.update_menu_internal(app_handle, false).await?;
        AsyncHandler::spawn(|| async {
            logging_error!(Type::Tray, Self::global().update_menu().await);
        });
        self.update_icon(&verge).await?;
        #[cfg(target_os = "macos")]
        self.update_speed_task(verge.enable_tray_speed.unwrap_or(false));
        self.update_tooltip().await?;
        Ok(())
    }

    pub async fn update_menu_and_icon(&self) {
        logging_error!(Type::Tray, self.update_menu().await);
        let verge = Config::verge().await.data_arc();
        logging_error!(Type::Tray, self.update_icon(&verge).await);
    }

    async fn create_tray_from_handle(&self, app_handle: &AppHandle) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘创建");
            return Ok(());
        }

        logging!(info, Type::Tray, "正在从AppHandle创建系统托盘");

        let verge = Config::verge().await.data_arc();

        let icon_bytes = TrayState::get_tray_icon(&verge).await.1;
        let icon = tauri::image::Image::from_bytes(&icon_bytes)?;

        #[cfg(target_os = "linux")]
        let builder = TrayIconBuilder::with_id(TRAY_ID).icon(icon).icon_as_template(false);

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let show_menu_on_left_click = verge.tray_event.as_ref().is_some_and(|v| v == "tray_menu");

        #[cfg(not(target_os = "linux"))]
        let mut builder = TrayIconBuilder::with_id(TRAY_ID).icon(icon).icon_as_template(false);
        #[cfg(target_os = "macos")]
        {
            let is_monochrome = verge.tray_icon.as_ref().is_none_or(|v| v == "monochrome");
            builder = builder.icon_as_template(is_monochrome);
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            if !show_menu_on_left_click {
                builder = builder.show_menu_on_left_click(false);
            }
        }

        let tray = builder.build(app_handle)?;
        tray.on_tray_icon_event(on_tray_icon_event);
        tray.on_menu_event(on_menu_event);
        Ok(())
    }

    fn should_handle_tray_click(&self) -> bool {
        let allow = self.limiter.check();
        if !allow {
            logging!(debug, Type::Tray, "tray click rate limited");
        }
        allow
    }

    /// 根据配置统一更新托盘速率采集任务状态（macOS）
    #[cfg(target_os = "macos")]
    pub fn update_speed_task(&self, enable_tray_speed: bool) {
        self.speed_controller.update_task(enable_tray_speed);
    }
}

fn create_hotkeys(hotkeys: &Option<Vec<String>>) -> HashMap<&str, &str> {
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
                                Some((func, key))
                            }
                        }
                        _ => None,
                    }
                })
                .collect::<HashMap<&str, &str>>()
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
    menu_state: &mut TrayMenuState,
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
                menu_state
                    .selected_proxies
                    .insert(group_name.as_str().into(), now_proxy.into());

                // Create proxy items
                let group_items: Vec<CheckMenuItem<Wry>> = all_proxies
                    .iter()
                    .filter_map(|proxy_str| {
                        let is_selected = *proxy_str == now_proxy;
                        let item_id = proxy_menu_item_id(group_name, proxy_str);

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
                            .inspect(|item| {
                                menu_state
                                    .proxy_items
                                    .insert((group_name.as_str().into(), proxy_str.as_str().into()), item.clone());
                            })
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
    proxies_text: &str,
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
    options: TrayMenuOptions,
) -> Result<CreatedTrayMenu> {
    let current_proxy_mode = mode.unwrap_or("");
    let mut menu_state = TrayMenuState::default();

    // TODO: should update tray menu again when it was timeout error
    let (proxy_nodes_data, runtime_proxy_groups_order) = if options.include_proxy_groups {
        let proxy_nodes_data =
            tokio::time::timeout(Duration::from_millis(1000), handle::Handle::mihomo().get_proxies())
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

        (proxy_nodes_data, runtime_proxy_groups_order)
    } else {
        (None, None)
    };

    let proxy_group_order_map: Option<HashMap<smartstring::SmartString<smartstring::LazyCompact>, usize>> =
        runtime_proxy_groups_order.as_ref().map(|group_names| {
            group_names
                .iter()
                .enumerate()
                .map(|(index, name)| (name.clone(), index))
                .collect::<HashMap<String, usize>>()
        });

    let verge_settings = Config::verge().await.latest_arc();
    let tray_proxy_groups_display_mode = verge_settings
        .tray_proxy_groups_display_mode
        .as_deref()
        .unwrap_or("default");
    let show_outbound_modes_inline = verge_settings.tray_inline_outbound_modes.unwrap_or(false);

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
        hotkeys.get("open_or_close_dashboard").copied(),
    )?;

    let rule_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::RULE_MODE,
        &texts.rule_mode,
        true,
        current_proxy_mode == "rule",
        hotkeys.get("clash_mode_rule").copied(),
    )?;

    let global_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::GLOBAL_MODE,
        &texts.global_mode,
        true,
        current_proxy_mode == "global",
        hotkeys.get("clash_mode_global").copied(),
    )?;

    let direct_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::DIRECT_MODE,
        &texts.direct_mode,
        true,
        current_proxy_mode == "direct",
        hotkeys.get("clash_mode_direct").copied(),
    )?;

    let outbound_modes = if show_outbound_modes_inline {
        None
    } else {
        let current_mode_text = match current_proxy_mode {
            "global" => clash_verge_i18n::t!("tray.global"),
            "direct" => clash_verge_i18n::t!("tray.direct"),
            _ => clash_verge_i18n::t!("tray.rule"),
        };
        let outbound_modes_label = format!("{} ({})", texts.outbound_modes, current_mode_text);
        Some(Submenu::with_id_and_items(
            app_handle,
            MenuIds::OUTBOUND_MODES,
            outbound_modes_label.as_str(),
            true,
            &[
                rule_mode as &dyn IsMenuItem<Wry>,
                global_mode as &dyn IsMenuItem<Wry>,
                direct_mode as &dyn IsMenuItem<Wry>,
            ],
        )?)
    };

    let profiles = &Submenu::with_id_and_items(
        app_handle,
        MenuIds::PROFILES,
        &texts.profiles,
        true,
        &profile_menu_items_refs,
    )?;

    let (proxies_menu, inline_proxy_items) = if options.include_proxy_groups {
        let proxy_sub_menus = create_subcreate_proxy_menu_item(
            app_handle,
            current_proxy_mode,
            proxy_group_order_map,
            proxy_nodes_data,
            &mut menu_state,
        );

        match tray_proxy_groups_display_mode {
            "default" => create_proxy_menu_item(app_handle, false, proxy_sub_menus, &texts.proxies)?,
            "inline" => create_proxy_menu_item(app_handle, true, proxy_sub_menus, &texts.proxies)?,
            _ => (None, Vec::new()),
        }
    } else {
        (None, Vec::new())
    };

    let system_proxy = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::SYSTEM_PROXY,
        &texts.system_proxy,
        true,
        system_proxy_enabled,
        hotkeys.get("toggle_system_proxy").copied(),
    )?;

    let tun_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::TUN_MODE,
        &texts.tun_mode,
        tun_mode_available,
        tun_mode_enabled,
        hotkeys.get("toggle_tun_mode").copied(),
    )?;
    menu_state.system_proxy = Some(system_proxy.clone());
    menu_state.tun_mode = Some(tun_mode.clone());

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
        options.is_lightweight_mode,
        hotkeys.get("entry_lightweight_mode").copied(),
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
        format!("{} {version}", texts.verge_version),
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

    let quit_accelerator = hotkeys.get("quit").copied();

    #[cfg(target_os = "macos")]
    let quit_accelerator = quit_accelerator.or(Some("Cmd+Q"));

    let quit = &MenuItem::with_id(app_handle, MenuIds::EXIT, &texts.exit, true, quit_accelerator)?;

    let separator = &PredefinedMenuItem::separator(app_handle)?;

    // 动态构建菜单项
    let mut menu_items: Vec<&dyn IsMenuItem<Wry>> = vec![open_window, separator];

    if show_outbound_modes_inline {
        menu_items.extend_from_slice(&[
            rule_mode as &dyn IsMenuItem<Wry>,
            global_mode as &dyn IsMenuItem<Wry>,
            direct_mode as &dyn IsMenuItem<Wry>,
        ]);
    } else if let Some(ref outbound_modes) = outbound_modes {
        menu_items.push(outbound_modes);
    }

    menu_items.extend_from_slice(&[separator, profiles]);

    // 如果有代理节点，添加代理节点菜单
    match tray_proxy_groups_display_mode {
        "default" => {
            menu_items.extend(proxies_menu.iter().map(|item| item as &dyn IsMenuItem<_>));
        }
        "inline" if !inline_proxy_items.is_empty() => {
            menu_items.extend(inline_proxy_items.iter().map(|item| item.as_ref()));
        }
        _ => {}
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
    Ok(CreatedTrayMenu {
        menu,
        state: menu_state,
    })
}

fn proxy_menu_item_id(group_name: &str, proxy_name: &str) -> std::string::String {
    format!("{PROXY_MENU_ITEM_PREFIX}{}_{group_name}{proxy_name}", group_name.len())
}

fn parse_proxy_menu_item_id(id: &str) -> Option<(&str, &str)> {
    let encoded = id.strip_prefix(PROXY_MENU_ITEM_PREFIX)?;
    let (group_len, names) = encoded.split_once('_')?;
    let group_len = group_len.parse::<usize>().ok()?;
    let group_name = names.get(..group_len)?;
    let proxy_name = names.get(group_len..)?;
    Some((group_name, proxy_name))
}

fn on_tray_icon_event(_tray_icon: &TrayIcon, tray_event: TrayIconEvent) {
    if matches!(
        tray_event,
        TrayIconEvent::Move { .. } | TrayIconEvent::Leave { .. } | TrayIconEvent::Enter { .. }
    ) {
        return;
    }

    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Down,
        ..
    } = tray_event
    {
        // 添加防抖检查，防止快速连击
        #[allow(clippy::use_self)]
        if !Tray::global().should_handle_tray_click() {
            return;
        }

        AsyncHandler::spawn(|| async move {
            let verge = Config::verge().await.data_arc();
            let verge_tray_event = verge.tray_event.clone().unwrap_or_else(|| "main_window".into());
            let verge_tray_action = TrayAction::from(verge_tray_event.as_str());
            logging!(debug, Type::Tray, "tray event: {verge_tray_action:?}");
            match verge_tray_action {
                TrayAction::SystemProxy => {
                    let _ = feat::toggle_system_proxy().await;
                }
                TrayAction::TunMode => {
                    let _ = feat::toggle_tun_mode(None).await;
                }
                TrayAction::MainWindow => {
                    if !lightweight::exit_lightweight_mode().await {
                        WindowManager::show_main_window().await;
                    };
                }
                // tray_menu 模式下菜单由系统原生展示（见 set_show_menu_on_left_click），
                // 左键点击事件无需额外处理
                TrayAction::TrayMenu => {}
                TrayAction::Unknown => {
                    logging!(warn, Type::Tray, "invalid tray event: {}", verge_tray_event);
                }
            };
        });
    }
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    if !Tray::global().should_handle_tray_click() {
        return;
    }
    if event.id.as_ref().is_empty() {
        return;
    }
    AsyncHandler::spawn(|| async move {
        match event.id.as_ref() {
            mode @ (MenuIds::RULE_MODE | MenuIds::GLOBAL_MODE | MenuIds::DIRECT_MODE) => {
                // Removing the the "tray_" prefix and "_mode" suffix
                if let Some(stripped) = mode.strip_prefix("tray_")
                    && let Some(final_mode) = stripped.strip_suffix("_mode")
                {
                    logging!(info, Type::ProxyMode, "Switch Proxy Mode To: {}", final_mode);
                    // 错误已在 change_clash_mode 内部记录，此处显式忽略返回值
                    let _ = feat::change_clash_mode(final_mode.into()).await;
                }
            }
            MenuIds::DASHBOARD => {
                logging!(info, Type::Tray, "托盘菜单点击: 打开窗口");
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
                if let Err(err) = handle::Handle::mihomo().close_all_connections().await {
                    logging!(error, Type::Tray, "Failed to close all connections from tray: {err}");
                }
            }
            MenuIds::COPY_ENV => feat::copy_clash_env().await,
            MenuIds::CONF_DIR => {
                let _ = cmd::open_app_dir().await;
            }
            MenuIds::CORE_DIR => {
                let _ = cmd::open_core_dir().await;
            }
            MenuIds::LOGS_DIR => {
                let _ = cmd::open_logs_dir().await;
            }
            MenuIds::APP_LOG => {
                let _ = help::open_app_latest_log();
            }
            MenuIds::CORE_LOG => {
                let _ = help::open_core_latest_log().await;
            }
            MenuIds::RESTART_CLASH => feat::restart_clash_core().await,
            MenuIds::RESTART_APP => feat::restart_app().await,
            MenuIds::LIGHTWEIGHT_MODE => {
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
                let profile_index = match id.strip_prefix("profiles_") {
                    Some(index_str) => index_str,
                    None => return,
                };
                feat::toggle_proxy_profile(profile_index.into()).await;
            }
            id if id.starts_with(PROXY_MENU_ITEM_PREFIX) => {
                let Some((group_name, proxy_name)) = parse_proxy_menu_item_id(id) else {
                    logging!(warn, Type::Tray, "Invalid proxy menu item id: {id}");
                    return;
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

#[cfg(test)]
mod tests {
    use super::{parse_proxy_menu_item_id, proxy_menu_item_id};
    use std::collections::HashSet;

    #[test]
    fn proxy_menu_item_ids_round_trip_names_with_separators() {
        let id = proxy_menu_item_id("group_with_underscores", "node_with_underscores");
        assert_eq!(
            parse_proxy_menu_item_id(&id),
            Some(("group_with_underscores", "node_with_underscores"))
        );
    }

    #[test]
    fn proxy_menu_item_ids_round_trip_unicode_names() {
        let id = proxy_menu_item_id("自动选择_日本", "香港_01");
        assert_eq!(parse_proxy_menu_item_id(&id), Some(("自动选择_日本", "香港_01")));
    }

    #[test]
    fn invalid_proxy_menu_item_ids_are_rejected() {
        assert_eq!(parse_proxy_menu_item_id("proxy_missing-length"), None);
        assert_eq!(parse_proxy_menu_item_id("proxy_999_too-short"), None);
        assert_eq!(parse_proxy_menu_item_id("not-a-proxy_1_ab"), None);
    }

    #[test]
    fn proxy_menu_item_ids_stay_unique_for_large_menus() {
        let mut ids = HashSet::new();

        for group_index in 0..100 {
            for proxy_index in 0..100 {
                let group_name = format!("group_{group_index}");
                let proxy_name = format!("node_{proxy_index}");
                let id = proxy_menu_item_id(&group_name, &proxy_name);

                assert!(ids.insert(id.clone()));
                assert_eq!(
                    parse_proxy_menu_item_id(&id),
                    Some((group_name.as_str(), proxy_name.as_str()))
                );
            }
        }
    }
}
