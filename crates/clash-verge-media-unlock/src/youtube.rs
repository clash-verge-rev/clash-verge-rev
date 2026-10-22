use reqwest::{Client, StatusCode};

use crate::utils::extract_quoted_field;

use super::UnlockItem;

pub(crate) const YOUTUBE_PREMIUM_NAME: &str = "YouTube Premium";

pub(super) async fn check_youtube_premium(client: &Client) -> UnlockItem {
    let Ok(response) = client.get("https://www.youtube.com/premium?hl=en").send().await else {
        return UnlockItem::checked(YOUTUBE_PREMIUM_NAME, "Failed", None);
    };

    let status = response.status();

    let Ok(body) = response.text().await else {
        return UnlockItem::checked(YOUTUBE_PREMIUM_NAME, "Failed", None);
    };

    let region = extract_region(&body).map(|code| UnlockItem::region_label(&code));

    UnlockItem::checked(YOUTUBE_PREMIUM_NAME, determine_status(status, &body), region)
}

fn determine_status(status: StatusCode, body: &str) -> &'static str {
    let body = body.to_ascii_lowercase();

    if [
        "youtube premium is not available in your country",
        "premium is not available in your country",
        "premium is not available in your region",
    ]
    .iter()
    .any(|text| body.contains(text))
    {
        return "No";
    }

    if status.is_success()
        && ["youtube premium", "ad-free", r#""browseid":"spunlimited""#]
            .iter()
            .any(|text| body.contains(text))
    {
        "Yes"
    } else {
        "Failed"
    }
}

fn extract_region(body: &str) -> Option<String> {
    ["GL", "countryCode", "country_code"]
        .iter()
        .find_map(|key| extract_quoted_field(body, key))
        .or_else(|| extract_country_code(body))
        .map(str::to_ascii_uppercase)
}

fn extract_country_code(body: &str) -> Option<&str> {
    let rest = body
        .split_once(r#"id="country-code""#)
        .or_else(|| body.split_once("id='country-code'"))?
        .1;

    let value = rest.split_once('>')?.1.split_once('<')?.0.trim();

    (!value.is_empty()).then_some(value)
}
