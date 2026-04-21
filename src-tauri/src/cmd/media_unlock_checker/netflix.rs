use reqwest::Client;
use serde_json::Value;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_netflix(client: &Client) -> UnlockItem {
    let cdn_result = check_netflix_cdn(client).await;
    if cdn_result.status == "Yes" {
        return cdn_result;
    }

    let url1 = "https://www.netflix.com/title/81280792";
    let url2 = "https://www.netflix.com/title/70143836";

    let result1 = client
        .get(url1)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await;

    if let Err(e) = &result1 {
        eprintln!("Netflix请求错误: {e}");
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let result2 = client
        .get(url2)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await;

    if let Err(e) = &result2 {
        eprintln!("Netflix请求错误: {e}");
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let status1 = match result1 {
        Ok(response) => response.status().as_u16(),
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Netflix response 1: {}", e);
            return UnlockItem {
                name: "Netflix".to_string(),
                status: "Failed".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };

    let status2 = match result2 {
        Ok(response) => response.status().as_u16(),
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Netflix response 2: {}", e);
            return UnlockItem {
                name: "Netflix".to_string(),
                status: "Failed".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };

    if status1 == 404 && status2 == 404 {
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "Originals Only".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    if status1 == 403 || status2 == 403 {
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "No".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    if status1 == 200 || status1 == 301 || status2 == 200 || status2 == 301 {
        let test_url = "https://www.netflix.com/title/80018499";
        match client
            .get(test_url)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
        {
            Ok(response) => {
                if let Some(location) = response.headers().get("location")
                    && let Ok(location_str) = location.to_str()
                {
                    let parts: Vec<&str> = location_str.split('/').collect();
                    if parts.len() >= 4 {
                        let region_code = parts[3].split('-').next().unwrap_or("unknown");
                        let emoji = country_code_to_emoji(region_code);
                        return UnlockItem {
                            name: "Netflix".to_string(),
                            status: "Yes".to_string(),
                            region: Some(format!("{emoji}{region_code}")),
                            check_time: Some(get_local_date_string()),
                        };
                    }
                }

                let emoji = country_code_to_emoji("us");
                UnlockItem {
                    name: "Netflix".to_string(),
                    status: "Yes".to_string(),
                    region: Some(format!("{emoji}{}", "us")),
                    check_time: Some(get_local_date_string()),
                }
            }
            Err(e) => {
                eprintln!("获取Netflix区域信息失败: {e}");
                UnlockItem {
                    name: "Netflix".to_string(),
                    status: "Yes (但无法获取区域)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
    } else {
        UnlockItem {
            name: "Netflix".to_string(),
            status: format!("Failed (状态码: {status1}_{status2}"),
            region: None,
            check_time: Some(get_local_date_string()),
        }
    }
}

async fn check_netflix_cdn(client: &Client) -> UnlockItem {
    let url = "https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5";

    match client.get(url).timeout(std::time::Duration::from_secs(30)).send().await {
        Ok(response) => {
            if response.status().as_u16() == 403 {
                return UnlockItem {
                    name: "Netflix".to_string(),
                    status: "No (IP Banned By Netflix)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                };
            }

            match response.json::<Value>().await {
                Ok(data) => {
                    if let Some(targets) = data.get("targets").and_then(|t| t.as_array())
                        && !targets.is_empty()
                        && let Some(location) = targets[0].get("location")
                        && let Some(country) = location.get("country").and_then(|c| c.as_str())
                    {
                        let emoji = country_code_to_emoji(country);
                        return UnlockItem {
                            name: "Netflix".to_string(),
                            status: "Yes".to_string(),
                            region: Some(format!("{emoji}{country}")),
                            check_time: Some(get_local_date_string()),
                        };
                    }

                    UnlockItem {
                        name: "Netflix".to_string(),
                        status: "Unknown".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
                Err(e) => {
                    eprintln!("解析Fast.com API响应失败: {e}");
                    UnlockItem {
                        name: "Netflix".to_string(),
                        status: "Failed (解析错误)".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("Fast.com API请求失败: {e}");
            UnlockItem {
                name: "Netflix".to_string(),
                status: "Failed (CDN API)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            }
        }
    }
}
