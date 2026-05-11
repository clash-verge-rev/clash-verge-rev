use regex::Regex;
use reqwest::Client;

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

pub(super) async fn check_youtube_premium(client: &Client) -> UnlockItem {
    let url = "https://www.youtube.com/premium";

    match client.get(url).send().await {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let (status, region) = detect_youtube_premium(&body);

                UnlockItem {
                    name: "YouTube Premium".to_string(),
                    status: status.to_string(),
                    region,
                    check_time: Some(get_local_date_string()),
                }
            } else {
                UnlockItem {
                    name: "YouTube Premium".to_string(),
                    status: "Failed".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
        Err(_) => UnlockItem {
            name: "YouTube Premium".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

fn detect_youtube_premium(body: &str) -> (&'static str, Option<String>) {
    let body_lower = body.to_lowercase();

    if body_lower.contains("youtube premium is not available in your country") {
        return ("No", None);
    }

    if body_lower.contains("ad-free")
        && let Some(region) = extract_youtube_region(body)
    {
        return ("Yes", Some(region));
    }

    ("Failed", None)
}

fn extract_youtube_region(body: &str) -> Option<String> {
    [
        r#"id=["']country-code["'][^>]*>\s*([A-Za-z]{2,3})\s*<"#,
        r#""countryCode"\s*:\s*"([A-Z]{2,3})""#,
        r#""gl"\s*:\s*"([A-Z]{2})""#,
    ]
    .iter()
    .find_map(|pattern| {
        Regex::new(pattern).ok().and_then(|re| {
            re.captures(body)
                .and_then(|caps| caps.get(1))
                .and_then(|m| format_region(m.as_str()))
        })
    })
}

fn format_region(country_code: &str) -> Option<String> {
    let country_code = country_code.trim().to_ascii_uppercase();
    let emoji = country_code_to_emoji(&country_code);

    if emoji.is_empty() {
        None
    } else {
        Some(format!("{emoji}{country_code}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{detect_youtube_premium, extract_youtube_region};

    #[test]
    fn detects_legacy_country_code_marker() {
        let body = r#"<html><body>ad-free<span id="country-code">US</span></body></html>"#;

        let (status, region) = detect_youtube_premium(body);

        assert_eq!(status, "Yes");
        assert_eq!(region.as_deref().map(|value| value.ends_with("US")), Some(true));
    }

    #[test]
    fn detects_modern_innertube_country_code() {
        let body =
            r#"ad-free "INNERTUBE_CONTEXT":{"client":{"gl":"SG","remoteHost":"203.0.113.1"}},"countryCode":"SG""#;

        let (status, region) = detect_youtube_premium(body);

        assert_eq!(status, "Yes");
        assert_eq!(region.as_deref().map(|value| value.ends_with("SG")), Some(true));
    }

    #[test]
    fn detects_modern_gl_region_without_country_code() {
        let body = r#"ad-free "INNERTUBE_CONTEXT":{"client":{"gl":"JP","remoteHost":"203.0.113.1"}}"#;

        assert_eq!(
            extract_youtube_region(body)
                .as_deref()
                .map(|value| value.ends_with("JP")),
            Some(true)
        );
    }

    #[test]
    fn detects_unavailable_country_message() {
        let body = "YouTube Premium is not available in your country";

        let (status, region) = detect_youtube_premium(body);

        assert_eq!(status, "No");
        assert_eq!(region, None);
    }

    #[test]
    fn fails_when_available_marker_has_no_region() {
        let body = "ad-free";

        let (status, region) = detect_youtube_premium(body);

        assert_eq!(status, "Failed");
        assert_eq!(region, None);
    }
}
