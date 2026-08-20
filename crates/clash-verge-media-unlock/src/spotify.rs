use reqwest::{Client, StatusCode, Url};

use crate::utils::classify_restricted_status;

use super::UnlockItem;

pub(crate) const SPOTIFY_NAME: &str = "Spotify";

pub(super) async fn check_spotify(client: &Client) -> UnlockItem {
    let response = match client
        .get("https://www.spotify.com/api/content/v1/country-selector?platform=web&format=json")
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return UnlockItem::checked(SPOTIFY_NAME, "Failed", None),
    };

    let status = response.status();
    let final_url = response.url().clone();
    let body = response.text().await.unwrap_or_default();

    let region = extract_region(&final_url).or_else(|| extract_region_from_body(&body));

    UnlockItem::checked(SPOTIFY_NAME, determine_status(status, &body), region)
}

fn determine_status(status: StatusCode, body: &str) -> &'static str {
    if let Some(status) = classify_restricted_status(status) {
        return status;
    }

    if body.to_ascii_lowercase().contains("not available in your country") {
        "No"
    } else {
        "Yes"
    }
}

fn extract_region(url: &Url) -> Option<String> {
    let segment = url.path_segments()?.next()?;

    if segment.is_empty() || segment == "api" {
        return None;
    }

    let code = segment.split('-').next()?.to_ascii_uppercase();

    Some(UnlockItem::region_label(&code))
}

fn extract_region_from_body(body: &str) -> Option<String> {
    let code = body
        .split_once(r#""countryCode":""#)?
        .1
        .split_once('"')?
        .0
        .to_ascii_uppercase();

    (!code.is_empty()).then(|| UnlockItem::region_label(&code))
}
