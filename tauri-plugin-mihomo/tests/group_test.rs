use tauri_plugin_mihomo::{Error, ProxyType, Result, VehicleType};

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
    let proxy = groups
        .proxies
        .first()
        .ok_or(Error::FailedResponse("no proxies".to_string()))?;
    let group = mihomo.get_group_by_name(&proxy.name).await?;
    println!("{group:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_group_delay() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    let proxy = groups
        .proxies
        .first()
        .ok_or(Error::FailedResponse("no proxies".to_string()))?;
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
        .ok_or(Error::FailedResponse("not fount selector group".to_string()))?;
    let origin_now = selector_group.now.clone().unwrap();
    println!("[{}], before select: {:?}", selector_group.name, selector_group.now);

    let node = selector_group
        .all
        .as_ref()
        .ok_or(Error::FailedResponse("field `all` is empty".to_string()))?
        .iter()
        .find(|i| **i != origin_now)
        .ok_or(Error::FailedResponse("empty node".to_string()))?;
    mihomo.select_node_for_group(&selector_group.name, node).await?;
    let groups = mihomo.get_groups().await?;
    let selector_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == selector_group.name)
        .ok_or(Error::FailedResponse("not fount selector group".to_string()))?;
    println!("[{}], selected: {:?}", selector_group.name, selector_group.now);

    mihomo.select_node_for_group(&selector_group.name, &origin_now).await?;
    let groups = mihomo.get_groups().await?;
    let selector_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == selector_group.name)
        .ok_or(Error::FailedResponse("not fount selector group".to_string()))?;
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
        .ok_or(Error::FailedResponse("not fount url test group".to_string()))?;
    println!("[{}], before fixed: {:?}", urlmihomo_group.name, urlmihomo_group.fixed);

    let node = urlmihomo_group
        .all
        .as_ref()
        .ok_or(Error::FailedResponse("field `all` is empty".to_string()))?
        .iter()
        .next()
        .ok_or(Error::FailedResponse("empty node".to_string()))?;
    mihomo.select_node_for_group(&urlmihomo_group.name, node).await?;
    let groups = mihomo.get_groups().await?;
    let urlmihomo_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == urlmihomo_group.name)
        .ok_or(Error::FailedResponse("not fount url test group".to_string()))?;
    println!("[{}], fixed: {:?}", urlmihomo_group.name, urlmihomo_group.fixed);

    mihomo.unfixed_proxy(&urlmihomo_group.name).await?;
    let groups = mihomo.get_groups().await?;
    let urlmihomo_group = groups
        .proxies
        .iter()
        .find(|&i| i.name == urlmihomo_group.name)
        .ok_or(Error::FailedResponse("not fount url test group".to_string()))?;
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
        .ok_or(Error::FailedResponse("not found provider".to_string()))?;
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
        .ok_or(Error::FailedResponse("not found provider".to_string()))?;
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
        .ok_or(Error::FailedResponse("not found provider".to_string()))?;
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
        .ok_or(Error::FailedResponse("not found provider".to_string()))?;

    let proxy = provider
        .proxies
        .first()
        .ok_or(Error::FailedResponse("provider proxies empty".to_string()))?;

    println!("health check provider [{}] proxy [{}]", provider_name, proxy.name);
    let delay = mihomo
        .healthcheck_node_in_provider(provider_name, &proxy.name, TEST_URL, TIMEOUT)
        .await?;
    println!("health check delay: {:?}", delay);

    Ok(())
}
