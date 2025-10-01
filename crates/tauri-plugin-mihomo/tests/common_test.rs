use serde_json::json;
use tauri_plugin_mihomo::{Error, Result, models::ClashMode};

mod common;

#[tokio::test]
async fn mihomo_common_get_version() -> Result<()> {
    let mihomo = common::mihomo();
    let version = mihomo.get_version().await?;
    println!("{version:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_common_get_base_config() -> Result<()> {
    let mihomo = common::mihomo();
    let config = mihomo.get_base_config().await?;
    println!("{config:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_common_patch_base_config() -> Result<()> {
    let mihomo = common::mihomo();
    let mut base_config = mihomo.get_base_config().await?;
    let origin_mode = base_config.mode.clone();
    println!("before changed mode: {}", base_config.mode);

    let next_mode = ClashMode::Global;
    let body = json!({ "mode": next_mode });
    mihomo.patch_base_config(&body).await?;
    base_config = mihomo.get_base_config().await?;
    println!("changed mode: {}", base_config.mode);
    assert_eq!(base_config.mode, next_mode);

    let body = json!({ "mode": origin_mode });
    mihomo.patch_base_config(&body).await?;
    base_config = mihomo.get_base_config().await?;
    println!("reset mode: {}", base_config.mode);
    assert_eq!(base_config.mode, origin_mode);
    Ok(())
}

#[tokio::test]
async fn mihomo_common_update_geo() -> Result<()> {
    let mihomo = common::mihomo();
    if let Err(err) = mihomo.update_geo().await {
        if let Error::FailedResponse(msg) = err {
            println!("{msg}")
        } else {
            return Err(err);
        }
    }
    Ok(())
}

#[tokio::test]
async fn mihomo_common_flush_fakeip() -> Result<()> {
    let mihomo = common::mihomo();
    mihomo.flush_fakeip().await?;
    Ok(())
}

#[tokio::test]
async fn mihomo_common_flush_dns() -> Result<()> {
    let mihomo = common::mihomo();
    mihomo.flush_dns().await?;
    Ok(())
}

// 需要单独测试，避免其他测试时，内核还未完全加载配置文件
#[tokio::test]
async fn reload_config() -> Result<()> {
    let mihomo = common::mihomo();
    mihomo.reload_config(true, "").await?;
    Ok(())
}

// 需要单独测试，避免其他测试时，内核还未完全启动
#[tokio::test]
async fn restart() -> Result<()> {
    let mihomo = common::mihomo();
    mihomo.restart().await?;
    Ok(())
}
