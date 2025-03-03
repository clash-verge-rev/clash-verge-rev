use crate::model::api::common::ApiCaller;
use async_trait::async_trait;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    RequestBuilder,
};
use serde::de::DeserializeOwned;

impl<'a> ApiCaller<'a> {
    pub async fn send_request(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        headers: Option<Vec<(&str, &str)>>,
    ) -> Result<String, String> {
        let full_url = format!("{}{}", self.url, path); // 拼接完整 URL
        let mut request: RequestBuilder = match method {
            "GET" => self.client.get(&full_url),
            "POST" => self
                .client
                .post(&full_url)
                .body(body.unwrap_or("").to_string()),
            "PUT" => self
                .client
                .put(&full_url)
                .body(body.unwrap_or("").to_string()),
            "DELETE" => self.client.delete(&full_url),
            _ => return Err("Unsupported HTTP method".to_string()),
        };

        // 处理 headers
        if let Some(hdrs) = headers {
            let mut header_map = HeaderMap::new();
            for (key, value) in hdrs {
                if let (Ok(header_name), Ok(header_value)) = (
                    HeaderName::from_bytes(key.as_bytes()),
                    HeaderValue::from_str(value),
                ) {
                    header_map.insert(header_name, header_value);
                }
            }
            request = request.headers(header_map);
        }

        let response = request.send().await.map_err(|e| e.to_string())?;
        response.text().await.map_err(|e| e.to_string())
    }
}

#[allow(unused)]
#[async_trait]
pub trait ApiCallerTrait: Send + Sync {
    async fn call_api<T>(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        headers: Option<Vec<(&str, &str)>>
    ) -> Result<T, String>
    where
        T: DeserializeOwned + Send + Sync;

    fn parse_json_response<T>(json_str: &str) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
        serde_json::from_str(json_str).map_err(|e| e.to_string())
    }
}
