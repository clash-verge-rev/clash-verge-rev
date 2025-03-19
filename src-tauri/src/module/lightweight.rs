use tauri::Manager;

use crate::{core::handle, log_err, utils::resolve};



pub fn entry_lightweight_mode() {
    println!("entry_lightweight_mode");
    log::debug!(target: "app", "entry_lightweight_mode");
    if let Some(window) = handle::Handle::global().get_window() {
        log_err!(window.close());
    }

    if let Some(window) = handle::Handle::global().get_window() {
        if let Some(webview) = window.get_webview_window("main") {
            log_err!(webview.destroy());
        }
    }
}

pub fn exit_lightweight_mode() {
    println!("exit_lightweight_mode");
    log::debug!(target: "app", "exit_lightweight_mode");
    resolve::create_window();
}
