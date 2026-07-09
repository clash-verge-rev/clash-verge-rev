use regex::Regex;
use reqwest::Client;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;

const PRIME_VIDEO: &str = "Prime Video";

fn prime_video_item(status: impl Into<String>, region: Option<String>) -> UnlockItem {
    UnlockItem::checked(PRIME_VIDEO, status, region)
}

pub(super) async fn check_prime_video(client: &Client) -> UnlockItem {
    let url = "https://www.primevideo.com";

    let result = client.get(url).send().await;

    let response = match result {
        Ok(response) => response,
        Err(_) => {
            return prime_video_item("Failed (Network Connection)", None);
        }
    };

    match response.text().await {
        Ok(body) => {
            let is_blocked = body.contains("isServiceRestricted");

            let region_re = match Regex::new(r#""currentTerritory":"([^"]+)""#) {
                Ok(re) => re,
                Err(e) => {
                    logging!(
                        error,
                        Type::Network,
                        "Failed to compile Prime Video region regex: {}",
                        e
                    );
                    return prime_video_item("Failed (Regex Error)", None);
                }
            };
            let region_code = region_re
                .captures(&body)
                .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()));

            if is_blocked {
                return prime_video_item("No (Service Not Available)", None);
            }

            if let Some(region) = region_code {
                return UnlockItem::checked_region(PRIME_VIDEO, "Yes", &region);
            }

            if !is_blocked {
                return prime_video_item("Failed (Error: PAGE ERROR)", None);
            }

            prime_video_item("Failed (Error: Unknown Region)", None)
        }
        Err(_) => prime_video_item("Failed (Error: Cannot read response)", None),
    }
}
