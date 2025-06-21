#[cfg(target_os = "linux")]
use anyhow::anyhow;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AsyncAutoproxy {
    pub enable: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncSysproxy {
    pub enable: bool,
    pub host: String,
    pub port: u16,
    pub bypass: String,
}

impl Default for AsyncSysproxy {
    fn default() -> Self {
        Self {
            enable: false,
            host: "127.0.0.1".to_string(),
            port: 7890,
            bypass: String::new(),
        }
    }
}

pub struct AsyncProxyQuery;

impl AsyncProxyQuery {
    /// 异步获取自动代理配置（PAC）
    pub async fn get_auto_proxy() -> AsyncAutoproxy {
        match timeout(Duration::from_secs(3), Self::get_auto_proxy_impl()).await {
            Ok(Ok(proxy)) => {
                log::debug!(target: "app", "异步获取自动代理成功: enable={}, url={}", proxy.enable, proxy.url);
                proxy
            }
            Ok(Err(e)) => {
                log::warn!(target: "app", "异步获取自动代理失败: {}", e);
                AsyncAutoproxy::default()
            }
            Err(_) => {
                log::warn!(target: "app", "异步获取自动代理超时");
                AsyncAutoproxy::default()
            }
        }
    }

    /// 异步获取系统代理配置
    pub async fn get_system_proxy() -> AsyncSysproxy {
        match timeout(Duration::from_secs(3), Self::get_system_proxy_impl()).await {
            Ok(Ok(proxy)) => {
                log::debug!(target: "app", "异步获取系统代理成功: enable={}, {}:{}", proxy.enable, proxy.host, proxy.port);
                proxy
            }
            Ok(Err(e)) => {
                log::warn!(target: "app", "异步获取系统代理失败: {}", e);
                AsyncSysproxy::default()
            }
            Err(_) => {
                log::warn!(target: "app", "异步获取系统代理超时");
                AsyncSysproxy::default()
            }
        }
    }

    #[cfg(target_os = "windows")]
    async fn get_auto_proxy_impl() -> Result<AsyncAutoproxy> {
        // Windows: 使用 netsh winhttp show proxy 命令
        let output = Command::new("netsh")
            .args(["winhttp", "show", "proxy"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(AsyncAutoproxy::default());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        log::debug!(target: "app", "netsh output: {}", stdout);

        // 解析输出，查找 PAC 配置
        for line in stdout.lines() {
            let line = line.trim();
            if line.starts_with("代理自动配置脚本") || line.starts_with("Proxy auto-config script")
            {
                // 修复：正确解析包含冒号的URL
                // 格式: "代理自动配置脚本 : http://127.0.0.1:11233/commands/pac"
                // 或: "Proxy auto-config script : http://127.0.0.1:11233/commands/pac"
                if let Some(colon_pos) = line.find(" : ") {
                    let url = line[colon_pos + 3..].trim();
                    if !url.is_empty() && url != "(none)" && url != "无" {
                        log::debug!(target: "app", "解析到PAC URL: {}", url);
                        return Ok(AsyncAutoproxy {
                            enable: true,
                            url: url.to_string(),
                        });
                    }
                } else if let Some(colon_pos) = line.find(':') {
                    // 兼容其他可能的格式
                    let url = line[colon_pos + 1..].trim();
                    // 确保这不是URL中的协议部分
                    if url.starts_with("http") && !url.is_empty() && url != "(none)" && url != "无"
                    {
                        log::debug!(target: "app", "解析到PAC URL (fallback): {}", url);
                        return Ok(AsyncAutoproxy {
                            enable: true,
                            url: url.to_string(),
                        });
                    }
                }
            }
        }

        log::debug!(target: "app", "未找到有效的PAC配置");
        Ok(AsyncAutoproxy::default())
    }

    #[cfg(target_os = "macos")]
    async fn get_auto_proxy_impl() -> Result<AsyncAutoproxy> {
        // macOS: 使用 scutil --proxy 命令
        let output = Command::new("scutil").args(["--proxy"]).output().await?;

        if !output.status.success() {
            return Ok(AsyncAutoproxy::default());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        log::debug!(target: "app", "scutil output: {}", stdout);

        let mut pac_enabled = false;
        let mut pac_url = String::new();

        // 解析 scutil 输出
        for line in stdout.lines() {
            let line = line.trim();
            if line.contains("ProxyAutoConfigEnable") && line.contains("1") {
                pac_enabled = true;
            } else if line.contains("ProxyAutoConfigURLString") {
                // 修复：正确解析包含冒号的URL
                // 格式: "ProxyAutoConfigURLString : http://127.0.0.1:11233/commands/pac"
                if let Some(colon_pos) = line.find(" : ") {
                    pac_url = line[colon_pos + 3..].trim().to_string();
                }
            }
        }

        log::debug!(target: "app", "解析结果: pac_enabled={}, pac_url={}", pac_enabled, pac_url);

        Ok(AsyncAutoproxy {
            enable: pac_enabled && !pac_url.is_empty(),
            url: pac_url,
        })
    }

    #[cfg(target_os = "linux")]
    async fn get_auto_proxy_impl() -> Result<AsyncAutoproxy> {
        // Linux: 检查环境变量和GNOME设置

        // 首先检查环境变量
        if let Ok(auto_proxy) = std::env::var("auto_proxy") {
            if !auto_proxy.is_empty() {
                return Ok(AsyncAutoproxy {
                    enable: true,
                    url: auto_proxy,
                });
            }
        }

        // 尝试使用 gsettings 获取 GNOME 代理设置
        let output = Command::new("gsettings")
            .args(["get", "org.gnome.system.proxy", "mode"])
            .output()
            .await;

        if let Ok(output) = output {
            if output.status.success() {
                let mode = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if mode.contains("auto") {
                    // 获取 PAC URL
                    let pac_output = Command::new("gsettings")
                        .args(["get", "org.gnome.system.proxy", "autoconfig-url"])
                        .output()
                        .await;

                    if let Ok(pac_output) = pac_output {
                        if pac_output.status.success() {
                            let pac_url = String::from_utf8_lossy(&pac_output.stdout)
                                .trim()
                                .trim_matches('\'')
                                .trim_matches('"')
                                .to_string();

                            if !pac_url.is_empty() {
                                return Ok(AsyncAutoproxy {
                                    enable: true,
                                    url: pac_url,
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(AsyncAutoproxy::default())
    }

    #[cfg(target_os = "windows")]
    async fn get_system_proxy_impl() -> Result<AsyncSysproxy> {
        let output = Command::new("netsh")
            .args(["winhttp", "show", "proxy"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(AsyncSysproxy::default());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        log::debug!(target: "app", "netsh proxy output: {}", stdout);

        let mut proxy_enabled = false;
        let mut proxy_server = String::new();
        let mut bypass_list = String::new();

        for line in stdout.lines() {
            let line = line.trim();
            if line.starts_with("代理服务器") || line.starts_with("Proxy Server") {
                if let Some(server_part) = line.split(':').nth(1) {
                    let server = server_part.trim();
                    if !server.is_empty() && server != "(none)" && server != "无" {
                        proxy_server = server.to_string();
                        proxy_enabled = true;
                    }
                }
            } else if line.starts_with("绕过列表") || line.starts_with("Bypass List") {
                if let Some(bypass_part) = line.split(':').nth(1) {
                    bypass_list = bypass_part.trim().to_string();
                }
            }
        }

        if proxy_enabled && !proxy_server.is_empty() {
            // 解析服务器地址和端口
            let (host, port) = if let Some(colon_pos) = proxy_server.rfind(':') {
                let host = proxy_server[..colon_pos].to_string();
                let port = proxy_server[colon_pos + 1..].parse::<u16>().unwrap_or(8080);
                (host, port)
            } else {
                (proxy_server, 8080)
            };

            Ok(AsyncSysproxy {
                enable: true,
                host,
                port,
                bypass: bypass_list,
            })
        } else {
            Ok(AsyncSysproxy::default())
        }
    }

    #[cfg(target_os = "macos")]
    async fn get_system_proxy_impl() -> Result<AsyncSysproxy> {
        let output = Command::new("scutil").args(["--proxy"]).output().await?;

        if !output.status.success() {
            return Ok(AsyncSysproxy::default());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        log::debug!(target: "app", "scutil proxy output: {}", stdout);

        let mut http_enabled = false;
        let mut http_host = String::new();
        let mut http_port = 8080u16;
        let mut exceptions = Vec::new();

        for line in stdout.lines() {
            let line = line.trim();
            if line.contains("HTTPEnable") && line.contains("1") {
                http_enabled = true;
            } else if line.contains("HTTPProxy") && !line.contains("Port") {
                if let Some(host_part) = line.split(':').nth(1) {
                    http_host = host_part.trim().to_string();
                }
            } else if line.contains("HTTPPort") {
                if let Some(port_part) = line.split(':').nth(1) {
                    if let Ok(port) = port_part.trim().parse::<u16>() {
                        http_port = port;
                    }
                }
            } else if line.contains("ExceptionsList") {
                // 解析异常列表
                if let Some(list_part) = line.split(':').nth(1) {
                    let list = list_part.trim();
                    if !list.is_empty() {
                        exceptions.push(list.to_string());
                    }
                }
            }
        }

        Ok(AsyncSysproxy {
            enable: http_enabled && !http_host.is_empty(),
            host: http_host,
            port: http_port,
            bypass: exceptions.join(","),
        })
    }

    #[cfg(target_os = "linux")]
    async fn get_system_proxy_impl() -> Result<AsyncSysproxy> {
        // Linux: 检查环境变量和桌面环境设置

        // 首先检查环境变量
        if let Ok(http_proxy) = std::env::var("http_proxy") {
            if let Ok(proxy_info) = Self::parse_proxy_url(&http_proxy) {
                return Ok(proxy_info);
            }
        }

        if let Ok(https_proxy) = std::env::var("https_proxy") {
            if let Ok(proxy_info) = Self::parse_proxy_url(&https_proxy) {
                return Ok(proxy_info);
            }
        }

        // 尝试使用 gsettings 获取 GNOME 代理设置
        let mode_output = Command::new("gsettings")
            .args(["get", "org.gnome.system.proxy", "mode"])
            .output()
            .await;

        if let Ok(mode_output) = mode_output {
            if mode_output.status.success() {
                let mode = String::from_utf8_lossy(&mode_output.stdout)
                    .trim()
                    .to_string();
                if mode.contains("manual") {
                    // 获取HTTP代理设置
                    let host_result = Command::new("gsettings")
                        .args(["get", "org.gnome.system.proxy.http", "host"])
                        .output()
                        .await;

                    let port_result = Command::new("gsettings")
                        .args(["get", "org.gnome.system.proxy.http", "port"])
                        .output()
                        .await;

                    if let (Ok(host_output), Ok(port_output)) = (host_result, port_result) {
                        if host_output.status.success() && port_output.status.success() {
                            let host = String::from_utf8_lossy(&host_output.stdout)
                                .trim()
                                .trim_matches('\'')
                                .trim_matches('"')
                                .to_string();

                            let port = String::from_utf8_lossy(&port_output.stdout)
                                .trim()
                                .parse::<u16>()
                                .unwrap_or(8080);

                            if !host.is_empty() {
                                return Ok(AsyncSysproxy {
                                    enable: true,
                                    host,
                                    port,
                                    bypass: String::new(),
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(AsyncSysproxy::default())
    }

    #[cfg(target_os = "linux")]
    fn parse_proxy_url(proxy_url: &str) -> Result<AsyncSysproxy> {
        // 解析形如 "http://proxy.example.com:8080" 的URL
        let url = proxy_url.trim();

        // 移除协议前缀
        let url = if let Some(stripped) = url.strip_prefix("http://") {
            stripped
        } else if let Some(stripped) = url.strip_prefix("https://") {
            stripped
        } else {
            url
        };

        // 解析主机和端口
        let (host, port) = if let Some(colon_pos) = url.rfind(':') {
            let host = url[..colon_pos].to_string();
            let port = url[colon_pos + 1..].parse::<u16>().unwrap_or(8080);
            (host, port)
        } else {
            (url.to_string(), 8080)
        };

        if host.is_empty() {
            return Err(anyhow!("无效的代理URL"));
        }

        Ok(AsyncSysproxy {
            enable: true,
            host,
            port,
            bypass: std::env::var("no_proxy").unwrap_or_default(),
        })
    }
}
