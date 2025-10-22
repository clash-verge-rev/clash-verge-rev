use anyhow::Result;
use log::{info, warn};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Wry,
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::{process::AsyncHandler, singleton_lazy};

use crate::core::{handle, timer::Timer};

use super::shared::{
    MenuShortcut, TrayCheckItem, TrayClickAction, TrayMenuModel, TrayMenuNode, TrayStandardItem,
    build_tooltip_text, generate_tray_menu_model, get_common_tray_icon, get_sysproxy_tray_icon,
    get_tun_tray_icon, handle_menu_command, load_tray_toggle_state, perform_tray_click_action,
    resolve_tray_click_action, should_handle_tray_click,
};

#[cfg(target_os = "macos")]
pub mod speed_rate;
const MIN_UPDATE_INTERVAL: Duration = Duration::from_millis(100);

pub struct Tray {
    last_menu_update: Mutex<Option<Instant>>,
    menu_updating: AtomicBool,
}

impl Default for Tray {
    fn default() -> Self {
        Self {
            last_menu_update: Mutex::new(None),
            menu_updating: AtomicBool::new(false),
        }
    }
}

singleton_lazy!(Tray, TRAY, Tray::default);

impl Tray {
    pub async fn init(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();
        match self.create_tray_from_handle(app_handle).await {
            Ok(_) => info!(target: "app", "System tray created successfully"),
            Err(e) => warn!(target: "app", "System tray creation failed: {e}"),
        }

        Timer::global().add_update_tray_menu_task()?;
        Ok(())
    }

    pub async fn update_click_behavior(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        let action = resolve_tray_click_action().await;
        let app_handle = handle::Handle::app_handle();
        let tray = app_handle
            .tray_by_id("main")
            .ok_or_else(|| anyhow::anyhow!("Failed to get main tray"))?;

        let show_menu = matches!(action, TrayClickAction::ShowMenu);
        tray.set_show_menu_on_left_click(show_menu)?;
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
        let app_handle = handle::Handle::app_handle();
        let result = self.update_menu_internal(app_handle).await;
        {
            let mut last_update = self.last_menu_update.lock();
            *last_update = Some(Instant::now());
        }
        self.menu_updating.store(false, Ordering::Release);
        result
    }

    async fn update_menu_internal(&self, app_handle: &AppHandle) -> Result<()> {
        let (menu_model, _) = generate_tray_menu_model().await?;
        let menu = build_tauri_menu(app_handle, &menu_model)?;

        match app_handle.tray_by_id("main") {
            Some(tray) => {
                let _ = tray.set_menu(Some(menu));
                Ok(())
            }
            None => {
                warn!(target: "app", "Failed to update tray menu: tray not found");
                Ok(())
            }
        }
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
        }
        .bytes;

        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
            let image = tauri::image::Image::from_bytes(&icon_bytes)?;
            let _ = tray.set_icon(Some(image));
        }

        Ok(())
    }

    pub async fn update_tray_display(&self) -> Result<()> {
        self.update_menu().await
    }

    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        let tooltip = build_tooltip_text().await?;
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(&tooltip));
        }

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

    pub async fn create_tray_from_handle(&self, app_handle: &AppHandle) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Ok(());
        }

        let icon_bytes = get_common_tray_icon().await.bytes;
        let icon = tauri::image::Image::from_bytes(&icon_bytes)?;
        let action = resolve_tray_click_action().await;

        let tray = {
            let mut builder = TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(false);

            if !matches!(action, TrayClickAction::ShowMenu) {
                builder = builder.show_menu_on_left_click(false);
            }

            builder.build(app_handle)?
        };

        tray.on_tray_icon_event(|_app_handle, event| {
            AsyncHandler::spawn(|| async move {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Down,
                    ..
                } = event
                {
                    if !should_handle_tray_click() {
                        return;
                    }

                    let action = resolve_tray_click_action().await;
                    if matches!(action, TrayClickAction::ShowMenu) {
                        return;
                    }

                    perform_tray_click_action(action).await;
                    if let Err(e) = Tray::global().update_all_states().await {
                        warn!(target: "app", "Failed to refresh tray state: {e}");
                    }
                }
            });
        });

        tray.on_menu_event(on_menu_event);
        self.update_all_states().await?;
        Ok(())
    }
}

fn hotkey(shortcut: &Option<MenuShortcut>) -> Option<&str> {
    shortcut.as_ref().map(|s| s.raw())
}

trait MenuContainer {
    fn append_item(&self, item: &dyn IsMenuItem<Wry>) -> tauri::Result<()>;
}

impl MenuContainer for Menu<Wry> {
    fn append_item(&self, item: &dyn IsMenuItem<Wry>) -> tauri::Result<()> {
        Menu::append(self, item)
    }
}

impl MenuContainer for Submenu<Wry> {
    fn append_item(&self, item: &dyn IsMenuItem<Wry>) -> tauri::Result<()> {
        Submenu::append(self, item)
    }
}

fn build_tauri_menu(app_handle: &AppHandle, model: &TrayMenuModel) -> Result<Menu<Wry>> {
    let menu = Menu::new(app_handle)?;
    append_nodes(app_handle, &menu, &model.items)?;
    Ok(menu)
}

fn append_nodes<C: MenuContainer>(
    app_handle: &AppHandle,
    parent: &C,
    nodes: &[TrayMenuNode],
) -> Result<()> {
    for node in nodes {
        match node {
            TrayMenuNode::Standard(item) => {
                append_standard_item(app_handle, parent, item)?;
            }
            TrayMenuNode::Check(item) => {
                append_check_item(app_handle, parent, item)?;
            }
            TrayMenuNode::Separator => {
                let separator = PredefinedMenuItem::separator(app_handle)?;
                parent.append_item(&separator)?;
            }
            TrayMenuNode::Submenu(sub) => {
                let submenu_item =
                    Submenu::with_id(app_handle, sub.id.as_str(), sub.label.as_str(), sub.enabled)?;
                append_nodes(app_handle, &submenu_item, &sub.items)?;
                parent.append_item(&submenu_item)?;
            }
        }
    }

    Ok(())
}

fn append_standard_item<C: MenuContainer>(
    app_handle: &AppHandle,
    parent: &C,
    item: &TrayStandardItem,
) -> Result<()> {
    let accelerator = hotkey(&item.shortcut);
    let menu_item = MenuItem::with_id(
        app_handle,
        item.id.as_str(),
        item.label.as_str(),
        item.enabled,
        accelerator,
    )?;
    parent.append_item(&menu_item)?;
    Ok(())
}

fn append_check_item<C: MenuContainer>(
    app_handle: &AppHandle,
    parent: &C,
    item: &TrayCheckItem,
) -> Result<()> {
    let accelerator = hotkey(&item.shortcut);
    let menu_item = CheckMenuItem::with_id(
        app_handle,
        item.id.as_str(),
        item.label.as_str(),
        item.enabled,
        item.checked,
        accelerator,
    )?;
    parent.append_item(&menu_item)?;
    Ok(())
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    AsyncHandler::spawn(|| async move {
        handle_menu_command(event.id.as_ref()).await;
        if let Err(e) = Tray::global().update_all_states().await {
            warn!(target: "app", "Failed to refresh tray state: {e}");
        }
    });
}
