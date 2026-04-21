use reqwest::{Client, Url};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_spotify(client: &Client) -> UnlockItem {
    let url = "https://www.spotify.com/api/content/v1/country-selector?platform=web&format=json";

    match client.get(url).send().await {
        Ok(response) => {
            let final_url = response.url().clone();
            let status_code = response.status();
            let body = response.text().await.unwrap_or_default();

            let region = extract_region(&final_url).or_else(|| extract_region_from_body(&body));
            let status = determine_status(status_code.as_u16(), &body);

            UnlockItem {
                name: "Spotify".to_string(),
                status: status.to_string(),
                region,
                check_time: Some(get_local_date_string()),
            }
        }
        Err(_) => UnlockItem {
            name: "Spotify".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

fn determine_status(status: u16, body: &str) -> &'static str {
    if status == 403 || status == 451 {
        return "No";
    }

    if !(200..300).contains(&status) {
        return "Failed";
    }

    let body_lower = body.to_lowercase();
    if body_lower.contains("not available in your country") {
        return "No";
    }

    "Yes"
}

fn extract_region(url: &Url) -> Option<String> {
    let mut segments = url.path_segments()?;
    let first_segment = segments.next()?;

    if first_segment.is_empty() || first_segment == "api" {
        return None;
    }

    let country_code = first_segment.split('-').next().unwrap_or(first_segment);
    let upper = country_code.to_uppercase();
    let emoji = country_code_to_emoji(&upper);
    Some(format!("{emoji}{upper}"))
}

fn extract_region_from_body(body: &str) -> Option<String> {
    let marker = "\"countryCode\":\"";
    if let Some(idx) = body.find(marker) {
        let start = idx + marker.len();
        let rest = &body[start..];
        if let Some(end) = rest.find('"') {
            let code = rest[..end].to_uppercase();
            if !code.is_empty() {
                let emoji = country_code_to_emoji(&code);
                return Some(format!("{emoji}{code}"));
            }
        }
    }
    None
}
