use std::{
    io::Cursor,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
use image::{ImageFormat, ImageReader, imageops::FilterType};
use ksni::{
    Icon, ToolTip, TrayMethods,
    menu::{CheckmarkItem, MenuItem, StandardItem, SubMenu},
};
use log::warn;
use parking_lot::Mutex;
use tokio::sync::Mutex as AsyncMutex;

use crate::{core::handle, process::AsyncHandler, singleton_lazy};

use super::shared::{
    TrayClickAction, TrayMenuModel, TrayMenuNode, build_tooltip_text, generate_tray_menu_model,
    get_common_tray_icon, get_sysproxy_tray_icon, get_tun_tray_icon, handle_menu_command,
    load_tray_toggle_state, perform_tray_click_action, resolve_tray_click_action,
    should_handle_tray_click,
};

const MIN_UPDATE_INTERVAL: Duration = Duration::from_millis(100);

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
        AsyncHandler::spawn(move || async move {
            handle_menu_command(&id).await;
            if let Err(e) = crate::core::tray::Tray::global().update_all_states().await {
                warn!(target: "app", "更新托盘状态失败: {e}");
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

    fn activate(&mut self, _x: i32, _y: i32) {
        if MENU_ON_ACTIVATE {
            return;
        }

        if !should_handle_tray_click() {
            return;
        }

        let action = self.state.lock().click_action;
        if action == TrayClickAction::ShowMenu {
            // Fallback: nothing to do, the environment will open menu via secondary click.
            return;
        }

        AsyncHandler::spawn(move || async move {
            perform_tray_click_action(action).await;
            if let Err(e) = crate::core::tray::Tray::global().update_all_states().await {
                warn!(target: "app", "更新托盘状态失败: {e}");
            }
        });
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
            if let Some(existing) = guard.take() {
                existing.shutdown().await;
            }
            let handle = LinuxTrayHandle::spawn(desired_variant, action).await?;
            *guard = Some(handle);
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
        let handle = self.ensure_handle(action).await?;
        handle.update_click_action(action).await?;
        Ok(())
    }

    pub async fn update_menu(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        if self.menu_updating.load(Ordering::Acquire) {
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
        let icon_name = if icon_bytes.is_override {
            "user-tray-icon".to_string()
        } else {
            "clash-verge-rev".to_string()
        };

        let action = resolve_tray_click_action().await;
        let handle = self.ensure_handle(action).await?;
        handle.update_icon(icons, icon_name).await?;
        Ok(())
    }

    pub async fn update_tray_display(&self) -> Result<()> {
        self.update_menu().await
    }

    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
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
