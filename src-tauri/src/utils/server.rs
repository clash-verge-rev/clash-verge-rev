extern crate warp;

use super::resolve;
use crate::config::IVerge;
use anyhow::{bail, Result};
use port_scanner::local_port_available;
use tauri::AppHandle;
use warp::Filter;

/// check whether there is already exists
pub fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();

    if !local_port_available(port) {
        tauri::async_runtime::block_on(async {
            let url = format!("http://127.0.0.1:{port}/commands/visible");
            let resp = reqwest::get(url).await?.text().await?;

            if &resp == "ok" {
                bail!("app exists");
            }

            log::error!("failed to setup singleton listen server");
            Ok(())
        })
    } else {
        Ok(())
    }
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server(app_handle: AppHandle) {
    let port = IVerge::get_singleton_port();

    tauri::async_runtime::spawn(async move {
        let commands = warp::path!("commands" / "visible").map(move || {
            resolve::create_window(&app_handle);
            format!("ok")
        });

        warp::serve(commands).bind(([127, 0, 0, 1], port)).await;
    });
}
