use std::time::Duration;

use kode_bridge::{
    ClientConfig, IpcHttpClient, LegacyResponse,
    errors::{AnyError, AnyResult},
};
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};

use crate::{
    logging, singleton_with_logging,
    utils::{dirs::ipc_path, logging::Type},
};

// 定义用于URL路径的编码集合，只编码真正必要的字符
const URL_PATH_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ') // 空格
    .add(b'/') // 斜杠
    .add(b'?') // 问号
    .add(b'#') // 井号
    .add(b'&') // 和号
    .add(b'%'); // 百分号

// Helper function to create AnyError from string
fn create_error(msg: impl Into<String>) -> AnyError {
    Box::new(std::io::Error::other(msg.into()))
}

pub struct IpcManager {
    client: IpcHttpClient,
}

impl IpcManager {
    fn new() -> Self {
        let ipc_path_buf = ipc_path().unwrap_or_else(|e| {
            logging!(error, Type::Ipc, true, "Failed to get IPC path: {}", e);
            std::path::PathBuf::from("/tmp/clash-verge-ipc") // fallback path
        });
        let ipc_path = ipc_path_buf.to_str().unwrap_or_default();
        let config = ClientConfig {
            default_timeout: Duration::from_secs(5),
            enable_pooling: false,
            max_retries: 4,
            retry_delay: Duration::from_millis(125),
            max_concurrent_requests: 16,
            max_requests_per_second: Some(64.0),
            ..Default::default()
        };
        #[allow(clippy::unwrap_used)]
        let client = IpcHttpClient::with_config(ipc_path, config).unwrap();
        Self { client }
    }
}

// Use singleton macro with logging
singleton_with_logging!(IpcManager, INSTANCE, "IpcManager");

impl IpcManager {
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> AnyResult<LegacyResponse> {
        self.client.request(method, path, body).await
    }
}

impl IpcManager {
    pub async fn send_request(
        &self,
        method: &str,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> AnyResult<serde_json::Value> {
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
            "PUT" | "DELETE" => {
                if response.status == 204 {
                    Ok(serde_json::json!({"code": 204}))
                } else {
                    match response.json() {
                        Ok(json) => Ok(json),
                        Err(_) => Ok(serde_json::json!({
                            "code": response.status,
                            "message": response.body,
                            "error": "failed to parse response as JSON"
                        })),
                    }
                }
            }
            _ => match response.json() {
                Ok(json) => Ok(json),
                Err(_) => Ok(serde_json::json!({
                    "code": response.status,
                    "message": response.body,
                    "error": "failed to parse response as JSON"
                })),
            },
        }
    }

    // 基础代理信息获取
    pub async fn get_proxies(&self) -> AnyResult<serde_json::Value> {
        let url = "/proxies";
        self.send_request("GET", url, None).await
    }

    // 代理提供者信息获取
    pub async fn get_providers_proxies(&self) -> AnyResult<serde_json::Value> {
        let url = "/providers/proxies";
        self.send_request("GET", url, None).await
    }

    // 连接管理
    pub async fn get_connections(&self) -> AnyResult<serde_json::Value> {
        let url = "/connections";
        self.send_request("GET", url, None).await
    }

    pub async fn delete_connection(&self, id: &str) -> AnyResult<()> {
        let encoded_id = utf8_percent_encode(id, URL_PATH_ENCODE_SET).to_string();
        let url = format!("/connections/{encoded_id}");
        let response = self.send_request("DELETE", &url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"].as_str().unwrap_or("unknown error"),
            ))
        }
    }

    pub async fn close_all_connections(&self) -> AnyResult<()> {
        let url = "/connections";
        let response = self.send_request("DELETE", url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_owned(),
            ))
        }
    }
}

impl IpcManager {
    #[allow(dead_code)]
    pub async fn is_mihomo_running(&self) -> AnyResult<()> {
        let url = "/version";
        let _response = self.send_request("GET", url, None).await?;
        Ok(())
    }

    pub async fn put_configs_force(&self, clash_config_path: &str) -> AnyResult<()> {
        let url = "/configs?force=true";
        let payload = serde_json::json!({
            "path": clash_config_path,
        });
        let _response = self.send_request("PUT", url, Some(&payload)).await?;
        Ok(())
    }

    pub async fn patch_configs(&self, config: serde_json::Value) -> AnyResult<()> {
        let url = "/configs";
        let response = self.send_request("PATCH", url, Some(&config)).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_owned(),
            ))
        }
    }

    pub async fn test_proxy_delay(
        &self,
        name: &str,
        test_url: Option<String>,
        timeout: i32,
    ) -> AnyResult<serde_json::Value> {
        let test_url =
            test_url.unwrap_or_else(|| "https://cp.cloudflare.com/generate_204".to_string());

        let encoded_name = utf8_percent_encode(name, URL_PATH_ENCODE_SET).to_string();
        // 测速URL不再编码，直接传递
        let url = format!("/proxies/{encoded_name}/delay?url={test_url}&timeout={timeout}");

        self.send_request("GET", &url, None).await
    }

    // 版本和配置相关
    pub async fn get_version(&self) -> AnyResult<serde_json::Value> {
        let url = "/version";
        self.send_request("GET", url, None).await
    }

    pub async fn get_config(&self) -> AnyResult<serde_json::Value> {
        let url = "/configs";
        self.send_request("GET", url, None).await
    }

    pub async fn update_geo_data(&self) -> AnyResult<()> {
        let url = "/configs/geo";
        let response = self.send_request("POST", url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }

    pub async fn upgrade_core(&self) -> AnyResult<()> {
        let url = "/upgrade";
        let response = self.send_request("POST", url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }

    // 规则相关
    pub async fn get_rules(&self) -> AnyResult<serde_json::Value> {
        let url = "/rules";
        self.send_request("GET", url, None).await
    }

    pub async fn get_rule_providers(&self) -> AnyResult<serde_json::Value> {
        let url = "/providers/rules";
        self.send_request("GET", url, None).await
    }

    pub async fn update_rule_provider(&self, name: &str) -> AnyResult<()> {
        let encoded_name = utf8_percent_encode(name, URL_PATH_ENCODE_SET).to_string();
        let url = format!("/providers/rules/{encoded_name}");
        let response = self.send_request("PUT", &url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }

    // 代理相关
    pub async fn update_proxy(&self, group: &str, proxy: &str) -> AnyResult<()> {
        // 使用 percent-encoding 进行正确的 URL 编码
        let encoded_group = utf8_percent_encode(group, URL_PATH_ENCODE_SET).to_string();
        let url = format!("/proxies/{encoded_group}");
        let payload = serde_json::json!({
            "name": proxy
        });

        match self.send_request("PUT", &url, Some(&payload)).await {
            Ok(_) => Ok(()),
            Err(e) => {
                logging!(
                    error,
                    crate::utils::logging::Type::Ipc,
                    true,
                    "IPC: updateProxy encountered error: {} (ignored, always returning true)",
                    e
                );
                Ok(())
            }
        }
    }

    pub async fn proxy_provider_health_check(&self, name: &str) -> AnyResult<()> {
        let encoded_name = utf8_percent_encode(name, URL_PATH_ENCODE_SET).to_string();
        let url = format!("/providers/proxies/{encoded_name}/healthcheck");
        let response = self.send_request("GET", &url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }

    pub async fn update_proxy_provider(&self, name: &str) -> AnyResult<()> {
        let encoded_name = utf8_percent_encode(name, URL_PATH_ENCODE_SET).to_string();
        let url = format!("/providers/proxies/{encoded_name}");
        let response = self.send_request("PUT", &url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }

    // 延迟测试相关
    pub async fn get_group_proxy_delays(
        &self,
        group_name: &str,
        url: Option<String>,
        timeout: i32,
    ) -> AnyResult<serde_json::Value> {
        let test_url = url.unwrap_or_else(|| "https://cp.cloudflare.com/generate_204".to_string());

        let encoded_group_name = utf8_percent_encode(group_name, URL_PATH_ENCODE_SET).to_string();
        // 测速URL不再编码，直接传递
        let url = format!("/group/{encoded_group_name}/delay?url={test_url}&timeout={timeout}");

        self.send_request("GET", &url, None).await
    }

    // 调试相关
    pub async fn is_debug_enabled(&self) -> AnyResult<bool> {
        let url = "/debug/pprof";
        match self.send_request("GET", url, None).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    pub async fn gc(&self) -> AnyResult<()> {
        let url = "/debug/gc";
        let response = self.send_request("PUT", url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(create_error(
                response["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            ))
        }
    }

    // 日志相关功能已迁移到 logs.rs 模块，使用流式处理
}
