use crate::config::IVerge;
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
use serde::Serialize;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_mihomo::models::Proxies;
use tokio::fs;

use super::handle;
use anyhow::Result;
use smartstring::alias::String;
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::sync::PoisonError;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
pub const TRAY_ID: &str = "clash-verge-rev-tray";

/// Windows 托盘菜单为系统原生弹出菜单，弹出期间主线程可能正运行其模态循环。
/// 在这个时间窗内跳过 set_menu，避免菜单显示期间被销毁/替换导致点击事件丢失
/// （参见 #5520 / #7131：托盘菜单频繁重建后所有点击静默失效）。
const TRAY_MENU_OPEN_GUARD_MS: u64 = 10_000;
/// 延迟重试菜单更新的轮询间隔。
const TRAY_MENU_RETRY_TICK_MS: u64 = 1_000;

/// 托盘菜单中一个订阅项（uid + 显示名 + 是否当前）。
#[derive(Clone, PartialEq, Eq, Serialize)]
struct ProfileMenuEntry {
    uid: String,
    name: String,
    is_current: bool,
}

/// 托盘菜单中一个代理节点（节点名 + 显示文本 + 是否选中）。
#[derive(Clone, PartialEq, Eq, Serialize)]
struct ProxyNodeMenuEntry {
    name: String,
    display_text: String,
    is_selected: bool,
}

/// 托盘菜单中一个代理组（组名 + 有序节点列表）。
#[derive(Clone, PartialEq, Eq, Serialize)]
struct ProxyGroupMenuEntry {
    name: String,
    nodes: Vec<ProxyNodeMenuEntry>,
}

/// 托盘菜单的完整内容快照。
///
/// 先在异步线程收集为纯数据，用于内容签名比较：内容未变化时直接跳过菜单重建，
/// 避免高频 set_menu 反复销毁/重建 Win32 菜单导致托盘菜单事件通道失效。
/// 只有内容真正变化时，才进入主线程执行实际的菜单对象构建。
#[derive(Clone, PartialEq, Serialize)]
struct TrayMenuData {
    current_proxy_mode: String,
    system_proxy_enabled: bool,
    tun_mode_enabled: bool,
    tun_mode_available: bool,
    is_lightweight_mode: bool,
    /// 影响 i18n 文案。
    language: Option<String>,
    /// 影响菜单项 accelerator。
    hotkeys: Option<Vec<String>>,
    /// "default" | "inline" | 其他（隐藏代理组）。
    groups_display_mode: String,
    show_outbound_modes_inline: bool,
    include_proxy_groups: bool,
    profiles: Vec<ProfileMenuEntry>,
    groups: Vec<ProxyGroupMenuEntry>,
}

impl TrayMenuData {
    /// 菜单内容签名的版本号，菜单结构变化时递增以强制一次重建。
    const SIGNATURE_VERSION: u8 = 1;

    fn signature(&self) -> String {
        let value = serde_json::json!({
            "v": Self::SIGNATURE_VERSION,
            "mode": self.current_proxy_mode,
            "sysproxy": self.system_proxy_enabled,
            "tun": self.tun_mode_enabled,
            "tun_capable": self.tun_mode_available,
            "lightweight": self.is_lightweight_mode,
            "lang": self.language,
            "hotkeys": self.hotkeys,
            "display_mode": self.groups_display_mode,
            "inline_modes": self.show_outbound_modes_inline,
            "include_groups": self.include_proxy_groups,
            "profiles": self.profiles,
            "groups": self.groups,
        });
        serde_json::to_string(&value).unwrap_or_default().into()
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone)]
struct TrayState {}

enum IconKind {
    Common,
    SysProxy,
    Tun,
}

pub struct Tray {
    limiter: SystemLimiter,
    /// 最近一次成功应用的菜单内容签名（JSON 字符串），用于跳过无变化的重构。
    menu_signature: Mutex<Option<String>>,
    /// 串行化菜单更新：采集数据 → 比对签名 → 构建 → set_menu 必须按序完成，
    /// 避免并发更新交错导致菜单内容与签名不一致。
    menu_update_lock: tokio::sync::Mutex<()>,
    /// 此时间点（epoch ms）之前跳过菜单替换：托盘弹出菜单可能正显示在屏幕上。
    menu_open_until: AtomicU64,
    /// 是否已有延迟重试任务在排队。
    menu_retry_pending: AtomicBool,
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
            menu_signature: Mutex::new(None),
            menu_update_lock: tokio::sync::Mutex::new(()),
            menu_open_until: AtomicU64::new(0),
            menu_retry_pending: AtomicBool::new(false),
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

    /// 记录"托盘弹出菜单可能已打开"，在守护窗口内跳过菜单替换。
    fn note_tray_menu_opened(&self) {
        self.menu_open_until
            .store(now_epoch_ms() + TRAY_MENU_OPEN_GUARD_MS, Ordering::Release);
    }

    fn menu_update_deferred(&self) -> bool {
        now_epoch_ms() < self.menu_open_until.load(Ordering::Acquire)
    }

    fn menu_signature_matches(&self, signature: &str) -> bool {
        self.menu_signature
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .is_some_and(|applied| applied == signature)
    }

    fn store_menu_signature(&self, signature: String) {
        *self.menu_signature.lock().unwrap_or_else(PoisonError::into_inner) = Some(signature);
    }

    /// 菜单守护窗口结束后补一次菜单更新（多次触发自动合并）。
    fn schedule_deferred_menu_update(&self) {
        if self.menu_retry_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        AsyncHandler::spawn(|| async move {
            loop {
                tokio::time::sleep(Duration::from_millis(TRAY_MENU_RETRY_TICK_MS)).await;
                let tray = Self::global();
                if tray.menu_update_deferred() {
                    continue;
                }
                tray.menu_retry_pending.store(false, Ordering::Release);
                logging_error!(Type::Tray, tray.update_menu().await);
                break;
            }
        });
    }

    async fn update_menu_internal(&self, app_handle: &AppHandle, include_proxy_groups: bool) -> Result<()> {
        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray menu: tray not found");
            return Ok(());
        };

        let _update_guard = self.menu_update_lock.lock().await;

        if self.menu_update_deferred() {
            logging!(debug, Type::Tray, "托盘弹出菜单可能正显示，延迟本次菜单更新");
            self.schedule_deferred_menu_update();
            return Ok(());
        }

        let data = collect_tray_menu_data(include_proxy_groups).await?;
        let signature = data.signature();

        if self.menu_signature_matches(&signature) {
            logging!(debug, Type::Tray, "托盘菜单内容未变化，跳过重建");
            return Ok(());
        }

        // 菜单对象涉及 Win32 HMENU 的创建/销毁，统一放到主线程执行，
        // 避免在 tokio 工作线程操作托盘 GUI 资源（#5520：怀疑非主线程更新导致事件通道失效）。
        let menu = {
            let app = app_handle.clone();
            let app_in_closure = app_handle.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            app.run_on_main_thread(move || {
                let _ = tx.send(build_tray_menu(&app_in_closure, &data));
            })
            .map_err(|e| anyhow::anyhow!("failed to schedule tray menu build: {e}"))?;
            rx.recv().map_err(|_| anyhow::anyhow!("tray menu build task dropped"))?
        }?;

        if let Err(e) = tray.set_menu(Some(menu)) {
            // 失败时不能记录签名，否则后续相同的菜单内容会被跳过、菜单停留在旧状态
            logging!(error, Type::Tray, "Failed to set tray menu: {e}");
            return Err(e.into());
        }

        self.store_menu_signature(signature);
        logging!(debug, Type::Tray, "托盘菜单更新成功");
        Ok(())
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
        // 新托盘实例尚未设置菜单，清除签名以强制下一次更新执行重建。
        *self.menu_signature.lock().unwrap_or_else(PoisonError::into_inner) = None;
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

/// 将代理组菜单数据渲染为实际的子菜单对象（必须在主线程调用）。
fn build_proxy_group_submenus(app_handle: &AppHandle, groups: &[ProxyGroupMenuEntry]) -> Vec<Submenu<Wry>> {
    groups
        .iter()
        .filter_map(|group| {
            let group_items: Vec<CheckMenuItem<Wry>> = group
                .nodes
                .iter()
                .filter_map(|node| {
                    let item_id = format!("proxy_{}_{}", group.name, node.name);
                    CheckMenuItem::with_id(
                        app_handle,
                        item_id,
                        node.display_text.as_str(),
                        true,
                        node.is_selected,
                        None::<&str>,
                    )
                    .map_err(|e| logging!(warn, Type::Tray, "Failed to create proxy menu item: {}", e))
                    .ok()
                })
                .collect();

            if group_items.is_empty() {
                return None;
            }

            let group_items_refs: Vec<&dyn IsMenuItem<Wry>> =
                group_items.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect();

            Submenu::with_id_and_items(
                app_handle,
                format!("proxy_group_{}", group.name),
                group.name.as_str(),
                true,
                &group_items_refs,
            )
            .map_err(|e| {
                logging!(
                    warn,
                    Type::Tray,
                    "Failed to create proxy group submenu: {}, {}",
                    group.name,
                    e
                )
            })
            .ok()
        })
        .collect()
}

fn delay_text_for(history_last: Option<u16>) -> String {
    match history_last {
        Some(0) => "-ms".into(),
        Some(delay) if delay >= 10000 => "-ms".into(),
        Some(delay) => format!("{}ms", delay).into(),
        None => "-ms".into(),
    }
}

/// 从内核代理数据中提取托盘代理组菜单的纯数据（过滤 + 排序 + 延迟文本）。
///
/// 与旧实现一致地按运行时配置的 proxy-groups 顺序排序；
/// 组迭代改为 BTreeMap（按键名排序）以保证相同内容产生完全相同的菜单数据。
fn collect_proxy_group_entries(
    proxy_nodes_data: Option<&Proxies>,
    proxy_mode: &str,
    proxy_group_order_map: Option<&BTreeMap<String, usize>>,
) -> Vec<ProxyGroupMenuEntry> {
    let Some(proxy_nodes_data) = proxy_nodes_data else {
        return Vec::new();
    };

    // HashMap 迭代顺序不稳定，先按组名排序保证输出确定。
    // 键为内核模型自带的 std::string::String，区别于本文件别名的 smartstring。
    let groups_iter: BTreeMap<&std::string::String, &tauri_plugin_mihomo::models::Proxy> =
        proxy_nodes_data.proxies.iter().collect();

    let mut entries: Vec<(String, usize, ProxyGroupMenuEntry)> = Vec::new();

    // TODO: 应用启动时，内核还未启动完全，无法获取代理节点信息
    for (group_name, group_data) in groups_iter {
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

        let nodes: Vec<ProxyNodeMenuEntry> = all_proxies
            .iter()
            .map(|proxy_str| {
                let delay_text = proxy_nodes_data
                    .proxies
                    .get(proxy_str)
                    .and_then(|h| h.history.last())
                    .map_or_else(|| "-ms".into(), |h| delay_text_for(Some(h.delay)));
                ProxyNodeMenuEntry {
                    name: proxy_str.as_str().into(),
                    display_text: format!("{}   | {}", proxy_str, delay_text).into(),
                    is_selected: *proxy_str == now_proxy,
                }
            })
            .collect();

        if nodes.is_empty() {
            continue;
        }

        entries.push((
            group_name.as_str().into(),
            entries.len(),
            ProxyGroupMenuEntry {
                name: group_name.as_str().into(),
                nodes,
            },
        ));
    }

    if let Some(order_map) = proxy_group_order_map {
        entries.sort_by(|(name_a, original_index_a, _), (name_b, original_index_b, _)| {
            match (order_map.get(name_a), order_map.get(name_b)) {
                (Some(index_a), Some(index_b)) => index_a.cmp(index_b),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => original_index_a.cmp(original_index_b),
            }
        });
    }

    entries.into_iter().map(|(_, _, entry)| entry).collect()
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

/// 收集托盘菜单的全部内容数据（不创建任何菜单对象）。
async fn collect_tray_menu_data(include_proxy_groups_opt: bool) -> Result<TrayMenuData> {
    let verge_settings = Config::verge().await.latest_arc();
    let system_proxy_enabled = *verge_settings.enable_system_proxy.as_ref().unwrap_or(&false);
    let tun_mode_enabled = *verge_settings.enable_tun_mode.as_ref().unwrap_or(&false);
    let tun_mode_available = crate::core::runstate::RUN_STATE.state().tun_capable();
    let current_proxy_mode: String = {
        Config::clash()
            .await
            .latest_arc()
            .0
            .get("mode")
            .map(|val| val.as_str().unwrap_or("rule"))
            .unwrap_or("rule")
            .into()
    };
    let profiles_config = Config::profiles().await;
    let profiles_arc = profiles_config.latest_arc();
    let profiles_preview = profiles_arc.profiles_preview().unwrap_or_default();
    let profiles = profiles_preview
        .iter()
        .map(|profile| ProfileMenuEntry {
            uid: profile.uid.clone(),
            name: profile.name.clone(),
            is_current: profile.is_current,
        })
        .collect();
    let is_lightweight_mode = is_in_lightweight_mode();

    let groups_display_mode_owned = verge_settings
        .tray_proxy_groups_display_mode
        .clone()
        .unwrap_or_else(|| "default".into());
    let fetch_proxy_groups = include_proxy_groups_opt && groups_display_mode_owned != "disable";

    // TODO: should update tray menu again when it was timeout error
    let (proxy_nodes_data, runtime_proxy_groups_order) = if fetch_proxy_groups {
        let proxy_nodes_data =
            tokio::time::timeout(Duration::from_millis(1000), handle::Handle::mihomo().get_proxies())
                .await
                .map_or(None, |res| res.ok());

        let runtime = Config::runtime().await.latest_arc();
        let runtime_proxy_groups_order = runtime.config.as_ref().map(|config| {
            config
                .get("proxy-groups")
                .and_then(|groups| groups.as_sequence())
                .map(|groups| {
                    groups
                        .iter()
                        .filter_map(|group| group.get("name"))
                        .filter_map(|name| name.as_str())
                        .enumerate()
                        .map(|(index, name)| (name.into(), index))
                        .collect::<BTreeMap<String, usize>>()
                })
                .unwrap_or_default()
        });

        (proxy_nodes_data, runtime_proxy_groups_order)
    } else {
        (None, None)
    };

    let groups = if fetch_proxy_groups {
        collect_proxy_group_entries(
            proxy_nodes_data.as_ref(),
            &current_proxy_mode,
            runtime_proxy_groups_order.as_ref(),
        )
    } else {
        Vec::new()
    };

    Ok(TrayMenuData {
        current_proxy_mode,
        system_proxy_enabled,
        tun_mode_enabled,
        tun_mode_available,
        is_lightweight_mode,
        language: verge_settings.language.clone(),
        hotkeys: verge_settings.hotkeys.clone(),
        groups_display_mode: groups_display_mode_owned,
        show_outbound_modes_inline: verge_settings.tray_inline_outbound_modes.unwrap_or(false),
        include_proxy_groups: include_proxy_groups_opt,
        profiles,
        groups,
    })
}

/// 根据菜单内容数据构建实际的菜单对象。
///
/// 涉及 Win32 HMENU 的创建，必须在主线程调用（see update_menu_internal）。
fn build_tray_menu(app_handle: &AppHandle, data: &TrayMenuData) -> Result<tauri::menu::Menu<Wry>> {
    let current_proxy_mode = data.current_proxy_mode.as_str();

    let version = env!("CARGO_PKG_VERSION");

    let hotkeys = create_hotkeys(&data.hotkeys);

    let profile_menu_items: Vec<CheckMenuItem<Wry>> = data
        .profiles
        .iter()
        .map(|profile| {
            CheckMenuItem::with_id(
                app_handle,
                format!("profiles_{}", profile.uid),
                profile.name.as_str(),
                true,
                profile.is_current,
                None::<&str>,
            )
            .map_err(|e| e.into())
        })
        .collect::<Result<Vec<_>>>()?;

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

    let outbound_modes = if data.show_outbound_modes_inline {
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

    let include_proxy_groups = data.include_proxy_groups && data.groups_display_mode != "disable";

    let (proxies_menu, inline_proxy_items) = if include_proxy_groups {
        let proxy_sub_menus = build_proxy_group_submenus(app_handle, &data.groups);

        match data.groups_display_mode.as_str() {
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
        data.system_proxy_enabled,
        hotkeys.get("toggle_system_proxy").copied(),
    )?;

    let tun_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::TUN_MODE,
        &texts.tun_mode,
        data.tun_mode_available,
        data.tun_mode_enabled,
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
        data.is_lightweight_mode,
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

    if data.show_outbound_modes_inline {
        menu_items.extend_from_slice(&[
            rule_mode as &dyn IsMenuItem<Wry>,
            global_mode as &dyn IsMenuItem<Wry>,
            direct_mode as &dyn IsMenuItem<Wry>,
        ]);
    } else if let Some(ref outbound_modes) = outbound_modes {
        menu_items.push(outbound_modes);
    }

    menu_items.extend_from_slice(&[separator, profiles]);

    match data.groups_display_mode.as_str() {
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
    Ok(menu)
}

fn on_tray_icon_event(_tray_icon: &TrayIcon, tray_event: TrayIconEvent) {
    if matches!(
        tray_event,
        TrayIconEvent::Move { .. } | TrayIconEvent::Leave { .. } | TrayIconEvent::Enter { .. }
    ) {
        return;
    }

    // 右键即将弹出系统原生托盘菜单：在守护窗口内跳过菜单替换，
    // 防止菜单显示期间被后台 set_menu 销毁导致点击无效。
    if let TrayIconEvent::Click {
        button: MouseButton::Right,
        ..
    } = tray_event
    {
        Tray::global().note_tray_menu_opened();
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
                // 左键点击事件无需额外处理，只需记录菜单守护窗口
                TrayAction::TrayMenu => {
                    Tray::global().note_tray_menu_opened();
                }
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
                if let Some(stripped) = mode.strip_prefix("tray_")
                    && let Some(final_mode) = stripped.strip_suffix("_mode")
                {
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

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn sample_menu_data() -> TrayMenuData {
        TrayMenuData {
            current_proxy_mode: "rule".into(),
            system_proxy_enabled: true,
            tun_mode_enabled: false,
            tun_mode_available: true,
            is_lightweight_mode: false,
            language: Some("zh-CN".into()),
            hotkeys: Some(vec!["quit,Cmd+Q".into()]),
            groups_display_mode: "default".into(),
            show_outbound_modes_inline: false,
            include_proxy_groups: true,
            profiles: vec![ProfileMenuEntry {
                uid: "uid-1".into(),
                name: "订阅A".into(),
                is_current: true,
            }],
            groups: vec![ProxyGroupMenuEntry {
                name: "🇯🇵 日本节点".into(),
                nodes: vec![ProxyNodeMenuEntry {
                    name: "日本01".into(),
                    display_text: "日本01   | 120ms".into(),
                    is_selected: true,
                }],
            }],
        }
    }

    #[test]
    fn signature_is_stable_for_identical_data() {
        let a = sample_menu_data();
        let b = sample_menu_data();
        assert_eq!(a.signature(), b.signature());
    }

    #[test]
    fn signature_changes_when_node_selection_changes() {
        let mut other = sample_menu_data();
        other.groups[0].nodes[0].is_selected = false;
        assert_ne!(sample_menu_data().signature(), other.signature());
    }

    #[test]
    fn signature_changes_when_delay_or_mode_changes() {
        let mut delayed = sample_menu_data();
        delayed.groups[0].nodes[0].display_text = "日本01   | 350ms".into();
        assert_ne!(sample_menu_data().signature(), delayed.signature());

        let mut mode = sample_menu_data();
        mode.current_proxy_mode = "global".into();
        assert_ne!(sample_menu_data().signature(), mode.signature());
    }

    #[test]
    fn group_entries_filter_and_order_deterministically() {
        let proxies = Proxies {
            proxies: HashMap::from([
                (
                    "GLOBAL".into(),
                    tauri_plugin_mihomo::models::Proxy {
                        all: Some(vec!["A".into()]),
                        ..Default::default()
                    },
                ),
                (
                    "Beta".into(),
                    tauri_plugin_mihomo::models::Proxy {
                        all: Some(vec!["n1".into(), "n2".into()]),
                        now: Some("n2".into()),
                        hidden: Some(false),
                        ..Default::default()
                    },
                ),
                (
                    "Alpha".into(),
                    tauri_plugin_mihomo::models::Proxy {
                        all: Some(vec!["n0".into()]),
                        ..Default::default()
                    },
                ),
                (
                    "Hidden".into(),
                    tauri_plugin_mihomo::models::Proxy {
                        all: Some(vec!["n3".into()]),
                        hidden: Some(true),
                        ..Default::default()
                    },
                ),
                (
                    "Empty".into(),
                    tauri_plugin_mihomo::models::Proxy {
                        all: Some(Vec::new()),
                        ..Default::default()
                    },
                ),
            ]),
        };

        // order map: Beta 在前，其余按字母序兜底（Alpha 在 Beta 之后）
        let order = BTreeMap::from([("Beta".into(), 5usize)]);
        let entries = collect_proxy_group_entries(Some(&proxies), "rule", Some(&order));

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Beta", "Alpha"]);

        // 选中节点与显示文本
        assert_eq!(entries[0].nodes[1].name.as_str(), "n2");
        assert!(entries[0].nodes[1].is_selected);
        assert!(!entries[0].nodes[0].is_selected);

        // 无 order map 时按字母序，输出确定
        let entries_no_order = collect_proxy_group_entries(Some(&proxies), "rule", None);
        let names_no_order: Vec<&str> = entries_no_order.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names_no_order, ["Alpha", "Beta"]);

        // global 模式只显示 GLOBAL 组
        let entries_global = collect_proxy_group_entries(Some(&proxies), "global", None);
        let names_global: Vec<&str> = entries_global.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names_global, ["GLOBAL"]);
    }
}
