use kode_bridge::{
    errors::{AnyError, AnyResult},
    types::Response,
    IpcHttpClient,
};
use serde_json::json;
use std::sync::OnceLock;

use crate::utils::dirs::ipc_path;

pub struct IpcManager {
    ipc_path: String,
}

static INSTANCE: OnceLock<IpcManager> = OnceLock::new();

impl IpcManager {
    pub fn global() -> &'static IpcManager {
        INSTANCE.get_or_init(|| {
            let ipc_path_buf = ipc_path().unwrap();
            let ipc_path = ipc_path_buf.to_str().unwrap_or_default();
            let instance = IpcManager {
                ipc_path: ipc_path.to_string(),
            };
            println!(
                "IpcManager initialized with IPC path: {}",
                instance.ipc_path
            );
            instance
        })
    }
}

impl IpcManager {
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> AnyResult<Response> {
        let client = IpcHttpClient::new(&self.ipc_path);
        Ok(client.request(method, path, body).await?)
    }
}

impl IpcManager {
    pub async fn send_request(
        &self,
        method: &str,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, AnyError> {
        let response = IpcManager::global().request(method, path, body).await?;
        match method {
            "GET" => Ok(response.json()?),
            "PATCH" => {
                if response.status == 204 {
                    Ok(serde_json::json!({"code": 204}))
                } else {
                    Ok(response.json()?)
                }
            }
            "PUT" => Ok(json!(response.body)),
            _ => Ok(response.json()?),
        }
    }

    pub async fn get_refresh_proxies(&self) -> Result<serde_json::Value, AnyError> {
        let url = "/proxies";
        self.send_request("GET", url, None).await
    }
    pub async fn get_providers_proxies(&self) -> Result<serde_json::Value, AnyError> {
        let url = "/providers/proxies";
        self.send_request("GET", url, None).await
    }

    pub async fn close_all_connections(&self) -> Result<(), AnyError> {
        let url = "/connections";
        let response = self.send_request("DELETE", url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(AnyError::from(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }
}

impl IpcManager {
    pub async fn is_mihomo_running(&self) -> Result<(), AnyError> {
        let url = "/version";
        let _response = self.send_request("GET", url, None).await?;
        Ok(())
    }

    pub async fn put_configs_force(&self, clash_config_path: &str) -> Result<(), AnyError> {
        let url = "/configs?force=true";
        let payload = serde_json::json!({
            "path": clash_config_path,
        });
        let _response = self.send_request("PUT", url, Some(&payload)).await?;
        Ok(())
    }

    pub async fn patch_configs(&self, config: serde_json::Value) -> Result<(), AnyError> {
        let url = "/configs";
        let response = self.send_request("PATCH", url, Some(&config)).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(AnyError::from(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }

    pub async fn test_proxy_delay(
        &self,
        name: &str,
        test_url: Option<String>,
        timeout: i32,
    ) -> Result<serde_json::Value, AnyError> {
        let test_url =
            test_url.unwrap_or_else(|| "https://cp.cloudflare.com/generate_204".to_string());
        let url = format!(
            "/proxies/{}/delay?url={}&timeout={}",
            name, test_url, timeout
        );
        let response = self.send_request("GET", &url, None).await?;
        Ok(response)
    }

    pub async fn get_connections(&self) -> Result<serde_json::Value, AnyError> {
        let url = "/connections";
        let response = self.send_request("GET", url, None).await?;
        Ok(response)
    }

    pub async fn delete_connection(&self, id: &str) -> Result<(), AnyError> {
        let url = format!("/connections/{}", id);
        let response = self.send_request("DELETE", &url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(AnyError::from(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }
}
