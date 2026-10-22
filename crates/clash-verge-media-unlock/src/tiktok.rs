use reqwest::{Client, StatusCode};

use crate::utils::{classify_restricted_status, extract_quoted_field};

use super::UnlockItem;

pub(crate) const TIKTOK_NAME: &str = "TikTok";

pub(super) async fn check_tiktok(client: &Client) -> UnlockItem {
    let (mut status, mut region) = check_url(client, "https://www.tiktok.com/cdn-cgi/trace").await;

    if region.is_none() || status == "Failed" {
        let (fallback_status, fallback_region) = check_url(client, "https://www.tiktok.com/").await;

        if status != "No" {
            status = fallback_status;
        }

        region = region.or(fallback_region);
    }

    UnlockItem::checked(TIKTOK_NAME, status, region)
}

async fn check_url(client: &Client, url: &str) -> (&'static str, Option<String>) {
    let Ok(response) = client.get(url).send().await else {
        return ("Failed", None);
    };

    let status = response.status();

    let Ok(body) = response.text().await else {
        return ("Failed", None);
    };

    (determine_status(status, &body), extract_region(&body))
}

fn determine_status(status: StatusCode, body: &str) -> &'static str {
    if let Some(status) = classify_restricted_status(status) {
        return status;
    }

    let body = body.to_ascii_lowercase();

    if [
        "access denied",
        "not available in your region",
        "tiktok is not available",
    ]
    .iter()
    .any(|text| body.contains(text))
    {
        "No"
    } else {
        "Yes"
    }
}

fn extract_region(body: &str) -> Option<String> {
    let region = extract_quoted_field(body, "region")?;

    let code = region.split('-').next()?.to_ascii_uppercase();

    (!code.is_empty()).then(|| UnlockItem::region_label(&code))
}
