use regex::Regex;
use reqwest::Client;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_youtube_premium(client: &Client) -> UnlockItem {
    let url = "https://www.youtube.com/premium";

    match client.get(url).send().await {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let body_lower = body.to_lowercase();
                let mut status = "Failed";
                let mut region = None;

                if body_lower.contains("youtube premium is not available in your country") {
                    status = "No";
                } else if body_lower.contains("ad-free") {
                    match Regex::new(r#"id="country-code"[^>]*>([^<]+)<"#) {
                        Ok(re) => {
                            if let Some(caps) = re.captures(&body)
                                && let Some(m) = caps.get(1)
                            {
                                let country_code = m.as_str().trim();
                                let emoji = country_code_to_emoji(country_code);
                                region = Some(format!("{emoji}{country_code}"));
                                status = "Yes";
                            }
                        }
                        Err(e) => {
                            logging!(error, Type::Network, "Failed to compile YouTube Premium regex: {}", e);
                        }
                    }
                }

                UnlockItem {
                    name: "YouTube Premium".to_string(),
                    status: status.to_string(),
                    region,
                    check_time: Some(get_local_date_string()),
                }
            } else {
                UnlockItem {
                    name: "YouTube Premium".to_string(),
                    status: "Failed".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
        Err(_) => UnlockItem {
            name: "YouTube Premium".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}
