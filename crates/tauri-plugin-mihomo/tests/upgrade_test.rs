use tauri_plugin_mihomo::{Error, Result, models::CoreUpdaterChannel};

mod common;

#[tokio::test]
async fn mihomo_upgrade_geo() -> Result<()> {
    let mihomo = common::mihomo();
    if let Err(err) = mihomo.upgrade_geo().await {
        if let Error::FailedResponse(msg) = err {
            println!("{msg}");
        } else {
            return Err(err);
        }
    }
    Ok(())
}

#[tokio::test]
async fn mihomo_upgrade_ui() -> Result<()> {
    let mihomo = common::mihomo();
    if let Err(err) = mihomo.upgrade_ui().await {
        if let Error::FailedResponse(msg) = err {
            println!("{msg}");
        } else {
            return Err(err);
        }
    }
    Ok(())
}

#[tokio::test]
async fn mihomo_upgrade_core() -> Result<()> {
    let mihomo = common::mihomo();
    if let Err(err) = mihomo.upgrade_core(CoreUpdaterChannel::Auto, false).await {
        if let Error::FailedResponse(msg) = err {
            println!("{msg}");
        } else {
            return Err(err);
        }
    }
    Ok(())
}
