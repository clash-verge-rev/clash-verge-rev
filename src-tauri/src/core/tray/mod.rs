use once_cell::sync::OnceCell;
use tauri::Emitter;
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "macos")]
pub mod speed_rate;
use crate::ipc::Rate;
use crate::process::AsyncHandler;
use crate::{
    Type, cmd,
    config::Config,
    feat,
    ipc::IpcManager,
    logging,
    module::lightweight::is_in_lightweight_mode,
    singleton_lazy,
    utils::{dirs::find_target_icons, i18n::t},
};

use super::handle;
use anyhow::Result;
use futures::future::join_all;
use parking_lot::Mutex;
use std::{
    fs,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Wry,
    menu::{CheckMenuItem, IsMenuItem, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
};

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
    let mut last_click = debounce_lock.lock();
    let now = Instant::now();

    if now.duration_since(*last_click) >= Duration::from_millis(TRAY_CLICK_DEBOUNCE_MS) {
        *last_click = now;
        true
    } else {
        log::debug!(target: "app", "托盘点击被防抖机制忽略，距离上次点击 {:?}ms", 
                  now.duration_since(*last_click).as_millis());
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
    pub async fn get_common_tray_icon() -> (bool, Vec<u8>) {
        let verge = Config::verge().await.latest_ref().clone();
        let is_common_tray_icon = verge.common_tray_icon.unwrap_or(false);
        if is_common_tray_icon
            && let Ok(Some(common_icon_path)) = find_target_icons("common")
            && let Ok(icon_data) = fs::read(common_icon_path)
        {
            return (true, icon_data);
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

    pub async fn get_sysproxy_tray_icon() -> (bool, Vec<u8>) {
        let verge = Config::verge().await.latest_ref().clone();
        let is_sysproxy_tray_icon = verge.sysproxy_tray_icon.unwrap_or(false);
        if is_sysproxy_tray_icon
            && let Ok(Some(sysproxy_icon_path)) = find_target_icons("sysproxy")
            && let Ok(icon_data) = fs::read(sysproxy_icon_path)
        {
            return (true, icon_data);
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.clone().unwrap_or("monochrome".to_string());
            if tray_icon_colorful == "monochrome" {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-sys-mono-new.ico").to_vec(),
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

    pub async fn get_tun_tray_icon() -> (bool, Vec<u8>) {
        let verge = Config::verge().await.latest_ref().clone();
        let is_tun_tray_icon = verge.tun_tray_icon.unwrap_or(false);
        if is_tun_tray_icon
            && let Ok(Some(tun_icon_path)) = find_target_icons("tun")
            && let Ok(icon_data) = fs::read(tun_icon_path)
        {
            return (true, icon_data);
        }
        #[cfg(target_os = "macos")]
        {
            let tray_icon_colorful = verge.tray_icon.clone().unwrap_or("monochrome".to_string());
            if tray_icon_colorful == "monochrome" {
                (
                    false,
                    include_bytes!("../../../icons/tray-icon-tun-mono-new.ico").to_vec(),
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

impl Default for Tray {
    fn default() -> Self {
        Tray {
            last_menu_update: Mutex::new(None),
            menu_updating: AtomicBool::new(false),
        }
    }
}

// Use simplified singleton_lazy macro
singleton_lazy!(Tray, TRAY, Tray::default);

impl Tray {
    pub async fn init(&self) -> Result<()> {
        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or_else(|| anyhow::anyhow!("Failed to get app handle for tray initialization"))?;
        self.create_tray_from_handle(&app_handle).await?;
        Ok(())
    }

    /// 更新托盘点击行为
    pub async fn update_click_behavior(&self) -> Result<()> {
        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or_else(|| anyhow::anyhow!("Failed to get app handle for tray update"))?;
        let tray_event = { Config::verge().await.latest_ref().tray_event.clone() };
        let tray_event: String = tray_event.unwrap_or("main_window".into());
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

        let app_handle = match handle::Handle::global().app_handle() {
            Some(handle) => handle,
            None => {
                log::warn!(target: "app", "更新托盘菜单失败: app_handle不存在");
                return Ok(());
            }
        };

        // 设置更新状态
        self.menu_updating.store(true, Ordering::Release);

        let result = self.update_menu_internal(&app_handle).await;

        {
            let mut last_update = self.last_menu_update.lock();
            *last_update = Some(Instant::now());
        }
        self.menu_updating.store(false, Ordering::Release);

        result
    }

    async fn update_menu_internal(&self, app_handle: &AppHandle) -> Result<()> {
        let verge = Config::verge().await.latest_ref().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);
        let mode = {
            Config::clash()
                .await
                .latest_ref()
                .0
                .get("mode")
                .map(|val| val.as_str().unwrap_or("rule"))
                .unwrap_or("rule")
                .to_owned()
        };
        let profile_uid_and_name = Config::profiles()
            .await
            .data_mut()
            .all_profile_uid_and_name()
            .unwrap_or_default();
        let is_lightweight_mode = is_in_lightweight_mode();

        // 获取代理节点
        let proxy_nodes_data = cmd::get_proxies().await.unwrap_or_else(|e| {
            logging!(
                error,
                Type::Cmd,
                "Failed to fetch proxies for tray menu: {e}"
            );
            serde_json::Value::Object(serde_json::Map::new())
        });

        match app_handle.tray_by_id("main") {
            Some(tray) => {
                let _ = tray.set_menu(Some(
                    create_tray_menu(
                        app_handle,
                        Some(mode.as_str()),
                        *system_proxy,
                        *tun_mode,
                        profile_uid_and_name,
                        is_lightweight_mode,
                        proxy_nodes_data,
                    )
                    .await?,
                ));
                log::debug!(target: "app", "托盘菜单更新成功");
                Ok(())
            }
            None => {
                log::warn!(target: "app", "更新托盘菜单失败: 托盘不存在");
                Ok(())
            }
        }
    }

    /// 更新托盘图标
    #[cfg(target_os = "macos")]
    pub async fn update_icon(&self, _rate: Option<Rate>) -> Result<()> {
        let app_handle = match handle::Handle::global().app_handle() {
            Some(handle) => handle,
            None => {
                log::warn!(target: "app", "更新托盘图标失败: app_handle不存在");
                return Ok(());
            }
        };

        let tray = match app_handle.tray_by_id("main") {
            Some(tray) => tray,
            None => {
                log::warn!(target: "app", "更新托盘图标失败: 托盘不存在");
                return Ok(());
            }
        };

        let verge = Config::verge().await.latest_ref().clone();
        let system_mode = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let (_is_custom_icon, icon_bytes) = match (*system_mode, *tun_mode) {
            (true, true) => TrayState::get_tun_tray_icon().await,
            (true, false) => TrayState::get_sysproxy_tray_icon().await,
            (false, true) => TrayState::get_tun_tray_icon().await,
            (false, false) => TrayState::get_common_tray_icon().await,
        };

        let colorful = verge.tray_icon.clone().unwrap_or("monochrome".to_string());
        let is_colorful = colorful == "colorful";

        let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));
        let _ = tray.set_icon_as_template(!is_colorful);
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn update_icon(&self, _rate: Option<Rate>) -> Result<()> {
        let app_handle = match handle::Handle::global().app_handle() {
            Some(handle) => handle,
            None => {
                log::warn!(target: "app", "更新托盘图标失败: app_handle不存在");
                return Ok(());
            }
        };

        let tray = match app_handle.tray_by_id("main") {
            Some(tray) => tray,
            None => {
                log::warn!(target: "app", "更新托盘图标失败: 托盘不存在");
                return Ok(());
            }
        };

        let verge = Config::verge().await.latest_ref().clone();
        let system_mode = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let (_is_custom_icon, icon_bytes) = match (*system_mode, *tun_mode) {
            (true, true) => TrayState::get_tun_tray_icon().await,
            (true, false) => TrayState::get_sysproxy_tray_icon().await,
            (false, true) => TrayState::get_tun_tray_icon().await,
            (false, false) => TrayState::get_common_tray_icon().await,
        };

        let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));
        Ok(())
    }

    /// 更新托盘显示状态的函数
    pub async fn update_tray_display(&self) -> Result<()> {
        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or_else(|| anyhow::anyhow!("Failed to get app handle for tray update"))?;
        let _tray = app_handle
            .tray_by_id("main")
            .ok_or_else(|| anyhow::anyhow!("Failed to get main tray"))?;

        // 更新菜单
        self.update_menu().await?;

        Ok(())
    }

    /// 更新托盘提示
    pub async fn update_tooltip(&self) -> Result<()> {
        let app_handle = match handle::Handle::global().app_handle() {
            Some(handle) => handle,
            None => {
                log::warn!(target: "app", "更新托盘提示失败: app_handle不存在");
                return Ok(());
            }
        };

        let verge = Config::verge().await.latest_ref().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let switch_map = {
            let mut map = std::collections::HashMap::new();
            map.insert(true, "on");
            map.insert(false, "off");
            map
        };

        let mut current_profile_name = "None".to_string();
        {
            let profiles = Config::profiles().await;
            let profiles = profiles.latest_ref();
            if let Some(current_profile_uid) = profiles.get_current()
                && let Ok(profile) = profiles.get_item(&current_profile_uid)
            {
                current_profile_name = match &profile.name {
                    Some(profile_name) => profile_name.to_string(),
                    None => current_profile_name,
                };
            }
        }

        // Get localized strings before using them
        let sys_proxy_text = t("SysProxy").await;
        let tun_text = t("TUN").await;
        let profile_text = t("Profile").await;

        let version = env!("CARGO_PKG_VERSION");
        if let Some(tray) = app_handle.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(&format!(
                "Clash Verge {version}\n{}: {}\n{}: {}\n{}: {}",
                sys_proxy_text,
                switch_map[system_proxy],
                tun_text,
                switch_map[tun_mode],
                profile_text,
                current_profile_name
            )));
        } else {
            log::warn!(target: "app", "更新托盘提示失败: 托盘不存在");
        }

        Ok(())
    }

    pub async fn update_part(&self) -> Result<()> {
        // self.update_menu().await?;
        // 更新轻量模式显示状态
        self.update_tray_display().await?;
        self.update_icon(None).await?;
        self.update_tooltip().await?;
        Ok(())
    }

    pub async fn create_tray_from_handle(&self, app_handle: &AppHandle) -> Result<()> {
        log::info!(target: "app", "正在从AppHandle创建系统托盘");

        // 获取图标
        let icon_bytes = TrayState::get_common_tray_icon().await.1;
        let icon = tauri::image::Image::from_bytes(&icon_bytes)?;

        #[cfg(target_os = "linux")]
        let builder = TrayIconBuilder::with_id("main")
            .icon(icon)
            .icon_as_template(false);

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let show_menu_on_left_click = {
            let tray_event = { Config::verge().await.latest_ref().tray_event.clone() };
            let tray_event: String = tray_event.unwrap_or("main_window".into());
            tray_event.as_str() == "tray_menu"
        };

        #[cfg(not(target_os = "linux"))]
        let mut builder = TrayIconBuilder::with_id("main")
            .icon(icon)
            .icon_as_template(false);

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            if !show_menu_on_left_click {
                builder = builder.show_menu_on_left_click(false);
            }
        }

        let tray = builder.build(app_handle)?;

        tray.on_tray_icon_event(|_app_handle, event| {
            AsyncHandler::spawn(|| async move {
                let tray_event = { Config::verge().await.latest_ref().tray_event.clone() };
                let tray_event: String = tray_event.unwrap_or("main_window".into());
                log::debug!(target: "app", "tray event: {tray_event:?}");

                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Down,
                    ..
                } = event
                {
                    // 添加防抖检查，防止快速连击
                    if !should_handle_tray_click() {
                        return;
                    }

                    use std::future::Future;
                    use std::pin::Pin;

                    let fut: Pin<Box<dyn Future<Output = ()> + Send>> = match tray_event.as_str() {
                        "system_proxy" => Box::pin(async move {
                            feat::toggle_system_proxy().await;
                        }),
                        "tun_mode" => Box::pin(async move {
                            feat::toggle_tun_mode(None).await;
                        }),
                        "main_window" => Box::pin(async move {
                            use crate::utils::window_manager::WindowManager;
                            log::info!(target: "app", "Tray点击事件: 显示主窗口");
                            if crate::module::lightweight::is_in_lightweight_mode() {
                                log::info!(target: "app", "当前在轻量模式，正在退出轻量模式");
                                crate::module::lightweight::exit_lightweight_mode().await;
                            }
                            let result = WindowManager::show_main_window().await;
                            log::info!(target: "app", "窗口显示结果: {result:?}");
                        }),
                        _ => Box::pin(async move {}),
                    };
                    fut.await;
                }
            });
        });
        tray.on_menu_event(on_menu_event);
        log::info!(target: "app", "系统托盘创建成功");
        Ok(())
    }

    // 托盘统一的状态更新函数
    pub async fn update_all_states(&self) -> Result<()> {
        // 确保所有状态更新完成
        self.update_tray_display().await?;
        // self.update_menu().await?;
        self.update_icon(None).await?;
        self.update_tooltip().await?;

        Ok(())
    }
}

async fn create_tray_menu(
    app_handle: &AppHandle,
    mode: Option<&str>,
    system_proxy_enabled: bool,
    tun_mode_enabled: bool,
    profile_uid_and_name: Vec<(String, String)>,
    is_lightweight_mode: bool,
    proxy_nodes_data: serde_json::Value,
) -> Result<tauri::menu::Menu<Wry>> {
    let mode = mode.unwrap_or("");

    // 获取当前配置文件的选中代理组信息
    let current_profile_selected = {
        let profiles_config = Config::profiles().await;
        let profiles_ref = profiles_config.latest_ref();
        profiles_ref
            .get_current()
            .and_then(|uid| profiles_ref.get_item(&uid).ok())
            .and_then(|profile| profile.selected.clone())
            .unwrap_or_default()
    };

    let version = env!("CARGO_PKG_VERSION");

    let hotkeys = Config::verge()
        .await
        .latest_ref()
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

    let profile_menu_items: Vec<CheckMenuItem<Wry>> = {
        let futures = profile_uid_and_name
            .iter()
            .map(|(profile_uid, profile_name)| {
                let app_handle = app_handle.clone();
                let profile_uid = profile_uid.clone();
                let profile_name = profile_name.clone();
                async move {
                    let is_current_profile = Config::profiles()
                        .await
                        .data_mut()
                        .is_current_profile_index(profile_uid.to_string());
                    CheckMenuItem::with_id(
                        &app_handle,
                        format!("profiles_{profile_uid}"),
                        t(&profile_name).await,
                        true,
                        is_current_profile,
                        None::<&str>,
                    )
                }
            });
        let results = join_all(futures).await;
        results.into_iter().collect::<Result<Vec<_>, _>>()?
    };

    // 代理组子菜单
    let proxy_submenus: Vec<Submenu<Wry>> = {
        let mut submenus = Vec::new();

        if let Some(proxies) = proxy_nodes_data.get("proxies").and_then(|v| v.as_object()) {
            for (group_name, group_data) in proxies.iter() {
                // Filter groups based on mode
                let should_show = match mode {
                    "global" => group_name == "GLOBAL",
                    _ => group_name != "GLOBAL",
                };

                if !should_show {
                    continue;
                }

                let Some(all_proxies) = group_data.get("all").and_then(|v| v.as_array()) else {
                    continue;
                };

                let now_proxy = group_data.get("now").and_then(|v| v.as_str()).unwrap_or("");

                // Create proxy items
                let group_items: Vec<CheckMenuItem<Wry>> = all_proxies
                    .iter()
                    .filter_map(|proxy_name| proxy_name.as_str())
                    .filter_map(|proxy_str| {
                        let is_selected = proxy_str == now_proxy;
                        let item_id = format!("proxy_{}_{}", group_name, proxy_str);

                        // Get delay for display
                        let delay_text = proxies
                            .get(proxy_str)
                            .and_then(|p| p.get("history"))
                            .and_then(|h| h.as_array())
                            .and_then(|h| h.last())
                            .and_then(|r| r.get("delay"))
                            .and_then(|d| d.as_i64())
                            .map(|delay| match delay {
                                -1 => "-ms".to_string(),
                                delay if delay >= 10000 => "-ms".to_string(),
                                _ => format!("{}ms", delay),
                            })
                            .unwrap_or_else(|| "-ms".to_string());

                        let display_text = format!("{}   | {}", proxy_str, delay_text);

                        CheckMenuItem::with_id(
                            app_handle,
                            item_id,
                            display_text,
                            true,
                            is_selected,
                            None::<&str>,
                        )
                        .map_err(|e| log::warn!(target: "app", "创建代理菜单项失败: {}", e))
                        .ok()
                    })
                    .collect();

                if group_items.is_empty() {
                    continue;
                }

                // Determine if group is active
                let is_group_active = match mode {
                    "global" => group_name == "GLOBAL" && !now_proxy.is_empty(),
                    "direct" => false,
                    _ => {
                        current_profile_selected
                            .iter()
                            .any(|s| s.name.as_deref() == Some(group_name))
                            && !now_proxy.is_empty()
                    }
                };

                let group_display_name = if is_group_active {
                    format!("✓ {}", group_name)
                } else {
                    group_name.to_string()
                };

                let group_items_refs: Vec<&dyn IsMenuItem<Wry>> = group_items
                    .iter()
                    .map(|item| item as &dyn IsMenuItem<Wry>)
                    .collect();

                if let Ok(submenu) = Submenu::with_id_and_items(
                    app_handle,
                    format!("proxy_group_{}", group_name),
                    group_display_name,
                    true,
                    &group_items_refs,
                ) {
                    submenus.push(submenu);
                } else {
                    log::warn!(target: "app", "创建代理组子菜单失败: {}", group_name);
                }
            }
        }

        submenus
    };

    // Pre-fetch all localized strings
    let dashboard_text = t("Dashboard").await;
    let rule_mode_text = t("Rule Mode").await;
    let global_mode_text = t("Global Mode").await;
    let direct_mode_text = t("Direct Mode").await;
    let profiles_text = t("Profiles").await;
    let proxies_text = t("Proxies").await;
    let system_proxy_text = t("System Proxy").await;
    let tun_mode_text = t("TUN Mode").await;
    let lightweight_mode_text = t("LightWeight Mode").await;
    let copy_env_text = t("Copy Env").await;
    let conf_dir_text = t("Conf Dir").await;
    let core_dir_text = t("Core Dir").await;
    let logs_dir_text = t("Logs Dir").await;
    let open_dir_text = t("Open Dir").await;
    let restart_clash_text = t("Restart Clash Core").await;
    let restart_app_text = t("Restart App").await;
    let verge_version_text = t("Verge Version").await;
    let more_text = t("More").await;
    let exit_text = t("Exit").await;

    // Convert to references only when needed
    let profile_menu_items_refs: Vec<&dyn IsMenuItem<Wry>> = profile_menu_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<Wry>)
        .collect();

    let open_window = &MenuItem::with_id(
        app_handle,
        "open_window",
        dashboard_text,
        true,
        hotkeys.get("open_or_close_dashboard").map(|s| s.as_str()),
    )?;

    let rule_mode = &CheckMenuItem::with_id(
        app_handle,
        "rule_mode",
        rule_mode_text,
        true,
        mode == "rule",
        hotkeys.get("clash_mode_rule").map(|s| s.as_str()),
    )?;

    let global_mode = &CheckMenuItem::with_id(
        app_handle,
        "global_mode",
        global_mode_text,
        true,
        mode == "global",
        hotkeys.get("clash_mode_global").map(|s| s.as_str()),
    )?;

    let direct_mode = &CheckMenuItem::with_id(
        app_handle,
        "direct_mode",
        direct_mode_text,
        true,
        mode == "direct",
        hotkeys.get("clash_mode_direct").map(|s| s.as_str()),
    )?;

    let profiles = &Submenu::with_id_and_items(
        app_handle,
        "profiles",
        profiles_text,
        true,
        &profile_menu_items_refs,
    )?;

    // 创建代理主菜单
    let proxies_submenu = if !proxy_submenus.is_empty() {
        let proxy_submenu_refs: Vec<&dyn IsMenuItem<Wry>> = proxy_submenus
            .iter()
            .map(|submenu| submenu as &dyn IsMenuItem<Wry>)
            .collect();

        Some(Submenu::with_id_and_items(
            app_handle,
            "proxies",
            proxies_text,
            true,
            &proxy_submenu_refs,
        )?)
    } else {
        None
    };

    let system_proxy = &CheckMenuItem::with_id(
        app_handle,
        "system_proxy",
        system_proxy_text,
        true,
        system_proxy_enabled,
        hotkeys.get("toggle_system_proxy").map(|s| s.as_str()),
    )?;

    let tun_mode = &CheckMenuItem::with_id(
        app_handle,
        "tun_mode",
        tun_mode_text,
        true,
        tun_mode_enabled,
        hotkeys.get("toggle_tun_mode").map(|s| s.as_str()),
    )?;

    let lighteweight_mode = &CheckMenuItem::with_id(
        app_handle,
        "entry_lightweight_mode",
        lightweight_mode_text,
        true,
        is_lightweight_mode,
        hotkeys.get("entry_lightweight_mode").map(|s| s.as_str()),
    )?;

    let copy_env = &MenuItem::with_id(app_handle, "copy_env", copy_env_text, true, None::<&str>)?;

    let open_app_dir = &MenuItem::with_id(
        app_handle,
        "open_app_dir",
        conf_dir_text,
        true,
        None::<&str>,
    )?;

    let open_core_dir = &MenuItem::with_id(
        app_handle,
        "open_core_dir",
        core_dir_text,
        true,
        None::<&str>,
    )?;

    let open_logs_dir = &MenuItem::with_id(
        app_handle,
        "open_logs_dir",
        logs_dir_text,
        true,
        None::<&str>,
    )?;

    let open_dir = &Submenu::with_id_and_items(
        app_handle,
        "open_dir",
        open_dir_text,
        true,
        &[open_app_dir, open_core_dir, open_logs_dir],
    )?;

    let restart_clash = &MenuItem::with_id(
        app_handle,
        "restart_clash",
        restart_clash_text,
        true,
        None::<&str>,
    )?;

    let restart_app = &MenuItem::with_id(
        app_handle,
        "restart_app",
        restart_app_text,
        true,
        None::<&str>,
    )?;

    let app_version = &MenuItem::with_id(
        app_handle,
        "app_version",
        format!("{} {version}", verge_version_text),
        true,
        None::<&str>,
    )?;

    let more = &Submenu::with_id_and_items(
        app_handle,
        "more",
        more_text,
        true,
        &[restart_clash, restart_app, app_version],
    )?;

    let quit = &MenuItem::with_id(app_handle, "quit", exit_text, true, Some("CmdOrControl+Q"))?;

    let separator = &PredefinedMenuItem::separator(app_handle)?;

    // 动态构建菜单项
    let mut menu_items: Vec<&dyn IsMenuItem<Wry>> = vec![
        open_window,
        separator,
        rule_mode,
        global_mode,
        direct_mode,
        separator,
        profiles,
    ];

    // 如果有代理节点，添加代理节点菜单
    if let Some(ref proxies_menu) = proxies_submenu {
        menu_items.push(proxies_menu);
    }

    menu_items.extend_from_slice(&[
        separator,
        system_proxy as &dyn IsMenuItem<Wry>,
        tun_mode as &dyn IsMenuItem<Wry>,
        separator,
        lighteweight_mode as &dyn IsMenuItem<Wry>,
        copy_env as &dyn IsMenuItem<Wry>,
        open_dir as &dyn IsMenuItem<Wry>,
        more as &dyn IsMenuItem<Wry>,
        separator,
        quit as &dyn IsMenuItem<Wry>,
    ]);

    let menu = tauri::menu::MenuBuilder::new(app_handle)
        .items(&menu_items)
        .build()?;
    Ok(menu)
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    AsyncHandler::spawn(|| async move {
        match event.id.as_ref() {
            mode @ ("rule_mode" | "global_mode" | "direct_mode") => {
                let mode = &mode[0..mode.len() - 5]; // Removing the "_mode" suffix
                logging!(
                    info,
                    Type::ProxyMode,
                    true,
                    "Switch Proxy Mode To: {}",
                    mode
                );
                feat::change_clash_mode(mode.into()).await; // Await async function
            }
            "open_window" => {
                use crate::utils::window_manager::WindowManager;
                log::info!(target: "app", "托盘菜单点击: 打开窗口");

                if !should_handle_tray_click() {
                    return;
                }

                if crate::module::lightweight::is_in_lightweight_mode() {
                    logging!(info, Type::Lightweight, true, "Exiting Lightweight Mode");
                    crate::module::lightweight::exit_lightweight_mode().await; // Await async function
                }
                let result = WindowManager::show_main_window().await; // Await async function
                logging!(info, Type::Window, true, "Show Main Window: {result:?}");
            }
            "system_proxy" => {
                feat::toggle_system_proxy().await; // Await async function
            }
            "tun_mode" => {
                feat::toggle_tun_mode(None).await; // Await async function
            }
            "copy_env" => feat::copy_clash_env().await, // Await async function
            "open_app_dir" => {
                let _ = cmd::open_app_dir().await; // Await async function
            }
            "open_core_dir" => {
                let _ = cmd::open_core_dir().await; // Await async function
            }
            "open_logs_dir" => {
                let _ = cmd::open_logs_dir().await; // Await async function
            }
            "restart_clash" => feat::restart_clash_core().await, // Await async function
            "restart_app" => feat::restart_app().await,          // Await async function
            "entry_lightweight_mode" => {
                if !should_handle_tray_click() {
                    return;
                }

                let was_lightweight = crate::module::lightweight::is_in_lightweight_mode();
                if was_lightweight {
                    crate::module::lightweight::exit_lightweight_mode().await; // Await async function
                    use crate::utils::window_manager::WindowManager;
                    let result = WindowManager::show_main_window().await; // Await async function
                    logging!(info, Type::Window, true, "Show Main Window: {result:?}");
                } else {
                    crate::module::lightweight::entry_lightweight_mode().await; // Remove .await as it's not async
                }
            }
            "quit" => {
                feat::quit().await; // Await async function
            }
            id if id.starts_with("profiles_") => {
                let profile_index = &id["profiles_".len()..];
                feat::toggle_proxy_profile(profile_index.into()).await; // Await async function
            }
            id if id.starts_with("proxy_") => {
                // proxy_{group_name}_{proxy_name}
                let parts: Vec<&str> = id.splitn(3, '_').collect();

                if parts.len() == 3 && parts[0] == "proxy" {
                    let group_name = parts[1];
                    let proxy_name = parts[2];

                    match cmd::proxy::update_proxy_and_sync(
                        group_name.to_string(),
                        proxy_name.to_string(),
                    )
                    .await
                    {
                        Ok(_) => {
                            log::info!(target: "app", "切换代理成功: {} -> {}", group_name, proxy_name);
                        }
                        Err(e) => {
                            log::error!(target: "app", "切换代理失败: {} -> {}, 错误: {:?}", group_name, proxy_name, e);

                            // Fallback to IPC update
                            if (IpcManager::global()
                                .update_proxy(group_name, proxy_name)
                                .await)
                                .is_ok()
                            {
                                log::info!(target: "app", "代理切换回退成功: {} -> {}", group_name, proxy_name);

                                if let Some(app_handle) = handle::Handle::global().app_handle() {
                                    let _ = app_handle.emit("verge://force-refresh-proxies", ());
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }

        // Ensure tray state update is awaited and properly handled
        if let Err(e) = Tray::global().update_all_states().await {
            log::warn!(target: "app", "更新托盘状态失败: {e}");
        }
    });
}
