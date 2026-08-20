use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::utils::extract_quoted_field;

use super::UnlockItem;

pub(crate) const DISNEY_NAME: &str = "Disney+";

const AUTH_HEADER: &str = "Bearer ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";

const DEVICE_URL: &str = "https://disney.api.edge.bamgrid.com/devices";
const TOKEN_URL: &str = "https://disney.api.edge.bamgrid.com/token";
const GRAPHQL_URL: &str = "https://disney.api.edge.bamgrid.com/graph/v1/device/graphql";

#[derive(Deserialize)]
struct DeviceResponse {
    assertion: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    refresh_token: String,
}

fn item(status: impl Into<String>, region: Option<String>) -> UnlockItem {
    UnlockItem::checked(DISNEY_NAME, status, region)
}

pub(super) async fn check_disney_plus(client: &Client) -> UnlockItem {
    let assertion = match get_assertion(client).await {
        Ok(assertion) => assertion,
        Err(item) => return item,
    };

    let refresh_token = match get_refresh_token(client, &assertion).await {
        Ok(token) => token,
        Err(item) => return item,
    };

    let unavailable = is_unavailable(client).await;

    let response = match client
        .post(GRAPHQL_URL)
        .header("authorization", AUTH_HEADER)
        .json(&json!({
            "query": "mutation refreshToken($input: RefreshTokenInput!) { refreshToken(refreshToken: $input) { activeSession { sessionId } } }",
            "variables": {
                "input": {
                    "refreshToken": refresh_token
                }
            }
        }))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return item("Failed (Network Connection)", None),
    };

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() || body.is_empty() {
        return fallback_region(client)
            .await
            .unwrap_or_else(|| item(format!("Failed (GraphQL: {status})"), None));
    }

    let Ok(data) = serde_json::from_str::<Value>(&body) else {
        return fallback_region(client)
            .await
            .unwrap_or_else(|| item("Failed (Invalid GraphQL Response)", None));
    };

    let Some(region) = find_string(&data, "countryCode") else {
        return fallback_region(client).await.unwrap_or_else(|| item("No", None));
    };

    if region == "JP" {
        return UnlockItem::checked_region(DISNEY_NAME, "Yes", region);
    }

    if unavailable {
        return item("No", None);
    }

    match find_bool(&data, "inSupportedLocation") {
        Some(true) => UnlockItem::checked_region(DISNEY_NAME, "Yes", region),
        Some(false) => item(
            "Soon",
            Some(format!("{}（即将上线）", UnlockItem::region_label(region))),
        ),
        None => item(format!("Failed (Unknown region status for {region})"), None),
    }
}

async fn get_assertion(client: &Client) -> Result<String, UnlockItem> {
    let response = client
        .post(DEVICE_URL)
        .header("authorization", AUTH_HEADER)
        .json(&json!({
            "deviceFamily": "browser",
            "applicationRuntime": "chrome",
            "deviceProfile": "windows",
            "attributes": {}
        }))
        .send()
        .await
        .map_err(|_| item("Failed (Network Connection)", None))?;

    if response.status() == StatusCode::FORBIDDEN {
        return Err(item("No (IP Banned By Disney+)", None));
    }

    response
        .json::<DeviceResponse>()
        .await
        .map(|data| data.assertion)
        .map_err(|_| item("Failed (Cannot extract assertion)", None))
}

async fn get_refresh_token(client: &Client, assertion: &str) -> Result<String, UnlockItem> {
    let response = client
        .post(TOKEN_URL)
        .header("authorization", AUTH_HEADER)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"),
            ("latitude", "0"),
            ("longitude", "0"),
            ("platform", "browser"),
            ("subject_token", assertion),
            ("subject_token_type", "urn:bamtech:params:oauth:token-type:device"),
        ])
        .send()
        .await
        .map_err(|_| item("Failed (Network Connection)", None))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|_| item("Failed (Cannot read token response)", None))?;

    if status == StatusCode::FORBIDDEN || body.contains("forbidden-location") || body.contains("403 ERROR") {
        return Err(item("No (IP Banned By Disney+)", None));
    }

    serde_json::from_str::<TokenResponse>(&body)
        .map(|data| data.refresh_token)
        .map_err(|_| item(format!("Failed (Cannot extract refresh token: {status})"), None))
}

async fn is_unavailable(client: &Client) -> bool {
    client
        .get("https://disneyplus.com")
        .send()
        .await
        .map(|response| {
            let url = response.url().as_str();
            url.contains("preview") || url.contains("unavailable")
        })
        .unwrap_or(true)
}

async fn fallback_region(client: &Client) -> Option<UnlockItem> {
    let body = client
        .get("https://www.disneyplus.com/")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    let region = extract_quoted_field(&body, "region")?;

    Some(item(
        "Yes",
        Some(format!("{} (from main page)", UnlockItem::region_label(region))),
    ))
}

fn find_string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(Value::as_str)
            .or_else(|| map.values().find_map(|v| find_string(v, key))),

        Value::Array(array) => array.iter().find_map(|v| find_string(v, key)),

        _ => None,
    }
}

fn find_bool(value: &Value, key: &str) -> Option<bool> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(Value::as_bool)
            .or_else(|| map.values().find_map(|v| find_bool(v, key))),

        Value::Array(array) => array.iter().find_map(|v| find_bool(v, key)),

        _ => None,
    }
}
