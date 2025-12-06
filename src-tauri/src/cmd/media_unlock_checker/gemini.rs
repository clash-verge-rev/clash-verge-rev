use regex::Regex;
use reqwest::Client;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_gemini(client: &Client) -> UnlockItem {
    let url = "https://gemini.google.com";

    match client.get(url).send().await {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let is_ok = body.contains("45631641,null,true");
                let status = if is_ok { "Yes" } else { "No" };

                let re = match Regex::new(r#",2,1,200,"([A-Z]{3})""#) {
                    Ok(re) => re,
                    Err(e) => {
                        logging!(error, Type::Network, "Failed to compile Gemini regex: {}", e);
                        return UnlockItem {
                            name: "Gemini".to_string(),
                            status: "Failed".to_string(),
                            region: None,
                            check_time: Some(get_local_date_string()),
                        };
                    }
                };

                let region = re.captures(&body).and_then(|caps| {
                    caps.get(1).map(|m| {
                        let country_code = m.as_str();
                        let emoji = country_code_to_emoji(country_code);
                        format!("{emoji}{country_code}")
                    })
                });

                UnlockItem {
                    name: "Gemini".to_string(),
                    status: status.to_string(),
                    region,
                    check_time: Some(get_local_date_string()),
                }
            } else {
                UnlockItem {
                    name: "Gemini".to_string(),
                    status: "Failed".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
        Err(_) => UnlockItem {
            name: "Gemini".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}
