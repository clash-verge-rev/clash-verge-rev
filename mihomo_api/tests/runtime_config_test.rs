use anyhow::Result;
use mihomo_api::{
    model::Protocol,
    model::{ClashMode, TunStack},
    MihomoBuilder,
};
use serde_json::json;

#[tokio::test]
async fn runtime_config_test() -> Result<()> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("nBaciu2IqTZoGd6NBajit")
        .build()?;

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
