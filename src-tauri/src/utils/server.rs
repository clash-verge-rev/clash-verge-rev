extern crate warp;

use super::resolve;
use crate::data::Verge;
use port_scanner::local_port_available;
use tauri::AppHandle;
use warp::Filter;

#[cfg(not(feature = "verge-dev"))]
const SERVER_PORT: u16 = 33331;
#[cfg(feature = "verge-dev")]
const SERVER_PORT: u16 = 11233;

/// check whether there is already exists
pub fn check_singleton() -> Result<(), ()> {
  let verge = Verge::new();
  let port = verge.app_singleton_port.unwrap_or(SERVER_PORT);

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
pub fn embed_server(app_handle: &AppHandle, port: Option<u16>) {
  let app_handle = app_handle.clone();
  let port = port.unwrap_or(SERVER_PORT);

  tauri::async_runtime::spawn(async move {
    let commands = warp::path!("commands" / "visible").map(move || {
      resolve::create_window(&app_handle);
      return format!("ok");
    });

    warp::serve(commands).bind(([127, 0, 0, 1], port)).await;
  });
}
