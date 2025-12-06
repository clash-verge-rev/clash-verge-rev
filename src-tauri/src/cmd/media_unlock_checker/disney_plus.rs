use regex::Regex;
use reqwest::Client;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;
use super::utils::{country_code_to_emoji, get_local_date_string};

#[allow(clippy::cognitive_complexity)]
pub(super) async fn check_disney_plus(client: &Client) -> UnlockItem {
    let device_api_url = "https://disney.api.edge.bamgrid.com/devices";
    let auth_header = "Bearer ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";

    let device_req_body = serde_json::json!({
        "deviceFamily": "browser",
        "applicationRuntime": "chrome",
        "deviceProfile": "windows",
        "attributes": {}
    });

    let device_result = client
        .post(device_api_url)
        .header("authorization", auth_header)
        .header("content-type", "application/json; charset=UTF-8")
        .json(&device_req_body)
        .send()
        .await;

    if device_result.is_err() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let device_response = match device_result {
        Ok(response) => response,
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Disney+ device response: {}", e);
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Network Connection)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };

    if device_response.status().as_u16() == 403 {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No (IP Banned By Disney+)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let device_body = match device_response.text().await {
        Ok(body) => body,
        Err(_) => {
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Error: Cannot read response)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
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
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Regex Error)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };
    let assertion = match re.captures(&device_body) {
        Some(caps) => caps.get(1).map(|m| m.as_str().to_string()),
        None => None,
    };

    if assertion.is_none() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Error: Cannot extract assertion)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let token_url = "https://disney.api.edge.bamgrid.com/token";
    let assertion_str = match assertion {
        Some(assertion) => assertion,
        None => {
            logging!(error, Type::Network, "No assertion found for Disney+");
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (No Assertion)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };
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
        .header("authorization", auth_header)
        .header("content-type", "application/x-www-form-urlencoded")
        .form(&token_body)
        .send()
        .await;

    if token_result.is_err() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let token_response = match token_result {
        Ok(response) => response,
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Disney+ token response: {}", e);
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Network Connection)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };
    let token_status = token_response.status();

    let token_body_text = match token_response.text().await {
        Ok(body) => body,
        Err(_) => {
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Error: Cannot read token response)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };

    if token_body_text.contains("forbidden-location") || token_body_text.contains("403 ERROR") {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No (IP Banned By Disney+)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
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
        return UnlockItem {
            name: "Disney+".to_string(),
            status: format!(
                "Failed (Error: Cannot extract refresh token, status: {}, response: {})",
                token_status.as_u16(),
                token_body_text.chars().take(100).collect::<String>() + "..."
            ),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let graphql_url = "https://disney.api.edge.bamgrid.com/graph/v1/device/graphql";

    let graphql_payload = format!(
        r#"{{"query":"mutation refreshToken($input: RefreshTokenInput!) {{ refreshToken(refreshToken: $input) {{ activeSession {{ sessionId }} }} }}","variables":{{"input":{{"refreshToken":"{}"}}}}}}"#,
        refresh_token.unwrap_or_default()
    );

    let graphql_result = client
        .post(graphql_url)
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .body(graphql_payload)
        .send()
        .await;

    if graphql_result.is_err() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

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
        Err(e) => {
            logging!(error, Type::Network, "Failed to get Disney+ GraphQL response: {}", e);
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Network Connection)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
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
        let region_from_main = match client.get("https://www.disneyplus.com/").send().await {
            Ok(response) => match response.text().await {
                Ok(body) => match Regex::new(r#"region"\s*:\s*"([^"]+)"#) {
                    Ok(region_re) => region_re
                        .captures(&body)
                        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string())),
                    Err(e) => {
                        logging!(
                            error,
                            Type::Network,
                            "Failed to compile Disney+ main page region regex: {}",
                            e
                        );
                        None
                    }
                },
                Err(_) => None,
            },
            Err(_) => None,
        };

        if let Some(region) = region_from_main {
            let emoji = country_code_to_emoji(&region);
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Yes".to_string(),
                region: Some(format!("{emoji}{region} (from main page)")),
                check_time: Some(get_local_date_string()),
            };
        }

        if graphql_body_text.is_empty() {
            return UnlockItem {
                name: "Disney+".to_string(),
                status: format!(
                    "Failed (GraphQL error: empty response, status: {})",
                    graphql_status.as_u16()
                ),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
        return UnlockItem {
            name: "Disney+".to_string(),
            status: format!(
                "Failed (GraphQL error: {}, status: {})",
                graphql_body_text.chars().take(50).collect::<String>() + "...",
                graphql_status.as_u16()
            ),
            region: None,
            check_time: Some(get_local_date_string()),
        };
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
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Regex Error)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
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
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Regex Error)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };
    let in_supported_location = supported_re
        .captures(&graphql_body_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str() == "true"));

    if region_code.is_none() {
        let region_from_main = match client.get("https://www.disneyplus.com/").send().await {
            Ok(response) => match response.text().await {
                Ok(body) => match Regex::new(r#"region"\s*:\s*"([^"]+)"#) {
                    Ok(region_re) => region_re
                        .captures(&body)
                        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string())),
                    Err(e) => {
                        logging!(
                            error,
                            Type::Network,
                            "Failed to compile Disney+ main page region regex: {}",
                            e
                        );
                        None
                    }
                },
                Err(_) => None,
            },
            Err(_) => None,
        };

        if let Some(region) = region_from_main {
            let emoji = country_code_to_emoji(&region);
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Yes".to_string(),
                region: Some(format!("{emoji}{region} (from main page)")),
                check_time: Some(get_local_date_string()),
            };
        }

        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let region = match region_code {
        Some(code) => code,
        None => {
            logging!(error, Type::Network, "No region code found for Disney+");
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "No".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };

    if region == "JP" {
        let emoji = country_code_to_emoji("JP");
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Yes".to_string(),
            region: Some(format!("{emoji}{region}")),
            check_time: Some(get_local_date_string()),
        };
    }

    if is_unavailable {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    match in_supported_location {
        Some(false) => {
            let emoji = country_code_to_emoji(&region);
            UnlockItem {
                name: "Disney+".to_string(),
                status: "Soon".to_string(),
                region: Some(format!("{emoji}{region}（即将上线）")),
                check_time: Some(get_local_date_string()),
            }
        }
        Some(true) => {
            let emoji = country_code_to_emoji(&region);
            UnlockItem {
                name: "Disney+".to_string(),
                status: "Yes".to_string(),
                region: Some(format!("{emoji}{region}")),
                check_time: Some(get_local_date_string()),
            }
        }
        None => UnlockItem {
            name: "Disney+".to_string(),
            status: format!("Failed (Error: Unknown region status for {region})"),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}
