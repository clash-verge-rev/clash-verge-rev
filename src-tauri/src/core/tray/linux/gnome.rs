use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};

use anyhow::Result;
use log::warn;
use tauri::{
    AppHandle, Wry, async_runtime,
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};

use crate::{
    core::{
        handle,
        tray::shared::{
            MenuShortcut, TrayCheckItem, TrayClickAction, TrayIconBytes, TrayMenuModel,
            TrayMenuNode, TrayStandardItem, build_tooltip_text, handle_menu_command,
            perform_tray_click_action, resolve_tray_click_action, should_handle_tray_click,
        },
    },
    process::AsyncHandler,
};

#[derive(Clone, Copy)]
pub(crate) struct GnomeTrayHandle {
    ready: &'static AtomicBool,
}

impl GnomeTrayHandle {
    pub(crate) fn spawn(initial_action: TrayClickAction) -> Result<Self> {
        let ready = ensure_tray_initialized(initial_action)?;
        Ok(Self { ready })
    }

    pub(crate) fn is_closed(&self) -> bool {
        !self.ready.load(Ordering::Acquire)
    }

    pub(crate) fn update_menu(&self, model: &TrayMenuModel) -> Result<()> {
        let app_handle = handle::Handle::app_handle();
        let menu = build_tauri_menu(&app_handle, model)?;
        if let Some(tray) = app_handle.tray_by_id("main") {
            tray.set_menu(Some(menu))?;
        }
        Ok(())
    }

    pub(crate) fn update_click_action(&self, action: TrayClickAction) -> Result<()> {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
            let show_menu = matches!(action, TrayClickAction::ShowMenu);
            tray.set_show_menu_on_left_click(show_menu)?;
        }
        Ok(())
    }

    pub(crate) fn update_icon(&self, icon: &TrayIconBytes) -> Result<()> {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
            let image = tauri::image::Image::from_bytes(&icon.bytes)?;
            tray.set_icon(Some(image))?;
        }
        Ok(())
    }

    pub(crate) fn update_tooltip(&self, tooltip: &str) -> Result<()> {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
            tray.set_tooltip(Some(tooltip))?;
        }
        Ok(())
    }

    pub(crate) async fn shutdown(self) {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
            let _ = tray.remove();
        }
        self.ready.store(false, Ordering::Release);
    }
}

fn ensure_tray_initialized(initial_action: TrayClickAction) -> Result<&'static AtomicBool> {
    static READY: OnceLock<AtomicBool> = OnceLock::new();
    static INIT: OnceLock<()> = OnceLock::new();

    INIT.get_or_try_init(|| {
        create_tray(initial_action)?;
        READY
            .get_or_init(|| AtomicBool::new(true))
            .store(true, Ordering::Release);
        Ok(())
    })?;

    if READY.get().is_none() {
        READY
            .get_or_init(|| AtomicBool::new(true))
            .store(true, Ordering::Release);
    }

    if let Some(tray) = handle::Handle::app_handle().tray_by_id("main") {
        let show_menu = matches!(initial_action, TrayClickAction::ShowMenu);
        tray.set_show_menu_on_left_click(show_menu)?;
    }

    Ok(READY.get().expect("tray readiness flag should be set"))
}

fn create_tray(initial_action: TrayClickAction) -> Result<TrayIcon<Wry>> {
    let app_handle = handle::Handle::app_handle();
    let icon_bytes =
        async_runtime::block_on(crate::core::tray::shared::get_common_tray_icon()).bytes;
    let icon = tauri::image::Image::from_bytes(&icon_bytes)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(false);

    if !matches!(initial_action, TrayClickAction::ShowMenu) {
        builder = builder.show_menu_on_left_click(false);
    }

    let tray = builder.build(&app_handle)?;

    tray.on_tray_icon_event(|_app, event| {
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
                if let Err(err) = crate::core::tray::Tray::global().update_all_states().await {
                    warn!(target: "app", "Failed to refresh tray state: {err}");
                }
            }
        });
    });

    tray.on_menu_event(on_menu_event);

    Ok(tray)
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
            TrayMenuNode::Standard(item) => append_standard_item(app_handle, parent, item)?,
            TrayMenuNode::Check(item) => append_check_item(app_handle, parent, item)?,
            TrayMenuNode::Separator => {
                let separator = PredefinedMenuItem::separator(app_handle)?;
                parent.append_item(&separator)?;
            }
            TrayMenuNode::Submenu(submenu) => {
                let submenu_item = Submenu::with_id(
                    app_handle,
                    submenu.id.as_str(),
                    submenu.label.as_str(),
                    submenu.enabled,
                )?;
                append_nodes(app_handle, &submenu_item, &submenu.items)?;
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
        if let Err(err) = crate::core::tray::Tray::global().update_all_states().await {
            warn!(target: "app", "Failed to refresh tray state: {err}");
        }
    });
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
