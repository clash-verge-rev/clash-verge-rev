#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use anyhow::Result;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::{
    Type, cmd,
    config::Config,
    feat, logging,
    module::lightweight,
    module::lightweight::is_in_lightweight_mode,
    utils::{dirs::find_target_icons, i18n::t, window_manager::WindowManager},
};

use crate::core::handle;
use tauri::Emitter;

/// Debounce interval in milliseconds for tray click handling.
pub(crate) const TRAY_CLICK_DEBOUNCE_MS: u64 = 300;

static TRAY_CLICK_DEBOUNCE: OnceCell<Mutex<Instant>> = OnceCell::new();

fn tray_click_debounce() -> &'static Mutex<Instant> {
    TRAY_CLICK_DEBOUNCE.get_or_init(|| Mutex::new(Instant::now() - Duration::from_secs(1)))
}

/// Returns true when the tray click should be handled; false when it should be ignored
/// because it happens within the debounce interval.
pub(crate) fn should_handle_tray_click() -> bool {
    let debounce_lock = tray_click_debounce();
    let mut last_click = debounce_lock.lock();
    let now = Instant::now();

    if now.duration_since(*last_click) >= Duration::from_millis(TRAY_CLICK_DEBOUNCE_MS) {
        *last_click = now;
        true
    } else {
        log::debug!(
            target: "app",
            "托盘点击被防抖机制忽略，距离上次点击 {:?}ms",
            now.duration_since(*last_click).as_millis()
        );
        false
    }
}

#[derive(Clone)]
pub(crate) struct TrayToggleState {
    pub system_proxy_enabled: bool,
    pub tun_mode_enabled: bool,
}

#[derive(Clone)]
pub(crate) struct TrayMenuInputs {
    pub toggles: TrayToggleState,
    pub mode: String,
    pub profile_uid_and_name: Vec<(String, String)>,
    pub is_lightweight_mode: bool,
}

pub(crate) async fn load_tray_toggle_state() -> Result<TrayToggleState> {
    let verge = Config::verge().await.latest_ref().clone();
    Ok(TrayToggleState {
        system_proxy_enabled: verge.enable_system_proxy.unwrap_or(false),
        tun_mode_enabled: verge.enable_tun_mode.unwrap_or(false),
    })
}

pub(crate) async fn load_tray_menu_inputs() -> Result<TrayMenuInputs> {
    let toggles = load_tray_toggle_state().await?;
    let mode = Config::clash()
        .await
        .latest_ref()
        .0
        .get("mode")
        .and_then(|value| value.as_str())
        .unwrap_or("rule")
        .to_owned();
    let profile_uid_and_name = Config::profiles()
        .await
        .data_mut()
        .all_profile_uid_and_name()
        .unwrap_or_default()
        .into_iter()
        .map(|(uid, name)| (uid.to_string(), name.to_string()))
        .collect::<Vec<_>>();
    let is_lightweight_mode = is_in_lightweight_mode();

    Ok(TrayMenuInputs {
        toggles,
        mode,
        profile_uid_and_name,
        is_lightweight_mode,
    })
}

/// Tray icon bytes loaded from disk or bundled assets.
#[derive(Clone)]
pub(crate) struct TrayIconBytes {
    pub is_override: bool,
    pub bytes: Vec<u8>,
}

impl TrayIconBytes {
    pub fn new(is_override: bool, bytes: Vec<u8>) -> Self {
        Self { is_override, bytes }
    }
}

/// Fetch the common tray icon based on configuration overrides.
pub(crate) async fn get_common_tray_icon() -> TrayIconBytes {
    let verge = Config::verge().await.latest_ref().clone();
    let is_common_tray_icon = verge.common_tray_icon.unwrap_or(false);
    if is_common_tray_icon
        && let Ok(Some(common_icon_path)) = find_target_icons("common")
        && let Ok(icon_data) = std::fs::read(common_icon_path)
    {
        return TrayIconBytes::new(true, icon_data);
    }
    #[cfg(target_os = "macos")]
    {
        let tray_icon_colorful = verge.tray_icon.unwrap_or("monochrome".into());
        if tray_icon_colorful == "monochrome" {
            return TrayIconBytes::new(
                false,
                include_bytes!("../../../icons/tray-icon-mono.ico").to_vec(),
            );
        }
        return TrayIconBytes::new(
            false,
            include_bytes!("../../../icons/tray-icon.ico").to_vec(),
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        TrayIconBytes::new(
            false,
            include_bytes!("../../../icons/tray-icon.ico").to_vec(),
        )
    }
}

/// Fetch the system proxy tray icon based on configuration overrides.
pub(crate) async fn get_sysproxy_tray_icon() -> TrayIconBytes {
    let verge = Config::verge().await.latest_ref().clone();
    let is_sysproxy_tray_icon = verge.sysproxy_tray_icon.unwrap_or(false);
    if is_sysproxy_tray_icon
        && let Ok(Some(sysproxy_icon_path)) = find_target_icons("sysproxy")
        && let Ok(icon_data) = std::fs::read(sysproxy_icon_path)
    {
        return TrayIconBytes::new(true, icon_data);
    }
    #[cfg(target_os = "macos")]
    {
        let tray_icon_colorful = verge.tray_icon.clone().unwrap_or("monochrome".into());
        if tray_icon_colorful == "monochrome" {
            return TrayIconBytes::new(
                false,
                include_bytes!("../../../icons/tray-icon-sys-mono-new.ico").to_vec(),
            );
        }
        return TrayIconBytes::new(
            false,
            include_bytes!("../../../icons/tray-icon-sys.ico").to_vec(),
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        TrayIconBytes::new(
            false,
            include_bytes!("../../../icons/tray-icon-sys.ico").to_vec(),
        )
    }
}

/// Fetch the TUN tray icon based on configuration overrides.
pub(crate) async fn get_tun_tray_icon() -> TrayIconBytes {
    let verge = Config::verge().await.latest_ref().clone();
    let is_tun_tray_icon = verge.tun_tray_icon.unwrap_or(false);
    if is_tun_tray_icon
        && let Ok(Some(tun_icon_path)) = find_target_icons("tun")
        && let Ok(icon_data) = std::fs::read(tun_icon_path)
    {
        return TrayIconBytes::new(true, icon_data);
    }
    #[cfg(target_os = "macos")]
    {
        let tray_icon_colorful = verge.tray_icon.unwrap_or("monochrome".into());
        if tray_icon_colorful == "monochrome" {
            return TrayIconBytes::new(
                false,
                include_bytes!("../../../icons/tray-icon-tun-mono-new.ico").to_vec(),
            );
        }
        return TrayIconBytes::new(
            false,
            include_bytes!("../../../icons/tray-icon-tun.ico").to_vec(),
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        TrayIconBytes::new(
            false,
            include_bytes!("../../../icons/tray-icon-tun.ico").to_vec(),
        )
    }
}

/// Menu shortcut descriptor shared across backends.
#[derive(Clone, Debug)]
pub(crate) struct MenuShortcut(String);

impl MenuShortcut {
    pub fn new(raw: String) -> Self {
        Self(raw)
    }

    #[cfg(not(target_os = "linux"))]
    pub fn raw(&self) -> &str {
        &self.0
    }

    /// Convert the raw shortcut into a ksni-compatible multi-accelerator representation.
    pub fn to_ksni_shortcut(&self) -> Vec<Vec<String>> {
        let mut result = Vec::new();
        for combo in self.0.split(',') {
            let parts = combo.trim();
            if parts.is_empty() {
                continue;
            }
            let segments: Vec<String> = parts
                .split('+')
                .map(|segment| translate_modifier(segment.trim()))
                .collect();
            if !segments.is_empty() {
                result.push(segments);
            }
        }
        result
    }

    pub fn display(&self) -> &str {
        &self.0
    }
}

fn translate_modifier(segment: &str) -> String {
    match segment.to_ascii_lowercase().as_str() {
        "cmdorcontrol" | "command" | "cmd" => "Control".into(),
        "ctrl" | "control" => "Control".into(),
        "alt" => "Alt".into(),
        "shift" => "Shift".into(),
        "super" | "meta" | "win" => "Super".into(),
        other => {
            if other.len() == 1 {
                other.to_uppercase()
            } else {
                // Return segment as-is for unknown keywords
                segment.to_string()
            }
        }
    }
}

/// Data structure representing the full tray menu tree.
#[derive(Clone, Debug)]
pub(crate) struct TrayMenuModel {
    pub items: Vec<TrayMenuNode>,
}

impl TrayMenuModel {
    pub fn new(items: Vec<TrayMenuNode>) -> Self {
        Self { items }
    }
}

/// Node within the tray menu tree.
#[derive(Clone, Debug)]
pub(crate) enum TrayMenuNode {
    Standard(TrayStandardItem),
    Check(TrayCheckItem),
    Separator,
    Submenu(TraySubmenu),
}

#[derive(Clone, Debug)]
pub(crate) struct TrayStandardItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub shortcut: Option<MenuShortcut>,
}

#[derive(Clone, Debug)]
pub(crate) struct TrayCheckItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub checked: bool,
    pub shortcut: Option<MenuShortcut>,
}

#[derive(Clone, Debug)]
pub(crate) struct TraySubmenu {
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub items: Vec<TrayMenuNode>,
}

/// Collect all data needed for constructing the tray menu and convert it into a shared model.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn build_tray_menu_model(
    mode: Option<&str>,
    system_proxy_enabled: bool,
    tun_mode_enabled: bool,
    profile_uid_and_name: Vec<(String, String)>,
    is_lightweight_mode: bool,
) -> Result<TrayMenuModel> {
    let mode = mode.unwrap_or("");

    let current_profile_selected = {
        let profiles_config = Config::profiles().await;
        let profiles_ref = profiles_config.latest_ref();
        profiles_ref
            .get_current()
            .and_then(|uid| profiles_ref.get_item(&uid).ok())
            .and_then(|profile| profile.selected.clone())
            .unwrap_or_default()
    };

    let proxy_nodes_data = handle::Handle::mihomo().await.get_proxies().await;

    let runtime_proxy_groups_order = cmd::get_runtime_config()
        .await
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
                        .map(|name| name.to_string())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_default()
        });

    let proxy_group_order_map = runtime_proxy_groups_order.as_ref().map(|group_names| {
        group_names
            .iter()
            .enumerate()
            .map(|(index, name)| (name.clone(), index))
            .collect::<HashMap<String, usize>>()
    });

    let verge_settings = Config::verge().await.latest_ref().clone();
    let show_proxy_groups_inline = verge_settings.tray_inline_proxy_groups.unwrap_or(false);
    let hotkeys: HashMap<String, MenuShortcut> = verge_settings
        .hotkeys
        .as_ref()
        .map(|h| {
            h.iter()
                .filter_map(|item| {
                    let mut parts = item.split(',');
                    match (parts.next(), parts.next()) {
                        (Some(func), Some(key)) => Some((
                            func.trim().to_string(),
                            MenuShortcut::new(key.trim().to_string()),
                        )),
                        _ => None,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let mut profile_items = Vec::new();
    for (profile_uid, profile_name) in profile_uid_and_name.iter() {
        let is_current_profile = Config::profiles()
            .await
            .data_mut()
            .is_current_profile_index(profile_uid.clone().into());
        profile_items.push(TrayMenuNode::Check(TrayCheckItem {
            id: format!("profiles_{profile_uid}"),
            label: t(profile_name).await,
            enabled: true,
            checked: is_current_profile,
            shortcut: None,
        }));
    }

    let proxy_group_nodes: Vec<TraySubmenu> = {
        let mut submenus: Vec<(String, usize, TraySubmenu)> = Vec::new();
        if let Ok(proxy_nodes_data) = proxy_nodes_data.as_ref() {
            for (group_name, group_data) in proxy_nodes_data.proxies.iter() {
                let should_show = match mode {
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

                let mut group_items = Vec::new();

                for proxy_str in all_proxies {
                    let is_selected = *proxy_str == now_proxy;
                    let item_id = format!("proxy_{group_name}_{proxy_str}");

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

                    let display_text = format!("{proxy_str}   | {delay_text}");

                    group_items.push(TrayMenuNode::Check(TrayCheckItem {
                        id: item_id,
                        label: display_text,
                        enabled: true,
                        checked: is_selected,
                        shortcut: None,
                    }));
                }

                if group_items.is_empty() {
                    continue;
                }

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
                    format!("★{group_name}")
                } else {
                    group_name.to_string()
                };

                let submenu = TraySubmenu {
                    id: format!("proxy_group_{group_name}"),
                    label: group_display_name,
                    enabled: true,
                    items: group_items,
                };

                let insertion_index = submenus.len();
                submenus.push((group_name.to_string(), insertion_index, submenu));
            }
        }

        if let Some(order_map) = proxy_group_order_map.as_ref() {
            submenus.sort_by(
                |(name_a, original_index_a, _), (name_b, original_index_b, _)| match (
                    order_map.get(name_a),
                    order_map.get(name_b),
                ) {
                    (Some(index_a), Some(index_b)) => index_a.cmp(index_b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => original_index_a.cmp(original_index_b),
                },
            );
        }

        submenus
            .into_iter()
            .map(|(_, _, submenu)| submenu)
            .collect()
    };

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

    let mut root_items = vec![
        TrayMenuNode::Standard(TrayStandardItem {
            id: "open_window".into(),
            label: dashboard_text,
            enabled: true,
            shortcut: hotkeys.get("open_or_close_dashboard").cloned(),
        }),
        TrayMenuNode::Separator,
        TrayMenuNode::Check(TrayCheckItem {
            id: "rule_mode".into(),
            label: rule_mode_text,
            enabled: true,
            checked: mode == "rule",
            shortcut: hotkeys.get("clash_mode_rule").cloned(),
        }),
        TrayMenuNode::Check(TrayCheckItem {
            id: "global_mode".into(),
            label: global_mode_text,
            enabled: true,
            checked: mode == "global",
            shortcut: hotkeys.get("clash_mode_global").cloned(),
        }),
        TrayMenuNode::Check(TrayCheckItem {
            id: "direct_mode".into(),
            label: direct_mode_text,
            enabled: true,
            checked: mode == "direct",
            shortcut: hotkeys.get("clash_mode_direct").cloned(),
        }),
        TrayMenuNode::Separator,
        TrayMenuNode::Submenu(TraySubmenu {
            id: "profiles".into(),
            label: profiles_text,
            enabled: true,
            items: profile_items,
        }),
    ];

    if show_proxy_groups_inline {
        for submenu in proxy_group_nodes.iter() {
            root_items.push(TrayMenuNode::Submenu(submenu.clone()));
        }
    } else if !proxy_group_nodes.is_empty() {
        let items = proxy_group_nodes
            .iter()
            .cloned()
            .map(TrayMenuNode::Submenu)
            .collect();
        root_items.push(TrayMenuNode::Submenu(TraySubmenu {
            id: "proxies".into(),
            label: proxies_text,
            enabled: true,
            items,
        }));
    }

    root_items.push(TrayMenuNode::Separator);

    root_items.push(TrayMenuNode::Check(TrayCheckItem {
        id: "system_proxy".into(),
        label: system_proxy_text,
        enabled: true,
        checked: system_proxy_enabled,
        shortcut: hotkeys.get("toggle_system_proxy").cloned(),
    }));
    root_items.push(TrayMenuNode::Check(TrayCheckItem {
        id: "tun_mode".into(),
        label: tun_mode_text,
        enabled: true,
        checked: tun_mode_enabled,
        shortcut: hotkeys.get("toggle_tun_mode").cloned(),
    }));

    root_items.push(TrayMenuNode::Separator);

    root_items.push(TrayMenuNode::Check(TrayCheckItem {
        id: "entry_lightweight_mode".into(),
        label: lightweight_mode_text,
        enabled: true,
        checked: is_lightweight_mode,
        shortcut: hotkeys.get("entry_lightweight_mode").cloned(),
    }));

    root_items.push(TrayMenuNode::Standard(TrayStandardItem {
        id: "copy_env".into(),
        label: copy_env_text,
        enabled: true,
        shortcut: None,
    }));

    let open_dir_items = vec![
        TrayMenuNode::Standard(TrayStandardItem {
            id: "open_app_dir".into(),
            label: conf_dir_text,
            enabled: true,
            shortcut: None,
        }),
        TrayMenuNode::Standard(TrayStandardItem {
            id: "open_core_dir".into(),
            label: core_dir_text,
            enabled: true,
            shortcut: None,
        }),
        TrayMenuNode::Standard(TrayStandardItem {
            id: "open_logs_dir".into(),
            label: logs_dir_text,
            enabled: true,
            shortcut: None,
        }),
    ];

    root_items.push(TrayMenuNode::Submenu(TraySubmenu {
        id: "open_dir".into(),
        label: open_dir_text,
        enabled: true,
        items: open_dir_items,
    }));

    let version = env!("CARGO_PKG_VERSION");

    let more_items = vec![
        TrayMenuNode::Standard(TrayStandardItem {
            id: "restart_clash".into(),
            label: restart_clash_text,
            enabled: true,
            shortcut: None,
        }),
        TrayMenuNode::Standard(TrayStandardItem {
            id: "restart_app".into(),
            label: restart_app_text,
            enabled: true,
            shortcut: None,
        }),
        TrayMenuNode::Standard(TrayStandardItem {
            id: "app_version".into(),
            label: format!("{} {version}", verge_version_text),
            enabled: true,
            shortcut: None,
        }),
    ];

    root_items.push(TrayMenuNode::Submenu(TraySubmenu {
        id: "more".into(),
        label: more_text,
        enabled: true,
        items: more_items,
    }));

    root_items.push(TrayMenuNode::Separator);

    root_items.push(TrayMenuNode::Standard(TrayStandardItem {
        id: "quit".into(),
        label: exit_text,
        enabled: true,
        shortcut: Some(MenuShortcut::new("CmdOrControl+Q".into())),
    }));

    Ok(TrayMenuModel::new(root_items))
}

pub(crate) async fn generate_tray_menu_model() -> Result<(TrayMenuModel, TrayMenuInputs)> {
    let inputs = load_tray_menu_inputs().await?;
    let menu = build_tray_menu_model(
        Some(inputs.mode.as_str()),
        inputs.toggles.system_proxy_enabled,
        inputs.toggles.tun_mode_enabled,
        inputs.profile_uid_and_name.clone(),
        inputs.is_lightweight_mode,
    )
    .await?;
    Ok((menu, inputs))
}

/// Build the tooltip text used by both backends.
pub(crate) async fn build_tooltip_text() -> Result<String> {
    let verge = Config::verge().await.latest_ref().clone();
    let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
    let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

    let switch_map = {
        let mut map = HashMap::new();
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
            && let Some(profile_name) = &profile.name
        {
            current_profile_name = profile_name.to_string();
        }
    }

    let sys_proxy_text = t("SysProxy").await;
    let tun_text = t("TUN").await;
    let profile_text = t("Profile").await;

    let version = env!("CARGO_PKG_VERSION");
    let reassembled_version = version.split_once('+').map_or_else(
        || version.into(),
        |(main, rest)| format!("{main}+{}", rest.split('.').next().unwrap_or("")),
    );

    Ok(format!(
        "Clash Verge {}\n{}: {}\n{}: {}\n{}: {}",
        reassembled_version,
        sys_proxy_text,
        switch_map[system_proxy],
        tun_text,
        switch_map[tun_mode],
        profile_text,
        current_profile_name
    ))
}

/// Left-click behaviour configuration translated into concrete actions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TrayClickAction {
    ShowMenu,
    ToggleSystemProxy,
    ToggleTunMode,
    ShowMainWindow,
    None,
}

pub(crate) async fn resolve_tray_click_action() -> TrayClickAction {
    let tray_event = Config::verge()
        .await
        .latest_ref()
        .tray_event
        .clone()
        .unwrap_or_else(|| "main_window".into());

    match tray_event.as_str() {
        "tray_menu" => TrayClickAction::ShowMenu,
        "system_proxy" => TrayClickAction::ToggleSystemProxy,
        "tun_mode" => TrayClickAction::ToggleTunMode,
        "main_window" => TrayClickAction::ShowMainWindow,
        _ => TrayClickAction::None,
    }
}

pub(crate) async fn perform_tray_click_action(action: TrayClickAction) {
    match action {
        TrayClickAction::ToggleSystemProxy => {
            feat::toggle_system_proxy().await;
        }
        TrayClickAction::ToggleTunMode => {
            feat::toggle_tun_mode(None).await;
        }
        TrayClickAction::ShowMainWindow => {
            if !lightweight::exit_lightweight_mode().await {
                WindowManager::show_main_window().await;
            }
        }
        TrayClickAction::ShowMenu | TrayClickAction::None => {}
    }
}

/// Execute menu command identified by `id`.
pub(crate) async fn handle_menu_command(id: &str) {
    match id {
        "rule_mode" | "global_mode" | "direct_mode" => {
            let mode = &id[..id.len() - 5];
            logging!(info, Type::ProxyMode, "Switch Proxy Mode To: {}", mode);
            feat::change_clash_mode(mode.into()).await;
        }
        "open_window" => {
            log::info!(target: "app", "托盘菜单点击: 打开窗口");
            if should_handle_tray_click() && !lightweight::exit_lightweight_mode().await {
                WindowManager::show_main_window().await;
            }
        }
        "system_proxy" => {
            feat::toggle_system_proxy().await;
        }
        "tun_mode" => {
            feat::toggle_tun_mode(None).await;
        }
        "copy_env" => {
            feat::copy_clash_env().await;
        }
        "open_app_dir" => {
            let _ = cmd::open_app_dir().await;
        }
        "open_core_dir" => {
            let _ = cmd::open_core_dir().await;
        }
        "open_logs_dir" => {
            let _ = cmd::open_logs_dir().await;
        }
        "restart_clash" => {
            feat::restart_clash_core().await;
        }
        "restart_app" => {
            feat::restart_app().await;
        }
        "entry_lightweight_mode" => {
            if should_handle_tray_click() {
                if !is_in_lightweight_mode() {
                    lightweight::entry_lightweight_mode().await;
                } else {
                    lightweight::exit_lightweight_mode().await;
                }
            }
        }
        "quit" => {
            feat::quit().await;
        }
        id if id.starts_with("profiles_") => {
            let profile_index = &id["profiles_".len()..];
            feat::toggle_proxy_profile(profile_index.into()).await;
        }
        id if id.starts_with("proxy_") => {
            let parts: Vec<&str> = id.splitn(3, '_').collect();
            if parts.len() == 3 && parts[0] == "proxy" {
                let group_name = parts[1];
                let proxy_name = parts[2];
                match handle::Handle::mihomo()
                    .await
                    .select_node_for_group(group_name, proxy_name)
                    .await
                {
                    Ok(_) => {
                        log::info!(
                            target: "app",
                            "切换代理成功: {} -> {}",
                            group_name,
                            proxy_name
                        );
                        let _ =
                            handle::Handle::app_handle().emit("verge://refresh-proxy-config", ());
                    }
                    Err(e) => {
                        log::error!(
                            target: "app",
                            "切换代理失败: {} -> {}, 错误: {:?}",
                            group_name,
                            proxy_name,
                            e
                        );

                        if handle::Handle::mihomo()
                            .await
                            .select_node_for_group(group_name, proxy_name)
                            .await
                            .is_ok()
                        {
                            log::info!(
                                target: "app",
                                "代理切换回退成功: {} -> {}",
                                group_name,
                                proxy_name
                            );

                            let app_handle = handle::Handle::app_handle();
                            let _ = app_handle.emit("verge://force-refresh-proxies", ());
                        }
                    }
                }
            }
        }
        _ => {}
    }
}
