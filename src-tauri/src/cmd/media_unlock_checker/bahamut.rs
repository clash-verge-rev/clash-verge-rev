use std::sync::Arc;

use clash_verge_logging::{Type, logging};
use regex::Regex;
use reqwest::{Client, cookie::Jar};

use super::UnlockItem;

pub(super) async fn check_bahamut_anime(client: &Client) -> UnlockItem {
    let cookie_store = Arc::new(Jar::default());

    let client_with_cookies = match Client::builder()
        .use_rustls_tls()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        )
        .cookie_provider(Arc::clone(&cookie_store))
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            logging!(
                error,
                Type::Network,
                "Failed to create client with cookies for Bahamut Anime: {}",
                e
            );
            client.clone()
        }
    };

    let device_url = "https://ani.gamer.com.tw/ajax/getdeviceid.php";
    let device_id = match client_with_cookies.get(device_url).send().await {
        Ok(response) => match response.text().await {
            Ok(text) => match Regex::new(r#""deviceid"\s*:\s*"([^"]+)"#) {
                Ok(re) => re
                    .captures(&text)
                    .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
                    .unwrap_or_default(),
                Err(e) => {
                    logging!(
                        error,
                        Type::Network,
                        "Failed to compile deviceid regex for Bahamut Anime: {}",
                        e
                    );
                    String::new()
                }
            },
            Err(_) => String::new(),
        },
        Err(_) => String::new(),
    };

    if device_id.is_empty() {
        return UnlockItem::checked("Bahamut Anime", "Failed", None);
    }

    let url = format!("https://ani.gamer.com.tw/ajax/token.php?adID=89422&sn=37783&device={device_id}");

    let token_result = match client_with_cookies.get(&url).send().await {
        Ok(response) => match response.text().await {
            Ok(body) => {
                if body.contains("animeSn") {
                    Some(body)
                } else {
                    None
                }
            }
            Err(_) => None,
        },
        Err(_) => None,
    };

    if token_result.is_none() {
        return UnlockItem::checked("Bahamut Anime", "No", None);
    }

    let region = match client_with_cookies.get("https://ani.gamer.com.tw/").send().await {
        Ok(response) => match response.text().await {
            Ok(body) => match Regex::new(r#"data-geo="([^"]+)"#) {
                Ok(region_re) => region_re.captures(&body).and_then(|caps| caps.get(1)).map(|m| {
                    let country_code = m.as_str();
                    UnlockItem::region_label(country_code)
                }),
                Err(e) => {
                    logging!(
                        error,
                        Type::Network,
                        "Failed to compile region regex for Bahamut Anime: {}",
                        e
                    );
                    None
                }
            },
            Err(_) => None,
        },
        Err(_) => None,
    };

    UnlockItem::checked("Bahamut Anime", "Yes", region)
}
