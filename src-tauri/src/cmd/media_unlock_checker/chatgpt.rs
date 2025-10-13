use std::collections::HashMap;

use reqwest::Client;

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_chatgpt_combined(client: &Client) -> Vec<UnlockItem> {
    let mut results = Vec::new();

    let url_country = "https://chat.openai.com/cdn-cgi/trace";
    let result_country = client.get(url_country).send().await;

    let region = match result_country {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let mut map = HashMap::new();
                for line in body.lines() {
                    if let Some(index) = line.find('=') {
                        let key = &line[..index];
                        let value = &line[index + 1..];
                        map.insert(key.to_string(), value.to_string());
                    }
                }

                map.get("loc").map(|loc| {
                    let emoji = country_code_to_emoji(loc);
                    format!("{emoji}{loc}")
                })
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let url_ios = "https://ios.chat.openai.com/";
    let result_ios = client.get(url_ios).send().await;

    let ios_status = match result_ios {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let body_lower = body.to_lowercase();
                if body_lower.contains("you may be connected to a disallowed isp") {
                    "Disallowed ISP"
                } else if body_lower.contains("request is not allowed. please try again later.") {
                    "Yes"
                } else if body_lower.contains("sorry, you have been blocked") {
                    "Blocked"
                } else {
                    "Failed"
                }
            } else {
                "Failed"
            }
        }
        Err(_) => "Failed",
    };

    let url_web = "https://api.openai.com/compliance/cookie_requirements";
    let result_web = client.get(url_web).send().await;

    let web_status = match result_web {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let body_lower = body.to_lowercase();
                if body_lower.contains("unsupported_country") {
                    "Unsupported Country/Region"
                } else {
                    "Yes"
                }
            } else {
                "Failed"
            }
        }
        Err(_) => "Failed",
    };

    results.push(UnlockItem {
        name: "ChatGPT iOS".to_string(),
        status: ios_status.to_string(),
        region: region.clone(),
        check_time: Some(get_local_date_string()),
    });

    results.push(UnlockItem {
        name: "ChatGPT Web".to_string(),
        status: web_status.to_string(),
        region,
        check_time: Some(get_local_date_string()),
    });

    results
}
