use crate::core::handle;
use anyhow::Result;
use tauri::{Manager as _, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const LABEL: &str = "quick-panel";

pub fn toggle(position: PhysicalPosition<f64>) -> Result<()> {
    let app = handle::Handle::app_handle();
    let window = if let Some(window) = app.get_webview_window(LABEL) {
        if window.is_visible()? {
            window.hide()?;
            return Ok(());
        }
        window
    } else {
        let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quick-panel-live.html".into()))
            .title("Clash Verge")
            .inner_size(440.0, 720.0)
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()?;
        let hide_window = window.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Focused(false)) {
                let _ = hide_window.hide();
            }
        });
        window
    };

    if let Some(monitor) = window.monitor_from_point(position.x, position.y)? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (440.0 * scale).min(f64::from(area.size.width));
        let height = (720.0 * scale).min(f64::from(area.size.height));
        window.set_size(tauri::PhysicalSize::new(width as u32, height as u32))?;
        let left = f64::from(area.position.x);
        let top = f64::from(area.position.y);
        let x = (position.x - width / 2.0).clamp(left, left + f64::from(area.size.width) - width);
        let y = (position.y + 16.0 * scale).clamp(top, top + f64::from(area.size.height) - height);
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}
