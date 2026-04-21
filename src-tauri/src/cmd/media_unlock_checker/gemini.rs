use reqwest::Client;

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

const BLOCKED_CODES: [&str; 9] = ["CHN", "RUS", "BLR", "CUB", "IRN", "PRK", "SYR", "HKG", "MAC"];
const REGION_MARKER: &str = ",2,1,200,\"";

pub(super) async fn check_gemini(client: &Client) -> UnlockItem {
    let url = "https://gemini.google.com";
    let failed = || UnlockItem {
        name: "Gemini".to_string(),
        status: "Failed".to_string(),
        region: None,
        check_time: Some(get_local_date_string()),
    };

    let response = match client.get(url).send().await {
        Ok(r) => r,
        Err(_) => return failed(),
    };
    let body = match response.text().await {
        Ok(b) => b,
        Err(_) => return failed(),
    };

    let country_code = body
        .find(REGION_MARKER)
        .and_then(|i| {
            let start = i + REGION_MARKER.len();
            body.get(start..start + 3)
        })
        .filter(|s| s.bytes().all(|b| b.is_ascii_uppercase()));

    match country_code {
        Some(code) => {
            let emoji = country_code_to_emoji(code);
            let status = if BLOCKED_CODES.contains(&code) { "No" } else { "Yes" };
            UnlockItem {
                name: "Gemini".to_string(),
                status: status.to_string(),
                region: Some(format!("{emoji}{code}")),
                check_time: Some(get_local_date_string()),
            }
        }
        None => failed(),
    }
}
