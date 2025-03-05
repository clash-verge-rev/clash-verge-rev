use anyhow::Result;
use mihomo_api::model::{ClashMode, TunStack};
use serde_json::json;

mod utils;

#[tokio::test]
async fn runtime_config_test() -> Result<()> {
    let mihomo = utils::default_mihomo()?;

    let base_config = mihomo.get_base_config().await?;
    println!("base config: {:#?}", base_config);

    let body = json!({
        "mode": ClashMode::Rule,
        "tun": {
            "stack": TunStack::Gvisor
        }
    });
    println!("{}", body);
    mihomo.patch_base_config(&body).await?;
    let base_config = mihomo.get_base_config().await?;
    println!("base config after patch: {:#?}", base_config);

    mihomo.update_geo().await?;

    mihomo.restart().await?;

    Ok(())
}
