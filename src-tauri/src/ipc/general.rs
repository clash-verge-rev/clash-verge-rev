use kode_bridge::{
    errors::{AnyError, AnyResult},
    ipc_http_client::HttpResponse,
    IpcHttpClient,
};
use std::sync::OnceLock;

use crate::{
    logging,
    utils::{dirs::ipc_path, logging::Type},
};

// Helper function to create AnyError from string
fn create_error(msg: impl Into<String>) -> AnyError {
    Box::new(std::io::Error::other(msg.into()))
}

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
            logging!(
                info,
                Type::Ipc,
                true,
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
    ) -> AnyResult<HttpResponse> {
        let client = IpcHttpClient::new(&self.ipc_path)?;
        if let Some(body) = body {
            client.request(method, path).json(body).send().await
        } else {
            client.request(method, path).send().await
        }
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
                if response.status() == 204 {
                    Ok(serde_json::json!({"code": 204}))
                } else {
                    Ok(response.json()?)
                }
            }
            "PUT" => {
                if response.status() == 204 {
                    Ok(serde_json::json!({"code": 204}))
                } else {
                    // 尝试解析JSON，如果失败则返回错误信息
                    match response.json() {
                        Ok(json) => Ok(json),
                        Err(_) => Ok(serde_json::json!({
                            "code": response.status(),
                            "message": response.text(),
                            "error": "failed to parse response as JSON"
                        })),
                    }
                }
            }
            _ => Ok(response.json()?),
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
        let url = format!("/connections/{id}");
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
        let url = format!("/proxies/{name}/delay?url={test_url}&timeout={timeout}");
        let response = self.send_request("GET", &url, None).await?;
        Ok(response)
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
        let url = format!("/providers/rules/{name}");
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
        let url = format!("/proxies/{group}");
        let payload = serde_json::json!({
            "name": proxy
        });

        let response = self.send_request("PUT", &url, Some(&payload)).await?;

        if response["code"] == 204 {
            Ok(())
        } else {
            let error_msg = response["message"].as_str().unwrap_or_else(|| {
                if let Some(error) = response.get("error") {
                    error.as_str().unwrap_or("unknown error")
                } else {
                    "failed to update proxy"
                }
            });

            Err(create_error(error_msg.to_string()))
        }
    }

    pub async fn proxy_provider_health_check(&self, name: &str) -> AnyResult<()> {
        let url = format!("/providers/proxies/{name}/healthcheck");
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
        let url = format!("/providers/proxies/{name}");
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
        let url = format!("/group/{group_name}/delay?url={test_url}&timeout={timeout}");
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

    // 流量数据相关
    pub async fn get_traffic(&self) -> AnyResult<serde_json::Value> {
        let url = "/traffic";
        logging!(info, Type::Ipc, true, "IPC: 发送 GET 请求到 {}", url);
        let result = self.send_request("GET", url, None).await;
        logging!(
            info,
            Type::Ipc,
            true,
            "IPC: /traffic 请求结果: {:?}",
            result
        );
        result
    }

    pub async fn get_memory(&self) -> AnyResult<serde_json::Value> {
        let url = "/memory";
        logging!(info, Type::Ipc, true, "IPC: 发送 GET 请求到 {}", url);
        let result = self.send_request("GET", url, None).await;
        logging!(info, Type::Ipc, true, "IPC: /memory 请求结果: {:?}", result);
        result
    }
}
