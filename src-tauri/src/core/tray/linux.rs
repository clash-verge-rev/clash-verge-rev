use std::{
    io::Cursor,
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
use image::{ImageFormat, ImageReader, imageops::FilterType};
use ksni::{
    ContextMenuResponse, Icon, ToolTip, TrayMethods,
    menu::{CheckmarkItem, MenuItem, StandardItem, SubMenu},
};
use log::{debug, warn};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::{
    Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, dpi::LogicalPosition,
    window::Position,
};
use tokio::sync::Mutex as AsyncMutex;

use crate::{core::handle, process::AsyncHandler, singleton_lazy};

use super::shared::{
    TrayClickAction, TrayMenuModel, TrayMenuNode, build_tooltip_text, generate_tray_menu_model,
    get_common_tray_icon, get_sysproxy_tray_icon, get_tun_tray_icon, handle_menu_command,
    load_tray_toggle_state, perform_tray_click_action, resolve_tray_click_action,
    should_handle_tray_click,
};

const MIN_UPDATE_INTERVAL: Duration = Duration::from_millis(100);

fn is_running_on_gnome() -> bool {
    static IS_GNOME: OnceLock<bool> = OnceLock::new();
    *IS_GNOME.get_or_init(|| {
        for key in [
            "XDG_CURRENT_DESKTOP",
            "DESKTOP_SESSION",
            "GNOME_SHELL_SESSION_MODE",
        ] {
            if let Ok(value) = std::env::var(key) {
                if value.to_ascii_lowercase().contains("gnome") {
                    return true;
                }
            }
        }
        false
    })
}

const GNOME_TRAY_WINDOW_LABEL: &str = "gnome-tray-menu";

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum FrontendTrayNode {
    Standard {
        uid: String,
        id: String,
        label: String,
        enabled: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        shortcut: Option<String>,
    },
    Check {
        uid: String,
        id: String,
        label: String,
        enabled: bool,
        checked: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        shortcut: Option<String>,
    },
    Separator {
        uid: String,
    },
    Submenu {
        uid: String,
        id: String,
        label: String,
        enabled: bool,
        items: Vec<FrontendTrayNode>,
    },
}

#[derive(Debug, Serialize)]
struct TrayMenuPayload {
    items: Vec<FrontendTrayNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<TrayMenuPosition>,
}

#[derive(Debug, Serialize)]
struct TrayMenuPosition {
    x: i32,
    y: i32,
}

fn convert_menu_nodes_to_frontend(nodes: &[TrayMenuNode], path: &str) -> Vec<FrontendTrayNode> {
    nodes
        .iter()
        .enumerate()
        .map(|(index, node)| {
            let base_path = if path.is_empty() {
                index.to_string()
            } else {
                format!("{path}/{index}")
            };

            match node {
                TrayMenuNode::Standard(item) => FrontendTrayNode::Standard {
                    uid: format!("{base_path}:{}", item.id),
                    id: item.id.clone(),
                    label: item.label.clone(),
                    enabled: item.enabled,
                    shortcut: item
                        .shortcut
                        .as_ref()
                        .map(|shortcut| shortcut.display().to_string()),
                },
                TrayMenuNode::Check(item) => FrontendTrayNode::Check {
                    uid: format!("{base_path}:{}", item.id),
                    id: item.id.clone(),
                    label: item.label.clone(),
                    enabled: item.enabled,
                    checked: item.checked,
                    shortcut: item
                        .shortcut
                        .as_ref()
                        .map(|shortcut| shortcut.display().to_string()),
                },
                TrayMenuNode::Separator => FrontendTrayNode::Separator {
                    uid: format!("{base_path}:separator"),
                },
                TrayMenuNode::Submenu(submenu) => {
                    let submenu_path = format!("{base_path}:{}", submenu.id);
                    FrontendTrayNode::Submenu {
                        uid: submenu_path.clone(),
                        id: submenu.id.clone(),
                        label: submenu.label.clone(),
                        enabled: submenu.enabled,
                        items: convert_menu_nodes_to_frontend(&submenu.items, &submenu_path),
                    }
                }
            }
        })
        .collect()
}

fn ensure_gnome_tray_window() -> Result<WebviewWindow> {
    let app_handle = handle::Handle::app_handle();

    if let Some(window) = app_handle.get_webview_window(GNOME_TRAY_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app_handle,
        GNOME_TRAY_WINDOW_LABEL,
        WebviewUrl::App("entries/tray-menu/index.html".into()),
    )
    .title("Clash Verge Tray")
    .visible(false)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .inner_size(360.0, 480.0)
    .build()
    .context("failed to build GNOME tray menu window")?;

    Ok(window)
}

fn compute_window_position(
    window: &WebviewWindow,
    pointer: Option<(i32, i32)>,
) -> LogicalPosition<f64> {
    let mut x = 40.0;
    let mut y = 40.0;

    if let Some((px, py)) = pointer {
        x = (px - 12).max(0) as f64;
        y = (py - 12).max(0) as f64;
    }

    if let Ok(Some(monitor)) = window.current_monitor() {
        let monitor_size = monitor.size();
        if let Ok(window_size) = window.inner_size() {
            let width = window_size.width as f64;
            let height = window_size.height as f64;
            let max_x = (monitor_size.width as f64 - width).max(0.0);
            let max_y = (monitor_size.height as f64 - height).max(0.0);
            x = x.clamp(0.0, max_x);
            y = y.clamp(0.0, max_y);
        }
    }

    LogicalPosition::new(x, y)
}

fn show_gnome_tray_window(menu: &TrayMenuModel, pointer: Option<(i32, i32)>) -> Result<()> {
    let window = ensure_gnome_tray_window()?;

    let payload = TrayMenuPayload {
        items: convert_menu_nodes_to_frontend(&menu.items, ""),
        position: pointer.map(|(x, y)| TrayMenuPosition { x, y }),
    };

    let position = compute_window_position(&window, pointer);

    window
        .emit("tray-menu://update", payload)
        .context("failed to emit GNOME tray menu payload")?;
    window
        .set_position(Position::Logical(position))
        .context("failed to position GNOME tray window")?;
    window.show().context("failed to show GNOME tray window")?;
    let _ = window.set_focus();
    Ok(())
}

pub(crate) fn hide_gnome_tray_window() {
    if let Some(window) = handle::Handle::app_handle().get_webview_window(GNOME_TRAY_WINDOW_LABEL) {
        let _ = window.emit("tray-menu://hide", json!({}));
        let _ = window.hide();
    }
}

pub(crate) fn schedule_tray_action(id: String) {
    AsyncHandler::spawn(move || async move {
        debug!(target: "app", "ksni: scheduling menu action for id={id}");
        handle_menu_command(&id).await;
        if let Err(e) = crate::core::tray::Tray::global().update_all_states().await {
            warn!(target: "app", "ksni: failed to refresh tray state: {e}");
        }
    });
}

fn dispatch_gnome_tray_menu(x: i32, y: i32) {
    AsyncHandler::spawn(move || async move {
        if let Err(e) = crate::core::tray::Tray::global()
            .show_gnome_tray_menu(x, y)
            .await
        {
            warn!(target: "app", "ksni: failed to show GNOME tray menu: {e}");
        }
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BackendVariant {
    Menu,
    Action,
}

impl From<TrayClickAction> for BackendVariant {
    fn from(action: TrayClickAction) -> Self {
        match action {
            TrayClickAction::ShowMenu => BackendVariant::Menu,
            _ => BackendVariant::Action,
        }
    }
}

#[derive(Clone)]
struct KsniTrayState {
    icon_pixmap: Vec<Icon>,
    icon_name: String,
    tooltip: ToolTip,
    menu_model: TrayMenuModel,
    click_action: TrayClickAction,
}

impl Default for KsniTrayState {
    fn default() -> Self {
        Self {
            icon_pixmap: Vec::new(),
            icon_name: String::new(),
            tooltip: ToolTip::default(),
            menu_model: TrayMenuModel::new(Vec::new()),
            click_action: TrayClickAction::ShowMainWindow,
        }
    }
}

struct KsniTray<const MENU_ON_ACTIVATE: bool> {
    state: Mutex<KsniTrayState>,
}

impl<const MENU_ON_ACTIVATE: bool> KsniTray<MENU_ON_ACTIVATE> {
    fn new() -> Self {
        Self {
            state: Mutex::new(KsniTrayState::default()),
        }
    }

    fn set_menu_model(&self, model: TrayMenuModel) {
        self.state.lock().menu_model = model;
    }

    fn set_click_action(&self, action: TrayClickAction) {
        self.state.lock().click_action = action;
    }

    fn set_icon(&self, icons: Vec<Icon>, icon_name: String) {
        let mut state = self.state.lock();
        state.icon_pixmap = icons;
        state.icon_name = icon_name;
    }

    fn set_tooltip(&self, tooltip: ToolTip) {
        self.state.lock().tooltip = tooltip;
    }

    fn build_menu_items(&self, nodes: &[TrayMenuNode]) -> Vec<MenuItem<Self>> {
        nodes.iter().map(|node| self.convert_node(node)).collect()
    }

    fn convert_node(&self, node: &TrayMenuNode) -> MenuItem<Self> {
        match node {
            TrayMenuNode::Standard(item) => {
                let mut standard = StandardItem {
                    label: item.label.clone(),
                    enabled: item.enabled,
                    ..StandardItem::default()
                };
                if let Some(shortcut) = item.shortcut.as_ref() {
                    standard.shortcut = shortcut.to_ksni_shortcut();
                }
                let id = item.id.clone();
                standard.activate = Box::new(move |_this: &mut Self| {
                    Self::schedule_menu_action(id.clone());
                });
                standard.into()
            }
            TrayMenuNode::Check(item) => {
                let mut check = CheckmarkItem {
                    label: item.label.clone(),
                    enabled: item.enabled,
                    checked: item.checked,
                    ..CheckmarkItem::default()
                };
                if let Some(shortcut) = item.shortcut.as_ref() {
                    check.shortcut = shortcut.to_ksni_shortcut();
                }
                let id = item.id.clone();
                check.activate = Box::new(move |_this: &mut Self| {
                    Self::schedule_menu_action(id.clone());
                });
                check.into()
            }
            TrayMenuNode::Separator => MenuItem::Separator,
            TrayMenuNode::Submenu(submenu) => SubMenu {
                label: submenu.label.clone(),
                enabled: submenu.enabled,
                submenu: self.build_menu_items(&submenu.items),
                ..SubMenu::default()
            }
            .into(),
        }
    }

    fn schedule_menu_action(id: String) {
        schedule_tray_action(id);
    }

    fn trigger_click_action(action: TrayClickAction) {
        AsyncHandler::spawn(move || async move {
            perform_tray_click_action(action).await;
            if let Err(e) = crate::core::tray::Tray::global().update_all_states().await {
                warn!(target: "app", "ksni: failed to refresh tray state: {e}");
            }
        });
    }
}

impl<const MENU_ON_ACTIVATE: bool> ksni::Tray for KsniTray<MENU_ON_ACTIVATE> {
    const MENU_ON_ACTIVATE: bool = MENU_ON_ACTIVATE;

    fn id(&self) -> String {
        env!("CARGO_PKG_NAME").into()
    }

    fn title(&self) -> String {
        "Clash Verge Rev".into()
    }

    fn icon_name(&self) -> String {
        self.state.lock().icon_name.clone()
    }

    fn icon_pixmap(&self) -> Vec<Icon> {
        self.state.lock().icon_pixmap.clone()
    }

    fn tool_tip(&self) -> ToolTip {
        self.state.lock().tooltip.clone()
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        let state = self.state.lock();
        self.build_menu_items(&state.menu_model.items)
    }

    fn status(&self) -> ksni::Status {
        ksni::Status::Active
    }

    fn activate(&mut self, x: i32, y: i32) {
        if MENU_ON_ACTIVATE {
            return;
        }

        let action = { self.state.lock().click_action };

        if is_running_on_gnome()
            && matches!(action, TrayClickAction::ShowMenu | TrayClickAction::None)
        {
            dispatch_gnome_tray_menu(x, y);
            return;
        }

        if !should_handle_tray_click() {
            return;
        }

        if matches!(action, TrayClickAction::ShowMenu | TrayClickAction::None) {
            // Fallback: nothing to do, the environment will open menu via secondary click.
            return;
        }

        Self::trigger_click_action(action);
    }

    fn context_menu(&mut self, x: i32, y: i32) -> ContextMenuResponse {
        if MENU_ON_ACTIVATE {
            return ContextMenuResponse::ShowMenu;
        }

        if is_running_on_gnome() {
            dispatch_gnome_tray_menu(x, y);
            return ContextMenuResponse::Suppress;
        }

        let action = { self.state.lock().click_action };
        if matches!(action, TrayClickAction::ShowMenu | TrayClickAction::None) {
            return ContextMenuResponse::ShowMenu;
        }

        if should_handle_tray_click() {
            Self::trigger_click_action(action);
            ContextMenuResponse::Suppress
        } else {
            debug!(
                target: "app",
                "ksni: context menu request fell back to host menu due to debounce"
            );
            ContextMenuResponse::ShowMenu
        }
    }
}

enum LinuxTrayHandle {
    Menu(ksni::Handle<KsniTray<true>>),
    Action(ksni::Handle<KsniTray<false>>),
}

impl LinuxTrayHandle {
    fn variant(&self) -> BackendVariant {
        match self {
            LinuxTrayHandle::Menu(_) => BackendVariant::Menu,
            LinuxTrayHandle::Action(_) => BackendVariant::Action,
        }
    }

    fn is_closed(&self) -> bool {
        match self {
            LinuxTrayHandle::Menu(handle) => handle.is_closed(),
            LinuxTrayHandle::Action(handle) => handle.is_closed(),
        }
    }

    fn clone_handle(&self) -> Self {
        match self {
            LinuxTrayHandle::Menu(handle) => LinuxTrayHandle::Menu(handle.clone()),
            LinuxTrayHandle::Action(handle) => LinuxTrayHandle::Action(handle.clone()),
        }
    }

    async fn shutdown(self) {
        match self {
            LinuxTrayHandle::Menu(handle) => {
                let _ = handle.shutdown().await;
            }
            LinuxTrayHandle::Action(handle) => {
                let _ = handle.shutdown().await;
            }
        }
    }

    async fn spawn(variant: BackendVariant, action: TrayClickAction) -> Result<Self> {
        match variant {
            BackendVariant::Menu => {
                let tray = KsniTray::<true>::new();
                let handle = tray
                    .spawn()
                    .await
                    .context("failed to spawn ksni tray (menu variant)")?;
                if handle
                    .update(|tray| tray.set_click_action(TrayClickAction::ShowMenu))
                    .await
                    .is_none()
                {
                    return Err(anyhow!("ksni tray service closed immediately"));
                }
                Ok(LinuxTrayHandle::Menu(handle))
            }
            BackendVariant::Action => {
                let tray = KsniTray::<false>::new();
                let handle = tray
                    .spawn()
                    .await
                    .context("failed to spawn ksni tray (action variant)")?;
                if handle
                    .update(|tray| tray.set_click_action(action))
                    .await
                    .is_none()
                {
                    return Err(anyhow!("ksni tray service closed immediately"));
                }
                Ok(LinuxTrayHandle::Action(handle))
            }
        }
    }

    async fn update_menu(&self, model: TrayMenuModel) -> Result<()> {
        let result = match self {
            LinuxTrayHandle::Menu(handle) => {
                handle
                    .update(|tray| tray.set_menu_model(model.clone()))
                    .await
            }
            LinuxTrayHandle::Action(handle) => {
                handle
                    .update(|tray| tray.set_menu_model(model.clone()))
                    .await
            }
        };
        if result.is_none() {
            Err(anyhow!("ksni tray handle closed while updating menu"))
        } else {
            Ok(())
        }
    }

    async fn update_click_action(&self, action: TrayClickAction) -> Result<()> {
        let result = match self {
            LinuxTrayHandle::Menu(handle) => {
                handle
                    .update(|tray| tray.set_click_action(TrayClickAction::ShowMenu))
                    .await
            }
            LinuxTrayHandle::Action(handle) => {
                handle.update(|tray| tray.set_click_action(action)).await
            }
        };
        if result.is_none() {
            Err(anyhow!(
                "ksni tray handle closed while updating click action"
            ))
        } else {
            Ok(())
        }
    }

    async fn update_icon(&self, icons: Vec<Icon>, icon_name: String) -> Result<()> {
        let result = match self {
            LinuxTrayHandle::Menu(handle) => {
                handle
                    .update(|tray| tray.set_icon(icons.clone(), icon_name.clone()))
                    .await
            }
            LinuxTrayHandle::Action(handle) => {
                handle
                    .update(|tray| tray.set_icon(icons.clone(), icon_name.clone()))
                    .await
            }
        };
        if result.is_none() {
            Err(anyhow!("ksni tray handle closed while updating icon"))
        } else {
            Ok(())
        }
    }

    async fn update_tooltip(&self, tooltip: ToolTip) -> Result<()> {
        let result = match self {
            LinuxTrayHandle::Menu(handle) => {
                handle
                    .update(|tray| tray.set_tooltip(tooltip.clone()))
                    .await
            }
            LinuxTrayHandle::Action(handle) => {
                handle
                    .update(|tray| tray.set_tooltip(tooltip.clone()))
                    .await
            }
        };
        if result.is_none() {
            Err(anyhow!("ksni tray handle closed while updating tooltip"))
        } else {
            Ok(())
        }
    }
}

impl Clone for LinuxTrayHandle {
    fn clone(&self) -> Self {
        self.clone_handle()
    }
}

pub struct Tray {
    last_menu_update: Mutex<Option<Instant>>,
    menu_updating: AtomicBool,
    handle: AsyncMutex<Option<LinuxTrayHandle>>,
}

impl Default for Tray {
    fn default() -> Self {
        Self {
            last_menu_update: Mutex::new(None),
            menu_updating: AtomicBool::new(false),
            handle: AsyncMutex::new(None),
        }
    }
}

singleton_lazy!(Tray, TRAY, Tray::default);

impl Tray {
    pub async fn init(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }
        debug!(target: "app", "ksni: initializing tray");
        self.ensure_handle(resolve_tray_click_action().await)
            .await?;
        self.update_all_states().await?;
        Ok(())
    }

    async fn ensure_handle(&self, action: TrayClickAction) -> Result<LinuxTrayHandle> {
        let desired_variant = BackendVariant::from(action);
        let mut guard = self.handle.lock().await;
        let needs_new_handle = guard
            .as_ref()
            .is_none_or(|handle| handle.variant() != desired_variant || handle.is_closed());

        if needs_new_handle {
            debug!(
                target: "app",
                "ksni: spawning new tray handle for variant={:?}",
                desired_variant
            );
            if let Some(existing) = guard.take() {
                debug!(target: "app", "ksni: shutting down existing tray handle");
                existing.shutdown().await;
            }
            let handle = LinuxTrayHandle::spawn(desired_variant, action).await?;
            *guard = Some(handle);
        } else {
            debug!(target: "app", "ksni: reusing existing tray handle for variant={:?}", desired_variant);
        }

        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow!("failed to obtain ksni tray handle"))
    }

    pub async fn update_click_behavior(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        let action = resolve_tray_click_action().await;
        debug!(target: "app", "ksni: updating click behavior to action={:?}", action);
        let handle = self.ensure_handle(action).await?;
        handle.update_click_action(action).await?;
        Ok(())
    }

    pub async fn update_menu(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        if self.menu_updating.load(Ordering::Acquire) {
            debug!(target: "app", "ksni: menu update already in progress, skipping");
            return Ok(());
        }

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
            debug!(target: "app", "ksni: menu update throttled by debounce");
            return Ok(());
        }

        self.menu_updating.store(true, Ordering::Release);
        let result = self.update_menu_internal().await;
        *self.last_menu_update.lock() = Some(Instant::now());
        self.menu_updating.store(false, Ordering::Release);
        result
    }

    async fn update_menu_internal(&self) -> Result<()> {
        let (menu_model, _) = generate_tray_menu_model().await?;
        debug!(
            target: "app",
            "ksni: rebuilding tray menu with {} items",
            menu_model.items.len()
        );

        let action = resolve_tray_click_action().await;
        let handle = self.ensure_handle(action).await?;
        handle.update_menu(menu_model).await?;
        Ok(())
    }

    pub async fn update_icon(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        let toggles = load_tray_toggle_state().await?;

        let icon_bytes = match (toggles.system_proxy_enabled, toggles.tun_mode_enabled) {
            (true, true) => get_tun_tray_icon().await,
            (true, false) => get_sysproxy_tray_icon().await,
            (false, true) => get_tun_tray_icon().await,
            (false, false) => get_common_tray_icon().await,
        };

        let icons = convert_image_to_ksni_icons(&icon_bytes.bytes)?;
        debug!(
            target: "app",
            "ksni: updating icon with {} variants (override={})",
            icons.len(),
            icon_bytes.is_override
        );
        let icon_name = if icon_bytes.is_override {
            "user-tray-icon".to_string()
        } else {
            // Some AppIndicator hosts (GNOME) try to resolve theme icons first
            // and ignore provided pixmaps if the name is missing in the theme.
            // Leave the name empty to force them to use our ARGB data directly.
            String::new()
        };

        let action = resolve_tray_click_action().await;
        let handle = self.ensure_handle(action).await?;
        handle.update_icon(icons, icon_name).await?;
        Ok(())
    }

    pub async fn update_tray_display(&self) -> Result<()> {
        self.update_menu().await
    }

    async fn show_gnome_tray_menu(&self, x: i32, y: i32) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        if !is_running_on_gnome() {
            return Ok(());
        }

        let (menu_model, _) = generate_tray_menu_model().await?;
        show_gnome_tray_window(&menu_model, Some((x, y)))?;
        Ok(())
    }

    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        if is_running_on_gnome() {
            debug!(target: "app", "ksni: skipping tooltip update on GNOME.");
            return Ok(());
        }

        let tooltip_text = build_tooltip_text().await?;
        let mut tooltip = ToolTip::default();
        if let Some((title, description)) = tooltip_text.split_once('\n') {
            tooltip.title = title.to_string();
            tooltip.description = description.to_string();
        } else {
            tooltip.title = tooltip_text;
        }
        debug!(target: "app", "ksni: updating tooltip title='{}'", tooltip.title);

        let action = resolve_tray_click_action().await;
        let handle = self.ensure_handle(action).await?;
        handle.update_tooltip(tooltip).await?;
        Ok(())
    }

    pub async fn update_part(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }
        self.update_tray_display().await?;
        self.update_icon().await?;
        self.update_tooltip().await?;
        self.update_click_behavior().await?;
        Ok(())
    }

    pub async fn update_all_states(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }
        self.update_tray_display().await?;
        self.update_icon().await?;
        self.update_tooltip().await?;
        self.update_click_behavior().await?;
        Ok(())
    }
}

fn convert_image_to_ksni_icons(bytes: &[u8]) -> Result<Vec<Icon>> {
    let format = image::guess_format(bytes).unwrap_or(ImageFormat::Ico);
    let reader = ImageReader::with_format(Cursor::new(bytes), format);
    let img = reader
        .decode()
        .context("failed to decode tray icon image")?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    debug!(
        target: "app",
        "ksni: source tray icon dimensions {}x{} (format={:?})",
        width,
        height,
        format
    );

    let mut icons = Vec::new();
    let mut target_sizes = vec![16_u32, 22, 24, 32, 48, 64];
    let square_size = width.min(height);
    if square_size > 0 {
        target_sizes.push(square_size);
    }
    target_sizes.sort_unstable();
    target_sizes.dedup();

    let max_dimension = width.max(height);

    for size in target_sizes {
        if size == 0 || size > max_dimension {
            continue;
        }
        let resized = if width == size && height == size {
            rgba.clone()
        } else {
            image::imageops::resize(&rgba, size, size, FilterType::Lanczos3)
        };
        let mut data = resized.into_vec();
        for pixel in data.chunks_exact_mut(4) {
            pixel.rotate_right(1); // RGBA -> ARGB
        }
        icons.push(Icon {
            width: size as i32,
            height: size as i32,
            data,
        });
    }

    if icons.is_empty() {
        let mut data = rgba.into_vec();
        for pixel in data.chunks_exact_mut(4) {
            pixel.rotate_right(1);
        }
        icons.push(Icon {
            width: width as i32,
            height: height as i32,
            data,
        });
    }

    Ok(icons)
}
