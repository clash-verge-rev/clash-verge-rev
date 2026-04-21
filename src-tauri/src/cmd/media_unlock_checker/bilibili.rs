use reqwest::Client;
use serde_json::Value;

use super::UnlockItem;
use super::utils::get_local_date_string;

pub(super) async fn check_bilibili_china_mainland(client: &Client) -> UnlockItem {
    let url = "https://api.bilibili.com/pgc/player/web/playurl?avid=82846771&qn=0&type=&otype=json&ep_id=307247&fourk=1&fnver=0&fnval=16&module=bangumi";

    match client.get(url).send().await {
        Ok(response) => match response.json::<Value>().await {
            Ok(body) => {
                let status = body
                    .get("code")
                    .and_then(|v| v.as_i64())
                    .map(|code| {
                        if code == 0 {
                            "Yes"
                        } else if code == -10403 {
                            "No"
                        } else {
                            "Failed"
                        }
                    })
                    .unwrap_or("Failed");

                UnlockItem {
                    name: "哔哩哔哩大陆".to_string(),
                    status: status.to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
            Err(_) => UnlockItem {
                name: "哔哩哔哩大陆".to_string(),
                status: "Failed".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            },
        },
        Err(_) => UnlockItem {
            name: "哔哩哔哩大陆".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

pub(super) async fn check_bilibili_hk_mc_tw(client: &Client) -> UnlockItem {
    let url = "https://api.bilibili.com/pgc/player/web/playurl?avid=18281381&cid=29892777&qn=0&type=&otype=json&ep_id=183799&fourk=1&fnver=0&fnval=16&module=bangumi";

    match client.get(url).send().await {
        Ok(response) => match response.json::<Value>().await {
            Ok(body) => {
                let status = body
                    .get("code")
                    .and_then(|v| v.as_i64())
                    .map(|code| {
                        if code == 0 {
                            "Yes"
                        } else if code == -10403 {
                            "No"
                        } else {
                            "Failed"
                        }
                    })
                    .unwrap_or("Failed");

                UnlockItem {
                    name: "哔哩哔哩港澳台".to_string(),
                    status: status.to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
            Err(_) => UnlockItem {
                name: "哔哩哔哩港澳台".to_string(),
                status: "Failed".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            },
        },
        Err(_) => UnlockItem {
            name: "哔哩哔哩港澳台".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}
