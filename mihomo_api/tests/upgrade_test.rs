use anyhow::Result;

mod utils;

#[tokio::test]
async fn upgrade_test() -> Result<()> {
    let mihomo = utils::default_mihomo()?;

    mihomo.upgrade_geo().await?;

    mihomo.upgrade_ui().await?;

    mihomo.upgrade_core().await?;

    Ok(())
}
