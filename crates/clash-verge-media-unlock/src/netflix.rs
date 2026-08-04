use reqwest::Client;
use serde_json::Value;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;

const NETFLIX: &str = "Netflix";

fn netflix_item(status: impl Into<String>, region: Option<String>) -> UnlockItem {
    UnlockItem::checked(NETFLIX, status, region)
}

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
        logging!(error, Type::Network, "Netflix请求错误: {e}");
        return netflix_item("Failed", None);
    }

    let result2 = client
        .get(url2)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await;

    if let Err(e) = &result2 {
        logging!(error, Type::Network, "Netflix请求错误: {e}");
        return netflix_item("Failed", None);
    }

    let status1 = match result1 {
        Ok(response) => response.status().as_u16(),
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Netflix response 1: {}", e);
            return netflix_item("Failed", None);
        }
    };

    let status2 = match result2 {
        Ok(response) => response.status().as_u16(),
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Netflix response 2: {}", e);
            return netflix_item("Failed", None);
        }
    };

    if status1 == 404 && status2 == 404 {
        return netflix_item("Originals Only", None);
    }

    if status1 == 403 || status2 == 403 {
        return netflix_item("No", None);
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
                        return UnlockItem::checked_region(NETFLIX, "Yes", region_code);
                    }
                }

                UnlockItem::checked_region(NETFLIX, "Yes", "us")
            }
            Err(e) => {
                logging!(error, Type::Network, "获取Netflix区域信息失败: {e}");
                netflix_item("Yes (但无法获取区域)", None)
            }
        }
    } else {
        netflix_item(format!("Failed (状态码: {status1}_{status2}"), None)
    }
}

async fn check_netflix_cdn(client: &Client) -> UnlockItem {
    let url = "https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5";

    match client.get(url).timeout(std::time::Duration::from_secs(30)).send().await {
        Ok(response) => {
            if response.status().as_u16() == 403 {
                return netflix_item("No (IP Banned By Netflix)", None);
            }

            match response.json::<Value>().await {
                Ok(data) => {
                    if let Some(targets) = data.get("targets").and_then(|t| t.as_array())
                        && !targets.is_empty()
                        && let Some(location) = targets[0].get("location")
                        && let Some(country) = location.get("country").and_then(|c| c.as_str())
                    {
                        return UnlockItem::checked_region(NETFLIX, "Yes", country);
                    }

                    netflix_item("Unknown", None)
                }
                Err(e) => {
                    logging!(error, Type::Network, "解析Fast.com API响应失败: {e}");
                    netflix_item("Failed (解析错误)", None)
                }
            }
        }
        Err(e) => {
            logging!(error, Type::Network, "Fast.com API请求失败: {e}");
            netflix_item("Failed (CDN API)", None)
        }
    }
}
