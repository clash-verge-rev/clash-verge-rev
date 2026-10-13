use crate::core::handle;
use anyhow::{Result, anyhow};
use objc2::{MainThreadMarker, rc::Retained};
use objc2_app_kit::{
    NSAppearance, NSAppearanceNameDarkAqua, NSApplication, NSPopover, NSPopoverBehavior, NSView, NSViewController,
};
use objc2_foundation::{NSRectEdge, NSSize, ns_string};
use std::cell::RefCell;
use tauri::{AppHandle, Manager as _, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "quick-panel";
const WIDTH: f64 = 520.0;
const INITIAL_HEIGHT: f64 = 620.0;
thread_local! {
    static POPOVER: RefCell<Option<Retained<NSPopover>>> = const { RefCell::new(None) };
}

pub fn toggle() -> Result<()> {
    toggle_for(
        handle::Handle::app_handle(),
        crate::core::tray::TRAY_ID,
        "quick-panel-live.html",
    )
}

/// The hidden Tauri window owns IPC and the webview; AppKit presents its view.
pub fn toggle_for(app: &AppHandle, tray_id: &str, page: &str) -> Result<()> {
    let window = if let Some(window) = app.get_webview_window(LABEL) {
        window
    } else {
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(page.into()))
            .title("Clash Verge")
            .inner_size(WIDTH, INITIAL_HEIGHT)
            .background_color(tauri::window::Color(32, 34, 37, 255))
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .visible(false)
            .build()?
    };
    // Move only WKWebView. Tao must retain its own content view for window events.
    let (sender, receiver) = std::sync::mpsc::channel();
    window.with_webview(move |webview| {
        let _ = sender.send(webview.inner() as usize);
    })?;
    let view_address = receiver.recv()?;
    let tray = app.tray_by_id(tray_id).ok_or_else(|| anyhow!("Tray is unavailable"))?;
    tray.with_inner_tray_icon(move |inner| -> Result<()> {
        let mtm = MainThreadMarker::new().ok_or_else(|| anyhow!("Popover requires the main thread"))?;
        let item = inner
            .ns_status_item()
            .ok_or_else(|| anyhow!("Status item is unavailable"))?;
        let button = item
            .button(mtm)
            .ok_or_else(|| anyhow!("Status button is unavailable"))?;
        POPOVER.with(|slot| {
            let mut slot = slot.borrow_mut();
            let popover = slot.get_or_insert_with(|| {
                let popover = NSPopover::new(mtm);
                let controller = NSViewController::new(mtm);
                // Wry retains WKWebView for the lifetime of the hidden host window.
                let view = unsafe { &*(view_address as *const NSView) };
                view.removeFromSuperview();
                controller.setView(view);
                popover.setContentViewController(Some(&controller));
                popover.setContentSize(NSSize::new(WIDTH, INITIAL_HEIGHT));
                popover.setBehavior(NSPopoverBehavior::Transient);
                popover.setAnimates(true);
                let appearance = NSAppearance::appearanceNamed(unsafe { NSAppearanceNameDarkAqua });
                popover.setAppearance(appearance.as_deref());
                popover
            });
            if popover.isShown() {
                popover.close();
            } else {
                // Compatible with macOS versions predating cooperative activation.
                #[allow(deprecated)]
                NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
                popover.showRelativeToRect_ofView_preferredEdge(button.bounds(), &button, NSRectEdge::MinY);
                if let Some(view) = popover.contentViewController().map(|controller| controller.view())
                    && let Some(window) = view.window()
                {
                    window.setTitle(ns_string!("Clash Verge"));
                    window.makeKeyWindow();
                    window.makeFirstResponder(Some(&view));
                }
            }
        });
        Ok(())
    })??;
    Ok(())
}

pub fn state(app: &AppHandle, tray_id: &str, height: Option<f64>, close: bool) -> Result<bool> {
    let tray = app.tray_by_id(tray_id).ok_or_else(|| anyhow!("Tray is unavailable"))?;
    Ok(tray.with_inner_tray_icon(move |_| {
        POPOVER.with(|slot| {
            let slot = slot.borrow();
            let Some(popover) = slot.as_ref() else { return false };
            if close {
                popover.close();
            } else if let Some(height) = height.filter(|height| height.is_finite()) {
                popover.setContentSize(NSSize::new(WIDTH, height.clamp(200.0, 760.0)));
            }
            popover.isShown()
        })
    })?)
}
