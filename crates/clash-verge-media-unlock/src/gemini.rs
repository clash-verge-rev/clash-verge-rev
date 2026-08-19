use reqwest::Client;

use super::UnlockItem;

const BLOCKED_CODES: [&str; 9] = ["CHN", "RUS", "BLR", "CUB", "IRN", "PRK", "SYR", "HKG", "MAC"];
const REGION_MARKER: &str = ",2,1,200,\"";

pub(super) async fn check_gemini(client: &Client) -> UnlockItem {
    let url = "https://gemini.google.com";
    let failed = || UnlockItem::checked("Gemini", "Failed", None);

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
            let status = if BLOCKED_CODES.contains(&code) { "No" } else { "Yes" };
            UnlockItem::checked_region("Gemini", status, code)
        }
        None => failed(),
    }
}
