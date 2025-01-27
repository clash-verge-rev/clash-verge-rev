use anyhow::Result;
use mihomo_api::{model::Protocol, MihomoBuilder};

#[tokio::test]
async fn upgrade_test() -> Result<()> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("nBaciu2IqTZoGd6NBajit")
        .build()?;

    mihomo.upgrade_geo().await?;

    mihomo.upgrade_ui().await?;

    mihomo.upgrade_core().await?;

    Ok(())
}
