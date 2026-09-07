use reqwest::Client;
use serde::Deserialize;

use super::UnlockItem;

pub(crate) const BILIBILI_CHINA_MAINLAND_NAME: &str = "哔哩哔哩大陆";
const BILIBILI_CHINA_MAINLAND_URL: &str = "https://api.bilibili.com/pgc/player/web/playurl?avid=82846771&qn=0&type=&otype=json&ep_id=307247&fourk=1&fnver=0&fnval=16&module=bangumi";

pub(crate) const BILIBILI_HK_MC_TW_NAME: &str = "哔哩哔哩港澳台";
const BILIBILI_HK_MC_TW_URL: &str = "https://api.bilibili.com/pgc/player/web/playurl?avid=18281381&cid=29892777&qn=0&type=&otype=json&ep_id=183799&fourk=1&fnver=0&fnval=16&module=bangumi";

#[derive(Deserialize)]
struct BilibiliResponse {
    code: i64,
}

async fn check_bilibili(client: &Client, name: &str, url: &str) -> UnlockItem {
    let status = match client.get(url).send().await {
        Ok(response) => match response.json::<BilibiliResponse>().await {
            Ok(body) => match body.code {
                0 => "Yes",
                -10403 => "No",
                _ => "Failed",
            },
            Err(_) => "Failed",
        },
        Err(_) => "Failed",
    };

    UnlockItem::checked(name, status, None)
}

pub(super) async fn check_bilibili_china_mainland(client: &Client) -> UnlockItem {
    check_bilibili(client, BILIBILI_CHINA_MAINLAND_NAME, BILIBILI_CHINA_MAINLAND_URL).await
}

pub(super) async fn check_bilibili_hk_mc_tw(client: &Client) -> UnlockItem {
    check_bilibili(client, BILIBILI_HK_MC_TW_NAME, BILIBILI_HK_MC_TW_URL).await
}
