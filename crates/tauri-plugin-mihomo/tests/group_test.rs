use tauri_plugin_mihomo::{
    Result, failed_resp,
    models::{ProxyType, VehicleType},
};

use crate::common::{TEST_URL, TIMEOUT};

mod common;

#[tokio::test]
async fn mihomo_group_list() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    println!("{groups:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_group_get_by_name() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    let proxy = groups.proxies.first().ok_or(failed_resp!("no proxies"))?;
    let group = mihomo.get_group_by_name(&proxy.name).await?;
    println!("{group:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_group_delay() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    let proxy = groups.proxies.first().ok_or(failed_resp!("no proxies"))?;
    let group_name = proxy.name.as_ref();
    let response = mihomo.delay_group(group_name, TEST_URL, TIMEOUT).await?;
    println!("group [{}] delay, {response:#?}", group_name);
    Ok(())
}

#[tokio::test]
async fn mihomo_group_select_node() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    let selector_group = groups
        .proxies
        .iter()
        .find(|i| matches!(i.proxy_type, ProxyType::Selector))
        .ok_or(failed_resp!("not fount selector group"))?;
    let origin_now = selector_group.now.clone().unwrap();
    println!("[{}], before select: {:?}", selector_group.name, selector_group.now);

    let node = selector_group
        .all
        .as_ref()
        .ok_or(failed_resp!("field `all` is empty"))?
        .iter()
        .find(|i| **i != origin_now)
        .ok_or(failed_resp!("empty node"))?;
    mihomo.select_node_for_group(&selector_group.name, node).await?;
    let groups = mihomo.get_groups().await?;
    let selector_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == selector_group.name)
        .ok_or(failed_resp!("not fount selector group"))?;
    println!("[{}], selected: {:?}", selector_group.name, selector_group.now);

    mihomo.select_node_for_group(&selector_group.name, &origin_now).await?;
    let groups = mihomo.get_groups().await?;
    let selector_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == selector_group.name)
        .ok_or(failed_resp!("not fount selector group"))?;
    println!("[{}], reset selector: {:?}", selector_group.name, selector_group.now);
    Ok(())
}

#[tokio::test]
async fn mihomo_group_unfixed() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    let urlmihomo_group = groups
        .proxies
        .iter()
        .find(|i| matches!(i.proxy_type, ProxyType::URLTest))
        .ok_or(failed_resp!("not fount url test group"))?;
    println!("[{}], before fixed: {:?}", urlmihomo_group.name, urlmihomo_group.fixed);

    let node = urlmihomo_group
        .all
        .as_ref()
        .ok_or(failed_resp!("field `all` is empty"))?
        .iter()
        .next()
        .ok_or(failed_resp!("empty node"))?;
    mihomo.select_node_for_group(&urlmihomo_group.name, node).await?;
    let groups = mihomo.get_groups().await?;
    let urlmihomo_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == urlmihomo_group.name)
        .ok_or(failed_resp!("not fount url test group"))?;
    println!("[{}], fixed: {:?}", urlmihomo_group.name, urlmihomo_group.fixed);

    mihomo.unfixed_proxy(&urlmihomo_group.name).await?;
    let groups = mihomo.get_groups().await?;
    let urlmihomo_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == urlmihomo_group.name)
        .ok_or(failed_resp!("not fount url test group"))?;
    println!("[{}], after unfixed: {:?}", urlmihomo_group.name, urlmihomo_group.fixed);
    Ok(())
}

// group providers
#[tokio::test]
async fn mihomo_group_providers() -> Result<()> {
    let mihomo = common::mihomo();
    let providers = mihomo.get_proxy_providers().await?;
    println!("{:?}", providers.providers);
    Ok(())
}

#[tokio::test]
async fn mihomo_group_get_provider_by_name() -> Result<()> {
    let mihomo = common::mihomo();
    let providers = mihomo.get_proxy_providers().await?;
    let (provider_name, _provider) = providers
        .providers
        .iter()
        .find(|(_name, provider)| matches!(provider.vehicle_type, VehicleType::HTTP | VehicleType::File))
        .ok_or(failed_resp!("not found provider"))?;
    let provider = mihomo.get_proxy_provider_by_name(provider_name).await?;
    println!("provider [{provider:?}]");
    Ok(())
}

#[tokio::test]
async fn mihomo_group_update_provider() -> Result<()> {
    let mihomo = common::mihomo();
    let providers = mihomo.get_proxy_providers().await?;
    let (provider_name, provider) = providers
        .providers
        .iter()
        .find(|(_name, provider)| matches!(provider.vehicle_type, VehicleType::HTTP | VehicleType::File))
        .ok_or(failed_resp!("not found provider"))?;
    println!(
        "provider [{}], update time: {}",
        provider_name,
        provider.updated_at.as_ref().unwrap()
    );
    mihomo.update_proxy_provider(provider_name).await?;
    let provider = mihomo.get_proxy_provider_by_name(provider_name).await?;
    println!(
        "provider [{}], update time: {}",
        provider_name,
        provider.updated_at.unwrap()
    );
    Ok(())
}

#[tokio::test]
async fn mihomo_group_health_check_provider() -> Result<()> {
    let mihomo = common::mihomo();
    let providers = mihomo.get_proxy_providers().await?;
    let (provider_name, _provider) = providers
        .providers
        .iter()
        .find(|(_name, provider)| matches!(provider.vehicle_type, VehicleType::HTTP | VehicleType::File))
        .ok_or(failed_resp!("not found provider"))?;
    println!("health check provider [{}]", provider_name);
    mihomo.healthcheck_proxy_provider(provider_name).await?;
    Ok(())
}

#[tokio::test]
async fn mihomo_group_health_check_node_in_provider() -> Result<()> {
    let mihomo = common::mihomo();
    let providers = mihomo.get_proxy_providers().await?;
    let (provider_name, provider) = providers
        .providers
        .iter()
        .find(|(_name, provider)| matches!(provider.vehicle_type, VehicleType::HTTP | VehicleType::File))
        .ok_or(failed_resp!("not found provider"))?;

    let proxy = provider.proxies.first().ok_or(failed_resp!("provider proxies empty"))?;

    println!("health check provider [{}] proxy [{}]", provider_name, proxy.name);
    let delay = mihomo
        .healthcheck_node_in_provider(provider_name, &proxy.name, TEST_URL, TIMEOUT)
        .await?;
    println!("health check delay: {:?}", delay);

    Ok(())
}
