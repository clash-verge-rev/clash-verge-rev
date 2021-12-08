extern crate log;
extern crate reqwest;
extern crate serde_yaml;

use crate::init::app_home_dir;
use tauri::api::process::{Command, CommandEvent};

/// Run the clash bin
pub fn run_clash_bin() {
  let app_dir = app_home_dir();

  let (mut rx, _sidecar) = Command::new_sidecar("clash")
    .expect("failed to create clash binary")
    .args(["-d", &app_dir.as_os_str().to_str().unwrap()])
    .spawn()
    .expect("failed to spawn sidecar");

  tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(line) => {
          log::info!("{}", line);
        }
        CommandEvent::Stderr(err) => {
          log::error!("{}", err);
        }
        _ => {}
      }
    }
  });
}

pub async fn fetch_url(profile_url: &str) -> Result<(), reqwest::Error> {
  let resp = reqwest::get(profile_url).await?;
  println!("{:#?}", resp);

  let header = resp.headers().clone();
  println!("{:?}", header);

  let data = resp.text_with_charset("utf-8").await?;
  println!("{:#?}", data);
  Ok(())
}
