use regex::Regex;
use reqwest::Client;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;

const DISNEY_PLUS: &str = "Disney+";
const AUTH_HEADER: &str = "Bearer ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";

fn disney_item(status: impl Into<String>, region: Option<String>) -> UnlockItem {
    UnlockItem::checked(DISNEY_PLUS, status, region)
}

async fn fetch_main_page_region(client: &Client) -> Option<String> {
    let body = client
        .get("https://www.disneyplus.com/")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let region_re = match Regex::new(r#"region"\s*:\s*"([^"]+)"#) {
        Ok(region_re) => region_re,
        Err(e) => {
            logging!(
                error,
                Type::Network,
                "Failed to compile Disney+ main page region regex: {}",
                e
            );
            return None;
        }
    };
    region_re
        .captures(&body)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

async fn disney_region_from_main_page(client: &Client) -> Option<UnlockItem> {
    let region = fetch_main_page_region(client).await?;
    Some(disney_item(
        "Yes",
        Some(format!("{} (from main page)", UnlockItem::region_label(&region))),
    ))
}

#[allow(clippy::cognitive_complexity)]
pub(super) async fn check_disney_plus(client: &Client) -> UnlockItem {
    let device_api_url = "https://disney.api.edge.bamgrid.com/devices";

    let device_req_body = serde_json::json!({
        "deviceFamily": "browser",
        "applicationRuntime": "chrome",
        "deviceProfile": "windows",
        "attributes": {}
    });

    let device_result = client
        .post(device_api_url)
        .header("authorization", AUTH_HEADER)
        .header("content-type", "application/json; charset=UTF-8")
        .json(&device_req_body)
        .send()
        .await;

    let device_response = match device_result {
        Ok(response) => response,
        Err(_) => {
            return disney_item("Failed (Network Connection)", None);
        }
    };

    if device_response.status().as_u16() == 403 {
        return disney_item("No (IP Banned By Disney+)", None);
    }

    let device_body = match device_response.text().await {
        Ok(body) => body,
        Err(_) => {
            return disney_item("Failed (Error: Cannot read response)", None);
        }
    };

    let re = match Regex::new(r#""assertion"\s*:\s*"([^"]+)"#) {
        Ok(re) => re,
        Err(e) => {
            logging!(
                error,
                Type::Network,
                "Failed to compile assertion regex for Disney+: {}",
                e
            );
            return disney_item("Failed (Regex Error)", None);
        }
    };
    let assertion = match re.captures(&device_body) {
        Some(caps) => caps.get(1).map(|m| m.as_str().to_string()),
        None => None,
    };

    if assertion.is_none() {
        return disney_item("Failed (Error: Cannot extract assertion)", None);
    }

    let token_url = "https://disney.api.edge.bamgrid.com/token";
    let assertion_str = assertion.unwrap_or_default();
    let token_body = [
        ("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"),
        ("latitude", "0"),
        ("longitude", "0"),
        ("platform", "browser"),
        ("subject_token", assertion_str.as_str()),
        ("subject_token_type", "urn:bamtech:params:oauth:token-type:device"),
    ];

    let token_result = client
        .post(token_url)
        .header("authorization", AUTH_HEADER)
        .header("content-type", "application/x-www-form-urlencoded")
        .form(&token_body)
        .send()
        .await;

    let token_response = match token_result {
        Ok(response) => response,
        Err(_) => {
            return disney_item("Failed (Network Connection)", None);
        }
    };
    let token_status = token_response.status();

    let token_body_text = match token_response.text().await {
        Ok(body) => body,
        Err(_) => {
            return disney_item("Failed (Error: Cannot read token response)", None);
        }
    };

    if token_body_text.contains("forbidden-location") || token_body_text.contains("403 ERROR") {
        return disney_item("No (IP Banned By Disney+)", None);
    }

    let token_json: Result<serde_json::Value, _> = serde_json::from_str(&token_body_text);

    let refresh_token = match token_json {
        Ok(json) => json
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        Err(_) => match Regex::new(r#""refresh_token"\s*:\s*"([^"]+)"#) {
            Ok(refresh_token_re) => refresh_token_re
                .captures(&token_body_text)
                .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string())),
            Err(e) => {
                logging!(
                    error,
                    Type::Network,
                    "Failed to compile refresh_token regex for Disney+: {}",
                    e
                );
                None
            }
        },
    };

    if refresh_token.is_none() {
        return disney_item(
            format!(
                "Failed (Error: Cannot extract refresh token, status: {}, response: {})",
                token_status.as_u16(),
                token_body_text.chars().take(100).collect::<String>() + "..."
            ),
            None,
        );
    }

    let graphql_url = "https://disney.api.edge.bamgrid.com/graph/v1/device/graphql";

    let graphql_payload = format!(
        r#"{{"query":"mutation refreshToken($input: RefreshTokenInput!) {{ refreshToken(refreshToken: $input) {{ activeSession {{ sessionId }} }} }}","variables":{{"input":{{"refreshToken":"{}"}}}}}}"#,
        refresh_token.unwrap_or_default()
    );

    let graphql_result = client
        .post(graphql_url)
        .header("authorization", AUTH_HEADER)
        .header("content-type", "application/json")
        .body(graphql_payload)
        .send()
        .await;

    let preview_check = client.get("https://disneyplus.com").send().await;

    let is_unavailable = match preview_check {
        Ok(response) => {
            let url = response.url().to_string();
            url.contains("preview") || url.contains("unavailable")
        }
        Err(_) => true,
    };

    let graphql_response = match graphql_result {
        Ok(response) => response,
        Err(_) => {
            return disney_item("Failed (Network Connection)", None);
        }
    };
    let graphql_status = graphql_response.status();
    let graphql_body_text = match graphql_response.text().await {
        Ok(text) => text,
        Err(e) => {
            logging!(
                error,
                Type::Network,
                "Failed to read Disney+ GraphQL response text: {}",
                e
            );
            String::new()
        }
    };

    if graphql_body_text.is_empty() || graphql_status.as_u16() >= 400 {
        if let Some(item) = disney_region_from_main_page(client).await {
            return item;
        }

        if graphql_body_text.is_empty() {
            return disney_item(
                format!(
                    "Failed (GraphQL error: empty response, status: {})",
                    graphql_status.as_u16()
                ),
                None,
            );
        }
        return disney_item(
            format!(
                "Failed (GraphQL error: {}, status: {})",
                graphql_body_text.chars().take(50).collect::<String>() + "...",
                graphql_status.as_u16()
            ),
            None,
        );
    }

    let region_re = match Regex::new(r#""countryCode"\s*:\s*"([^"]+)"#) {
        Ok(re) => re,
        Err(e) => {
            logging!(
                error,
                Type::Network,
                "Failed to compile Disney+ countryCode regex: {}",
                e
            );
            return disney_item("Failed (Regex Error)", None);
        }
    };
    let region_code = region_re
        .captures(&graphql_body_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()));

    let supported_re = match Regex::new(r#""inSupportedLocation"\s*:\s*(false|true)"#) {
        Ok(re) => re,
        Err(e) => {
            logging!(
                error,
                Type::Network,
                "Failed to compile Disney+ supported location regex: {}",
                e
            );
            return disney_item("Failed (Regex Error)", None);
        }
    };
    let in_supported_location = supported_re
        .captures(&graphql_body_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str() == "true"));

    if region_code.is_none() {
        if let Some(item) = disney_region_from_main_page(client).await {
            return item;
        }

        return disney_item("No", None);
    }

    let region = region_code.unwrap_or_default();

    if region == "JP" {
        return UnlockItem::checked_region(DISNEY_PLUS, "Yes", &region);
    }

    if is_unavailable {
        return disney_item("No", None);
    }

    match in_supported_location {
        Some(false) => disney_item(
            "Soon",
            Some(format!("{}（即将上线）", UnlockItem::region_label(&region))),
        ),
        Some(true) => UnlockItem::checked_region(DISNEY_PLUS, "Yes", &region),
        None => disney_item(format!("Failed (Error: Unknown region status for {region})"), None),
    }
}
