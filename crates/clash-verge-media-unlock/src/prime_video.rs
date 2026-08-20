use reqwest::Client;

use super::UnlockItem;

pub(crate) const PRIME_VIDEO_NAME: &str = "Prime Video";

pub(super) async fn check_prime_video(client: &Client) -> UnlockItem {
    let response = match client.get("https://www.primevideo.com").send().await {
        Ok(response) => response,
        Err(_) => {
            return UnlockItem::checked(PRIME_VIDEO_NAME, "Failed (Network Connection)", None);
        }
    };

    let body = match response.text().await {
        Ok(body) => body,
        Err(_) => {
            return UnlockItem::checked(PRIME_VIDEO_NAME, "Failed (Cannot Read Response)", None);
        }
    };

    if body.contains("isServiceRestricted") {
        return UnlockItem::checked(PRIME_VIDEO_NAME, "No (Service Not Available)", None);
    }

    let region = body
        .split_once(r#""currentTerritory":""#)
        .and_then(|(_, rest)| rest.split_once('"'))
        .map(|(region, _)| region);

    match region {
        Some(region) => UnlockItem::checked_region(PRIME_VIDEO_NAME, "Yes", region),
        None => UnlockItem::checked(PRIME_VIDEO_NAME, "Failed (PAGE ERROR)", None),
    }
}
