use regex::Regex;
use reqwest::Client;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_youtube_premium(client: &Client) -> UnlockItem {
    let url = "https://www.youtube.com/premium?hl=en";
    let item = |status: &str, region: Option<String>| UnlockItem {
        name: "YouTube Premium".to_string(),
        status: status.to_string(),
        region,
        check_time: Some(get_local_date_string()),
    };

    match client.get(url).send().await {
        Ok(response) => {
            let status_code = response.status().as_u16();

            if let Ok(body) = response.text().await {
                let body_lower = body.to_ascii_lowercase();
                let region = [
                    r#"id=["']country-code["'][^>]*>\s*([A-Za-z]{2,3})\s*<"#,
                    r#""GL"\s*:\s*"([A-Za-z]{2})""#,
                    r#""countryCode"\s*:\s*"([A-Za-z]{2})""#,
                    r#""country_code"\s*:\s*"([A-Za-z]{2})""#,
                ]
                .iter()
                .find_map(|pattern| match Regex::new(pattern) {
                    Ok(re) => re
                        .captures(&body)
                        .and_then(|caps| caps.get(1))
                        .map(|m| m.as_str().trim().to_ascii_uppercase()),
                    Err(e) => {
                        logging!(error, Type::Network, "Failed to compile YouTube Premium regex: {}", e);
                        None
                    }
                })
                .map(|country_code| {
                    let emoji = country_code_to_emoji(&country_code);
                    format!("{emoji}{country_code}")
                });

                let status = if body_lower.contains("youtube premium is not available in your country")
                    || body_lower.contains("premium is not available in your country")
                    || body_lower.contains("premium is not available in your region")
                {
                    "No"
                } else if (200..300).contains(&status_code)
                    && (body_lower.contains("youtube premium")
                        || body_lower.contains("ad-free")
                        || body_lower.contains(r#""browseid":"spunlimited""#))
                {
                    "Yes"
                } else {
                    "Failed"
                };

                item(status, region)
            } else {
                item("Failed", None)
            }
        }
        Err(_) => item("Failed", None),
    }
}
