use reqwest::Client;

use super::UnlockItem;

pub(crate) const GEMINI_NAME: &str = "Gemini";
const BLOCKED_CODES: [&str; 9] = ["CHN", "RUS", "BLR", "CUB", "IRN", "PRK", "SYR", "HKG", "MAC"];
const REGION_MARKER: &str = ",2,1,200,\"";

pub(super) async fn check_gemini(client: &Client) -> UnlockItem {
    let Ok(response) = client.get("https://gemini.google.com").send().await else {
        return UnlockItem::checked(GEMINI_NAME, "Failed", None);
    };

    let Ok(body) = response.text().await else {
        return UnlockItem::checked(GEMINI_NAME, "Failed", None);
    };

    let Some(code) = body
        .split_once(REGION_MARKER)
        .and_then(|(_, rest)| rest.get(..3))
        .filter(|code| code.bytes().all(|c| c.is_ascii_uppercase()))
    else {
        return UnlockItem::checked(GEMINI_NAME, "Failed", None);
    };

    UnlockItem::checked_region(
        GEMINI_NAME,
        if BLOCKED_CODES.contains(&code) { "No" } else { "Yes" },
        code,
    )
}
