extern crate warp;

use super::resolve;
use crate::config::VergeN;
use port_scanner::local_port_available;
use tauri::AppHandle;
use warp::Filter;

/// check whether there is already exists
pub fn check_singleton() -> Result<(), ()> {
    let port = VergeN::get_singleton_port();

    if !local_port_available(port) {
        tauri::async_runtime::block_on(async {
            let url = format!("http://127.0.0.1:{}/commands/visible", port);
            reqwest::get(url).await.unwrap();
            Err(())
        })
    } else {
        Ok(())
    }
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server(app_handle: AppHandle) {
    let app_handle = app_handle.clone();
    let port = VergeN::get_singleton_port();

    tauri::async_runtime::spawn(async move {
        let commands = warp::path!("commands" / "visible").map(move || {
            resolve::create_window(&app_handle);
            format!("ok")
        });

        warp::serve(commands).bind(([127, 0, 0, 1], port)).await;
    });
}
