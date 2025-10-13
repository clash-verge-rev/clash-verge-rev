use std::sync::OnceLock;

use regex::Regex;
use reqwest::Client;

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_tiktok(client: &Client) -> UnlockItem {
    let trace_url = "https://www.tiktok.com/cdn-cgi/trace";

    let mut status = String::from("Failed");
    let mut region = None;

    if let Ok(response) = client.get(trace_url).send().await {
        let status_code = response.status().as_u16();
        if let Ok(body) = response.text().await {
            status = determine_status(status_code, &body).to_string();
            region = extract_region_from_body(&body);
        }
    }

    if (region.is_none() || status == "Failed")
        && let Ok(response) = client.get("https://www.tiktok.com/").send().await
    {
        let status_code = response.status().as_u16();
        if let Ok(body) = response.text().await {
            let fallback_status = determine_status(status_code, &body);
            let fallback_region = extract_region_from_body(&body);

            if status != "No" {
                status = fallback_status.to_string();
            }

            if region.is_none() {
                region = fallback_region;
            }
        }
    }

    UnlockItem {
        name: "TikTok".to_string(),
        status,
        region,
        check_time: Some(get_local_date_string()),
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
    if body_lower.contains("access denied")
        || body_lower.contains("not available in your region")
        || body_lower.contains("tiktok is not available")
    {
        return "No";
    }

    "Yes"
}

fn extract_region_from_body(body: &str) -> Option<String> {
    static REGION_REGEX: OnceLock<Option<Regex>> = OnceLock::new();
    let regex = REGION_REGEX
        .get_or_init(|| Regex::new(r#""region"\s*:\s*"([a-zA-Z-]+)""#).ok())
        .as_ref()?;

    if let Some(caps) = regex.captures(body)
        && let Some(matched) = caps.get(1)
    {
        let raw = matched.as_str();
        let country_code = raw.split('-').next().unwrap_or(raw).to_uppercase();
        if !country_code.is_empty() {
            let emoji = country_code_to_emoji(&country_code);
            return Some(format!("{emoji}{country_code}"));
        }
    }

    None
}
