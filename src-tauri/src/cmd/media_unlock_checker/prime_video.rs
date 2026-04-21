use regex::Regex;
use reqwest::Client;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_prime_video(client: &Client) -> UnlockItem {
    let url = "https://www.primevideo.com";

    let result = client.get(url).send().await;

    if result.is_err() {
        return UnlockItem {
            name: "Prime Video".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let response = match result {
        Ok(response) => response,
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Prime Video response: {}", e);
            return UnlockItem {
                name: "Prime Video".to_string(),
                status: "Failed (Network Connection)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
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
                    return UnlockItem {
                        name: "Prime Video".to_string(),
                        status: "Failed (Regex Error)".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    };
                }
            };
            let region_code = region_re
                .captures(&body)
                .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()));

            if is_blocked {
                return UnlockItem {
                    name: "Prime Video".to_string(),
                    status: "No (Service Not Available)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                };
            }

            if let Some(region) = region_code {
                let emoji = country_code_to_emoji(&region);
                return UnlockItem {
                    name: "Prime Video".to_string(),
                    status: "Yes".to_string(),
                    region: Some(format!("{emoji}{region}")),
                    check_time: Some(get_local_date_string()),
                };
            }

            if !is_blocked {
                return UnlockItem {
                    name: "Prime Video".to_string(),
                    status: "Failed (Error: PAGE ERROR)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                };
            }

            UnlockItem {
                name: "Prime Video".to_string(),
                status: "Failed (Error: Unknown Region)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            }
        }
        Err(_) => UnlockItem {
            name: "Prime Video".to_string(),
            status: "Failed (Error: Cannot read response)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}
