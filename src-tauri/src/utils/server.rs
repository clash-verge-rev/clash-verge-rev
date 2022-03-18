extern crate warp;

use port_scanner::local_port_available;
use tauri::{AppHandle, Manager};
use warp::Filter;

#[cfg(not(feature = "verge-dev"))]
const SERVER_PORT: u16 = 33333;
#[cfg(feature = "verge-dev")]
const SERVER_PORT: u16 = 11233;

/// check whether there is already exists
pub fn check_singleton() -> Result<(), ()> {
  if !local_port_available(SERVER_PORT) {
    tauri::async_runtime::block_on(async {
      let url = format!("http://127.0.0.1:{}/commands/visible", SERVER_PORT);
      reqwest::get(url).await.unwrap();
      Err(())
    })
  } else {
    Ok(())
  }
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server(app: &AppHandle) {
  let window = app.get_window("main").unwrap();

  tauri::async_runtime::spawn(async move {
    let commands = warp::path!("commands" / "visible").map(move || {
      window.show().unwrap();
      window.set_focus().unwrap();
      return format!("ok");
    });

    warp::serve(commands)
      .bind(([127, 0, 0, 1], SERVER_PORT))
      .await;
  });
}
