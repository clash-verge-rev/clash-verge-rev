use tauri_plugin_mihomo::{CoreUpdaterChannel, Error, Result};

mod common;

#[tokio::test]
async fn mihomo_upgrade_geo() -> Result<()> {
    let mihomo = common::mihomo();
    if let Err(Error::FailedResponse(msg)) = mihomo.upgrade_geo().await {
        println!("{msg}");
    }
    Ok(())
}

#[tokio::test]
async fn mihomo_upgrade_ui() -> Result<()> {
    let mihomo = common::mihomo();
    if let Err(Error::FailedResponse(msg)) = mihomo.upgrade_ui().await {
        println!("{msg}");
    }
    Ok(())
}

#[tokio::test]
async fn mihomo_upgrade_core() -> Result<()> {
    let mihomo = common::mihomo();
    if let Err(Error::FailedResponse(msg)) = mihomo.upgrade_core(CoreUpdaterChannel::Auto, false).await {
        println!("{msg}");
    }
    Ok(())
}
