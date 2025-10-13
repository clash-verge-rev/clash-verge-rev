use regex::Regex;
use reqwest::Client;

use crate::{logging, utils::logging::Type};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_youtube_premium(client: &Client) -> UnlockItem {
    let url = "https://www.youtube.com/premium";

    match client.get(url).send().await {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let body_lower = body.to_lowercase();

                if body_lower.contains("youtube premium is not available in your country") {
                    return UnlockItem {
                        name: "Youtube Premium".to_string(),
                        status: "No".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    };
                }

                if body_lower.contains("ad-free") {
                    let re = match Regex::new(r#"id="country-code"[^>]*>([^<]+)<"#) {
                        Ok(re) => re,
                        Err(e) => {
                            logging!(
                                error,
                                Type::Network,
                                "Failed to compile YouTube Premium regex: {}",
                                e
                            );
                            return UnlockItem {
                                name: "Youtube Premium".to_string(),
                                status: "Failed".to_string(),
                                region: None,
                                check_time: Some(get_local_date_string()),
                            };
                        }
                    };
                    let region = re.captures(&body).and_then(|caps| {
                        caps.get(1).map(|m| {
                            let country_code = m.as_str().trim();
                            let emoji = country_code_to_emoji(country_code);
                            format!("{emoji}{country_code}")
                        })
                    });

                    return UnlockItem {
                        name: "Youtube Premium".to_string(),
                        status: "Yes".to_string(),
                        region,
                        check_time: Some(get_local_date_string()),
                    };
                }

                UnlockItem {
                    name: "Youtube Premium".to_string(),
                    status: "Failed".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            } else {
                UnlockItem {
                    name: "Youtube Premium".to_string(),
                    status: "Failed".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
        Err(_) => UnlockItem {
            name: "Youtube Premium".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}
