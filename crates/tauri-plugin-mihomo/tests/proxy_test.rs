use std::sync::Arc;

use tauri_plugin_mihomo::{Result, failed_resp};

use crate::common::{TEST_URL, TIMEOUT};

mod common;

#[tokio::test]
async fn mihomo_proxy_list() -> Result<()> {
    let mihomo = common::mihomo();
    let proxies = mihomo.get_proxies().await?;
    println!("{proxies:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_proxy_get_by_name() -> Result<()> {
    let mihomo = common::mihomo();
    let proxies = mihomo.get_proxies().await?;
    let proxy_name = proxies.proxies.keys().next().ok_or(failed_resp!("empty proxies"))?;
    let proxy = mihomo.get_proxy_by_name(proxy_name).await?;
    println!("{proxy:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_proxy_delay() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    let proxy = groups
        .proxies
        .iter()
        .find(|&i| i.all.as_ref().is_some_and(|a| !a.is_empty()))
        .ok_or(failed_resp!("not found group"))?;
    let proxy_name = proxy
        .all
        .as_ref()
        .ok_or(failed_resp!("field `all` is empty"))?
        .first()
        .ok_or(failed_resp!("get first node failed"))?;
    let delay = mihomo.delay_proxy_by_name(proxy_name, TEST_URL, TIMEOUT).await?;
    println!("proxy [{}] delay: {:?}", proxy_name, delay);
    Ok(())
}

// 并发测试节点延迟
#[tokio::test]
async fn bench_proxy_delay() -> Result<()> {
    let mihomo = common::mihomo();
    let groups = mihomo.get_groups().await?;
    let proxies = groups.proxies[0].all.as_ref().unwrap();
    let mut tasks = Vec::new();
    let arc_mihomo = Arc::new(mihomo);
    println!("total: {}", proxies.len() * 10);
    for _ in 0..=10 {
        for proxy in proxies.clone().into_iter() {
            let mihomo_ = Arc::clone(&arc_mihomo);
            tasks.push(tokio::spawn(async move {
                match mihomo_.delay_proxy_by_name(&proxy, TEST_URL, TIMEOUT).await {
                    Ok(delay) => {
                        println!("{proxy}: {delay:?}");
                    }
                    Err(e) => {
                        println!("{proxy}: error: {e}");
                    }
                }
            }));
        }
    }
    for task in tasks.into_iter() {
        task.await.unwrap();
    }
    Ok(())
}
