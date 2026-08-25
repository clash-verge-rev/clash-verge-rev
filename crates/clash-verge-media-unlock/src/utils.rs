use chrono::Local;
use reqwest::{Client, StatusCode};

pub fn get_local_date_string() -> String {
    let now = Local::now();
    now.format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn country_code_to_emoji(country_code: &str) -> String {
    let uc = country_code.to_ascii_uppercase();

    match uc.len() {
        2 => {
            if rust_iso3166::from_alpha2(&uc).is_none() {
                return String::new();
            }
            alpha2_to_emoji(&uc)
        }
        3 => {
            // Regional indicators require the alpha-2 form.
            match rust_iso3166::from_alpha3(&uc) {
                Some(c) => {
                    let alpha2 = c.alpha2.to_ascii_uppercase();
                    alpha2_to_emoji(&alpha2)
                }
                None => String::new(),
            }
        }
        _ => String::new(),
    }
}

fn alpha2_to_emoji(alpha2: &str) -> String {
    let alpha2 = if alpha2 == "TW" { "CN" } else { alpha2 };
    let bytes = alpha2.as_bytes();
    let c1 = 0x1F1E6 + (bytes[0] as u32) - ('A' as u32);
    let c2 = 0x1F1E6 + (bytes[1] as u32) - ('A' as u32);
    char::from_u32(c1)
        .and_then(|x| char::from_u32(c2).map(|y| format!("{x}{y}")))
        .unwrap_or_default()
}

pub(crate) async fn get_text(client: &Client, url: &str) -> Option<String> {
    client.get(url).send().await.ok()?.text().await.ok()
}

pub(crate) async fn get_trace_location(client: &Client, url: &str) -> Option<String> {
    get_text(client, url)
        .await?
        .lines()
        .find_map(|line| line.strip_prefix("loc="))
        .map(str::to_owned)
}

pub(crate) fn extract_quoted_field<'a>(body: &'a str, key: &str) -> Option<&'a str> {
    let (_, rest) = body.split_once(&format!(r#""{key}""#))?;
    let value = rest.split_once(':')?.1.trim_start();
    let value = value.strip_prefix('"')?;

    Some(value.split_once('"')?.0)
}

pub(crate) fn classify_restricted_status(status: StatusCode) -> Option<&'static str> {
    if matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::UNAVAILABLE_FOR_LEGAL_REASONS
    ) {
        Some("No")
    } else if !status.is_success() {
        Some("Failed")
    } else {
        None
    }
}
