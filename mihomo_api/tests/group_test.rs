use anyhow::Result;

mod utils;

#[tokio::test]
pub async fn group_test() -> Result<()> {
    let mihomo = utils::default_mihomo()?;

    let group = mihomo.get_groups().await?;
    println!("group result: {:?}", group);

    let first_proxy = group.proxies.get(0);
    let first_proxy_name = first_proxy.unwrap().name.clone();
    let get_group = mihomo.get_group_by_name(&first_proxy_name).await?;
    println!("get first group: {:?}", get_group);

    let group_delay = mihomo
        .delay_group(
            &first_proxy_name,
            "https://www.gstatic.com/generate_204",
            5000,
        )
        .await?;
    println!("group delay: {:#?}", group_delay);
    Ok(())
}
