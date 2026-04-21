use reqwest::Client;

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

const BLOCKED_CODES: [&str; 10] = ["AF", "BY", "CN", "CU", "HK", "IR", "KP", "MO", "RU", "SY"];

pub(super) async fn check_claude(client: &Client) -> UnlockItem {
    let url = "https://claude.ai/cdn-cgi/trace";

    match client.get(url).send().await {
        Ok(response) => match response.text().await {
            Ok(body) => {
                let mut country_code: Option<String> = None;

                for line in body.lines() {
                    if let Some(rest) = line.strip_prefix("loc=") {
                        country_code = Some(rest.trim().to_uppercase());
                        break;
                    }
                }

                if let Some(code) = country_code {
                    let emoji = country_code_to_emoji(&code);
                    let status = if BLOCKED_CODES.contains(&code.as_str()) {
                        "No"
                    } else {
                        "Yes"
                    };

                    UnlockItem {
                        name: "Claude".to_string(),
                        status: status.to_string(),
                        region: Some(format!("{emoji}{code}")),
                        check_time: Some(get_local_date_string()),
                    }
                } else {
                    UnlockItem {
                        name: "Claude".to_string(),
                        status: "Failed".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
            }
            Err(_) => UnlockItem {
                name: "Claude".to_string(),
                status: "Failed".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            },
        },
        Err(_) => UnlockItem {
            name: "Claude".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}
