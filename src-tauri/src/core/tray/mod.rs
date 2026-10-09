use crate::config::{IProfilePreview, IVerge};
use crate::core::lightweight;
use crate::core::proxy_view::{ProxyGroupView, ProxyMemberRef, ProxyNodeSource, ProxyViewProviderState, ProxyViewV1};
use crate::core::tray::menu_def::TrayAction;
use crate::process::AsyncHandler;
use crate::singleton;
use crate::utils::window_manager::WindowManager;
use crate::{
    Type, cmd,
    config::Config,
    core::lightweight::is_in_lightweight_mode,
    feat, logging,
    utils::{dirs::find_target_icons, help},
};
use clash_verge_limiter::{Limiter, SystemClock, SystemLimiter};
use clash_verge_logging::logging_error;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
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

mod latency;
mod menu_def;
#[cfg(target_os = "macos")]
mod speed_task;
use menu_def::{MenuIds, MenuTexts};

// TODO: 是否需要将可变菜单抽离存储起来，后续直接更新对应菜单实例，无需重新创建菜单(待考虑)

type ProxyMenuItem = (Option<Submenu<Wry>>, Vec<Box<dyn IsMenuItem<Wry>>>);

const TRAY_CLICK_DEBOUNCE_MS: u64 = 300;
pub const TRAY_ID: &str = "clash-verge-rev-tray";

#[derive(Clone, Copy)]
struct TrayMenuOptions {
    is_lightweight_mode: bool,
    include_proxy_groups: bool,
}

#[derive(Clone)]
struct TrayState {}

enum IconKind {
    Common,
    SysProxy,
    Tun,
}

struct LatencyMenuItem {
    item: MenuItem<Wry>,
    running: bool,
    proxies: Vec<ProxyLatencyItem>,
    provider_state: ProxyViewProviderState,
}

struct ProxyLatencyItem {
    item: CheckMenuItem<Wry>,
    name: std::string::String,
    provider_name: Option<std::string::String>,
    text: std::string::String,
}

pub struct Tray {
    limiter: SystemLimiter,
    proxy_hover_limiter: SystemLimiter,
    menu_update: tokio::sync::Mutex<()>,
    latency_items: parking_lot::Mutex<HashMap<std::string::String, LatencyMenuItem>>,
    #[cfg(target_os = "macos")]
    speed_controller: speed_task::TraySpeedController,
}

impl TrayState {
    async fn get_tray_icon(verge: &IVerge) -> (bool, Cow<'_, [u8]>) {
        let tun_mode = verge.enable_tun_mode.unwrap_or(false) && crate::core::runstate::RUN_STATE.state().tun_capable();
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
            proxy_hover_limiter: Limiter::new(Duration::from_secs(1), SystemClock),
            menu_update: tokio::sync::Mutex::new(()),
            latency_items: parking_lot::Mutex::new(HashMap::new()),
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
                logging!(
                    warn,
                    Type::Tray,
                    "System tray creation failed: {e}, Application will continue running without tray icon",
                );
            }
        }
        Ok(())
    }

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

    pub async fn update_menu(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘菜单更新");
            return Ok(());
        }
        let app_handle = handle::Handle::app_handle();
        self.update_menu_internal(app_handle, true).await
    }

    async fn update_menu_internal(&self, app_handle: &AppHandle, include_proxy_groups: bool) -> Result<()> {
        let _update = self.menu_update.lock().await;
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

        let (menu, latency_items) = create_tray_menu(
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
        tray.set_menu(Some(menu))?;
        let groups: Vec<_> = latency_items.keys().cloned().collect();
        *self.latency_items.lock() = latency_items;
        for group in groups {
            self.refresh_latency_item(&group);
        }

        logging!(debug, Type::Tray, "托盘菜单更新成功");
        Ok(())
    }

    async fn refresh_proxy_items(&'static self) {
        let Ok(update) = self.menu_update.try_lock() else {
            return;
        };
        if self.latency_items.lock().is_empty() || handle::Handle::global().is_exiting() {
            return;
        }
        let Ok(Ok(view)) = tokio::time::timeout(
            Duration::from_secs(1),
            cmd::proxy::proxy_view(Some(Duration::from_millis(750))),
        )
        .await
        else {
            return;
        };
        if self
            .latency_items
            .lock()
            .values()
            .any(|entry| entry.provider_state != view.provider_state)
        {
            // Provider fallback changes member identities; rebuild through the existing queue.
            drop(update);
            logging_error!(Type::Tray, cmd::proxy::sync_tray_proxy_selection().await);
            return;
        }
        let verge = Config::verge().await.latest_arc();
        let profiles = Config::profiles().await.latest_arc();
        logging_error!(
            Type::Tray,
            handle::Handle::app_handle().run_on_main_thread(move || {
                // Keep rebuilding serialized until these handles have received their snapshot.
                let _update = update;
                let mut items = self.latency_items.lock();
                for (group_name, entry) in items.iter_mut() {
                    let Some(group) = find_group(&view, group_name) else {
                        continue;
                    };
                    let url = latency::test_url(group, &verge, &profiles);
                    let mut members = HashMap::with_capacity(group.members.len());
                    for member in &group.members {
                        members
                            .entry((member_name(member), member_provider(&view, member)))
                            .or_insert(member);
                    }
                    for proxy in &mut entry.proxies {
                        let Some(member) = members.get(&(proxy.name.as_str(), proxy.provider_name.as_deref())) else {
                            continue;
                        };
                        let text = proxy_item_text(&view, member, &url, &verge);
                        let checked = group.now.as_ref() == Some(&proxy.name);
                        if text != proxy.text {
                            match proxy.item.set_text(&text) {
                                Ok(()) => proxy.text = text,
                                Err(err) => logging!(warn, Type::Tray, "Failed to refresh proxy latency: {err}"),
                            }
                        }
                        match proxy.item.is_checked() {
                            Ok(current) if current != checked => {
                                logging_error!(Type::Tray, proxy.item.set_checked(checked))
                            }
                            Err(err) => logging!(warn, Type::Tray, "Failed to read proxy selection: {err}"),
                            _ => {}
                        }
                    }
                }
            })
        );
    }

    fn refresh_latency_item(&self, group_name: &str) {
        let group_name = group_name.to_owned();
        logging_error!(
            Type::Tray,
            handle::Handle::app_handle().run_on_main_thread(move || {
                Self::global().refresh_latency_item_on_main_thread(&group_name);
            })
        );
    }

    fn refresh_latency_item_on_main_thread(&self, group_name: &str) {
        let running = latency::is_running(group_name);
        let item = {
            let mut items = self.latency_items.lock();
            items.get_mut(group_name).and_then(|entry| {
                if entry.running == running {
                    return None;
                }
                entry.running = running;
                Some(entry.item.clone())
            })
        };
        if let Some(item) = item {
            let label = if running {
                clash_verge_i18n::t!("tray.testingLatency")
            } else {
                clash_verge_i18n::t!("tray.testLatency")
            };
            logging_error!(Type::Tray, item.set_text(label));
            logging_error!(Type::Tray, item.set_enabled(!running));
        }
    }

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

    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘提示更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let verge = Config::verge().await.latest_arc();
        let system_proxy = verge.enable_system_proxy.unwrap_or(false);
        let tun_mode = verge.enable_tun_mode.unwrap_or(false) && crate::core::runstate::RUN_STATE.state().tun_capable();

        let switch_str = |flag: bool| {
            if flag { "on" } else { "off" }
        };

        let mut current_profile_name = "None".into();
        {
            let profiles = Config::profiles().await;
            let profiles = profiles.latest_arc();
            if let Some(current_profile_uid) = profiles.current.as_ref()
                && let Ok(profile) = profiles.get_item(current_profile_uid)
            {
                current_profile_name = match &profile.name {
                    Some(profile_name) => profile_name.to_string(),
                    None => current_profile_name,
                };
            }
        }

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

const UNTESTED_DELAY_TEXT: &str = "-ms";
const TIMEOUT_DELAY_TEXT: &str = "T/O";
const TRAY_GROUP_DEPTH_LIMIT: usize = 8;

const fn member_name(member: &ProxyMemberRef) -> &str {
    match member {
        ProxyMemberRef::Node { name, .. }
        | ProxyMemberRef::Group { name }
        | ProxyMemberRef::Unresolved { name, .. } => name.as_str(),
    }
}

fn find_group<'a>(view: &'a ProxyViewV1, name: &str) -> Option<&'a ProxyGroupView> {
    view.groups
        .iter()
        .chain(view.global.iter())
        .find(|group| group.name.as_str() == name)
}

/// The delay recorded for `url`, falling back to the node's latest measurement under any URL, so a
/// node the core tested on its own still shows a value.
fn node_delay(view: &ProxyViewV1, record_id: &str, url: &str) -> Option<u16> {
    view.records
        .get(record_id)
        .map(|node| node.extra.get(url).map_or(&node.history, |extra| &extra.history))
        .and_then(|history| history.last())
        .map(|history| history.delay)
}

/// A group row shows the delay of the node the group currently selects. The core never writes a
/// history for the group itself, so `now` is followed until the chain reaches a node.
fn selected_member_delay(view: &ProxyViewV1, group_name: &str, url: &str) -> Option<u16> {
    let mut current = group_name;
    for _ in 0..TRAY_GROUP_DEPTH_LIMIT {
        let Some(group) = find_group(view, current) else { break };
        let Some(now) = group.now.as_deref().filter(|now| !now.is_empty() && *now != current) else {
            break;
        };
        let Some(member) = group.members.iter().find(|member| member_name(member) == now) else {
            break;
        };
        match member {
            ProxyMemberRef::Node { record_id, .. } => return node_delay(view, record_id, url),
            ProxyMemberRef::Group { name } => current = name.as_str(),
            ProxyMemberRef::Unresolved { .. } => break,
        }
    }
    find_group(view, group_name)
        .map(|group| group.extra.get(url).map_or(&group.history, |extra| &extra.history))
        .and_then(|history| history.last())
        .map(|history| history.delay)
}

fn member_provider<'a>(view: &'a ProxyViewV1, member: &ProxyMemberRef) -> Option<&'a str> {
    let ProxyMemberRef::Node { record_id, .. } = member else {
        return None;
    };
    match &view.records.get(record_id)?.source {
        ProxyNodeSource::Provider { provider_name, .. } => Some(provider_name),
        ProxyNodeSource::Core { .. } => None,
    }
}

fn proxy_item_text(view: &ProxyViewV1, member: &ProxyMemberRef, url: &str, verge: &IVerge) -> std::string::String {
    let timeout = verge
        .default_latency_timeout
        .filter(|timeout| *timeout > 0)
        .unwrap_or(10000);
    let delay = match member {
        ProxyMemberRef::Node { record_id, .. } => node_delay(view, record_id, url),
        ProxyMemberRef::Group { name } => selected_member_delay(view, name, url),
        ProxyMemberRef::Unresolved { .. } => None,
    };
    let delay_text = delay.map_or_else(
        || UNTESTED_DELAY_TEXT.to_owned(),
        |delay| {
            if delay == 0 || u32::from(delay) >= timeout as u32 {
                TIMEOUT_DELAY_TEXT.to_owned()
            } else {
                format!("{delay}ms")
            }
        },
    );
    format!("{}   | {delay_text}", member_name(member))
}

fn create_subcreate_proxy_menu_item(
    app_handle: &AppHandle,
    proxy_mode: &str,
    view: Option<ProxyViewV1>,
    latency_items: &mut HashMap<std::string::String, LatencyMenuItem>,
    texts: &MenuTexts,
    verge: &IVerge,
    profiles: &crate::config::IProfiles,
) -> Vec<Submenu<Wry>> {
    let Some(view) = view else { return Vec::new() };
    view.groups
        .iter()
        .chain(view.global.iter())
        .filter_map(|group| {
            if group.hidden.unwrap_or_default() || (proxy_mode == "global") != (group.name == "GLOBAL") {
                return None;
            }
            let url = latency::test_url(group, verge, profiles);
            let proxies: Vec<ProxyLatencyItem> = group
                .members
                .iter()
                .filter_map(|member| {
                    let name = member_name(member);
                    let text = proxy_item_text(&view, member, &url, verge);
                    let checked = group.now.as_deref() == Some(name);
                    CheckMenuItem::with_id(
                        app_handle,
                        format!("proxy_{}_{}", group.name, name),
                        &text,
                        true,
                        checked,
                        None::<&str>,
                    )
                    .map(|item| ProxyLatencyItem {
                        item,
                        name: name.to_owned(),
                        provider_name: member_provider(&view, member).map(str::to_owned),
                        text,
                    })
                    .map_err(|e| logging!(warn, Type::Tray, "Failed to create proxy menu item: {e}"))
                    .ok()
                })
                .collect();
            let group_items: Vec<_> = proxies.iter().map(|proxy| proxy.item.clone()).collect();
            if group_items.is_empty() {
                return None;
            }
            let running = latency::is_running(&group.name);
            let test_item = MenuItem::with_id(
                app_handle,
                format!("{}_{}", MenuIds::TEST_LATENCY, group.name),
                if running {
                    clash_verge_i18n::t!("tray.testingLatency")
                } else {
                    texts.test_latency.clone()
                },
                !running,
                None::<&str>,
            )
            .ok()?;
            latency_items.insert(
                group.name.clone(),
                LatencyMenuItem {
                    item: test_item.clone(),
                    running,
                    proxies,
                    provider_state: view.provider_state,
                },
            );
            let separator = PredefinedMenuItem::separator(app_handle).ok()?;
            let mut items: Vec<&dyn IsMenuItem<Wry>> = vec![&test_item, &separator];
            items.extend(group_items.iter().map(|item| item as &dyn IsMenuItem<Wry>));
            Submenu::with_id_and_items(
                app_handle,
                format!("proxy_group_{}", group.name),
                &group.name,
                true,
                &items,
            )
            .map_err(|e| logging!(warn, Type::Tray, "Failed to create proxy group submenu: {e}"))
            .ok()
        })
        .collect()
}

fn create_proxy_menu_item(
    app_handle: &AppHandle,
    show_proxy_groups_inline: bool,
    proxy_submenus: Vec<Submenu<Wry>>,
    proxies_text: &str,
) -> Result<ProxyMenuItem> {
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
) -> Result<(tauri::menu::Menu<Wry>, HashMap<std::string::String, LatencyMenuItem>)> {
    let current_proxy_mode = mode.unwrap_or("");

    let mut verge_settings = Config::verge().await.latest_arc();
    let fetch_proxy_groups =
        options.include_proxy_groups && verge_settings.tray_proxy_groups_display_mode.as_deref() != Some("disable");

    // Proxy data must remain optional so a stopped Core cannot roll back unrelated settings.
    let proxy_view = if fetch_proxy_groups {
        tokio::time::timeout(
            Duration::from_millis(1000),
            cmd::proxy::proxy_view(Some(Duration::from_millis(750))),
        )
        .await
        .ok()
        .and_then(Result::ok)
    } else {
        None
    };

    if fetch_proxy_groups {
        verge_settings = Config::verge().await.latest_arc();
    }

    let profiles_config = Config::profiles().await.latest_arc();

    let tray_proxy_groups_display_mode = verge_settings
        .tray_proxy_groups_display_mode
        .as_deref()
        .unwrap_or("default");
    let include_proxy_groups = options.include_proxy_groups && tray_proxy_groups_display_mode != "disable";

    let show_outbound_modes_inline = verge_settings.tray_inline_outbound_modes.unwrap_or(false);

    let version = env!("CARGO_PKG_VERSION");

    let hotkeys = create_hotkeys(&verge_settings.hotkeys);

    let profile_menu_items: Vec<CheckMenuItem<Wry>> = create_profile_menu_item(app_handle, profiles_preview)?;

    let texts = MenuTexts::new();
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

    let mut latency_items = HashMap::new();
    let (proxies_menu, inline_proxy_items) = if include_proxy_groups {
        let proxy_sub_menus = create_subcreate_proxy_menu_item(
            app_handle,
            current_proxy_mode,
            proxy_view,
            &mut latency_items,
            &texts,
            &verge_settings,
            &profiles_config,
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
    Ok((menu, latency_items))
}

fn on_tray_icon_event(_tray_icon: &TrayIcon, tray_event: TrayIconEvent) {
    let refresh_proxies = match tray_event {
        TrayIconEvent::Enter { .. } => Tray::global().proxy_hover_limiter.check(),
        TrayIconEvent::Click {
            button: MouseButton::Left | MouseButton::Right,
            button_state: MouseButtonState::Down,
            ..
        } => true,
        _ => false,
    };
    if refresh_proxies {
        AsyncHandler::spawn(|| async {
            Tray::global().refresh_proxy_items().await;
        });
    }

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
                if let Some(final_mode) = mode.strip_circumfix("tray_", "_mode") {
                    logging!(info, Type::ProxyMode, "Switch Proxy Mode To: {}", final_mode);
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
                let _ = feat::toggle_system_proxy().await;
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
            id if id.starts_with(MenuIds::TEST_LATENCY) => {
                let group_name = id
                    .strip_prefix(MenuIds::TEST_LATENCY)
                    .and_then(|rest| rest.strip_prefix('_'));
                if let Some(group_name) = group_name {
                    logging!(info, Type::Tray, "Tray menu: test group latency {}", group_name);
                    latency::test_proxy_group_delay(group_name).await;
                }
            }
            id if id.starts_with("proxy_") => {
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
    });
}
