#[cfg(target_os = "windows")]
use crate::process::AsyncHandler;
use crate::{logging, utils::logging::Type};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::time::{Duration, timeout};

#[cfg(target_os = "linux")]
use anyhow::anyhow;
#[cfg(not(target_os = "windows"))]
use tokio::process::Command;

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
            host: "127.0.0.1".into(),
            port: 7897,
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
                logging!(
                    debug,
                    Type::Network,
                    "异步获取自动代理成功: enable={}, url={}",
                    proxy.enable,
                    proxy.url
                );
                proxy
            }
            Ok(Err(e)) => {
                logging!(warn, Type::Network, "Warning: 异步获取自动代理失败: {e}");
                AsyncAutoproxy::default()
            }
            Err(_) => {
                logging!(warn, Type::Network, "Warning: 异步获取自动代理超时");
                AsyncAutoproxy::default()
            }
        }
    }

    /// 异步获取系统代理配置
    pub async fn get_system_proxy() -> AsyncSysproxy {
        match timeout(Duration::from_secs(3), Self::get_system_proxy_impl()).await {
            Ok(Ok(proxy)) => {
                logging!(
                    debug,
                    Type::Network,
                    "异步获取系统代理成功: enable={}, {}:{}",
                    proxy.enable,
                    proxy.host,
                    proxy.port
                );
                proxy
            }
            Ok(Err(e)) => {
                logging!(warn, Type::Network, "Warning: 异步获取系统代理失败: {e}");
                AsyncSysproxy::default()
            }
            Err(_) => {
                logging!(warn, Type::Network, "Warning: 异步获取系统代理超时");
                AsyncSysproxy::default()
            }
        }
    }

    #[cfg(target_os = "windows")]
    async fn get_auto_proxy_impl() -> Result<AsyncAutoproxy> {
        // Windows: 从注册表读取PAC配置
        AsyncHandler::spawn_blocking(move || -> Result<AsyncAutoproxy> {
            Self::get_pac_config_from_registry()
        })
        .await?
    }

    #[cfg(target_os = "windows")]
    fn get_pac_config_from_registry() -> Result<AsyncAutoproxy> {
        use std::ptr;
        use winapi::shared::minwindef::{DWORD, HKEY};
        use winapi::um::winnt::{KEY_READ, REG_DWORD, REG_SZ};
        use winapi::um::winreg::{HKEY_CURRENT_USER, RegCloseKey, RegOpenKeyExW, RegQueryValueExW};

        unsafe {
            let key_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\0"
                .encode_utf16()
                .collect::<Vec<u16>>();

            let mut hkey: HKEY = ptr::null_mut();
            let result =
                RegOpenKeyExW(HKEY_CURRENT_USER, key_path.as_ptr(), 0, KEY_READ, &mut hkey);

            if result != 0 {
                logging!(debug, Type::Network, "无法打开注册表项");
                return Ok(AsyncAutoproxy::default());
            }

            // 1. 检查自动配置是否启用 (AutoConfigURL 存在且不为空即表示启用)
            let auto_config_url_name = "AutoConfigURL\0".encode_utf16().collect::<Vec<u16>>();
            let mut url_buffer = vec![0u16; 1024];
            let mut url_buffer_size: DWORD = (url_buffer.len() * 2) as DWORD;
            let mut url_value_type: DWORD = 0;

            let url_query_result = RegQueryValueExW(
                hkey,
                auto_config_url_name.as_ptr(),
                ptr::null_mut(),
                &mut url_value_type,
                url_buffer.as_mut_ptr() as *mut u8,
                &mut url_buffer_size,
            );

            let mut pac_url = String::new();
            if url_query_result == 0 && url_value_type == REG_SZ && url_buffer_size > 0 {
                let end_pos = url_buffer
                    .iter()
                    .position(|&x| x == 0)
                    .unwrap_or(url_buffer.len());
                pac_url = String::from_utf16_lossy(&url_buffer[..end_pos]);
                logging!(debug, Type::Network, "从注册表读取到PAC URL: {pac_url}");
            }

            // 2. 检查自动检测设置是否启用
            let auto_detect_name = "AutoDetect\0".encode_utf16().collect::<Vec<u16>>();
            let mut auto_detect: DWORD = 0;
            let mut detect_buffer_size: DWORD = 4;
            let mut detect_value_type: DWORD = 0;

            let detect_query_result = RegQueryValueExW(
                hkey,
                auto_detect_name.as_ptr(),
                ptr::null_mut(),
                &mut detect_value_type,
                &mut auto_detect as *mut DWORD as *mut u8,
                &mut detect_buffer_size,
            );

            RegCloseKey(hkey);

            // PAC 启用的条件：AutoConfigURL 不为空，或 AutoDetect 被启用
            let pac_enabled = !pac_url.is_empty()
                || (detect_query_result == 0 && detect_value_type == REG_DWORD && auto_detect != 0);

            if pac_enabled {
                logging!(
                    debug,
                    Type::Network,
                    "PAC配置启用: URL={pac_url}, AutoDetect={auto_detect}"
                );

                if pac_url.is_empty() && auto_detect != 0 {
                    pac_url = "auto-detect".into();
                }

                Ok(AsyncAutoproxy {
                    enable: true,
                    url: pac_url,
                })
            } else {
                logging!(debug, Type::Network, "PAC配置未启用");
                Ok(AsyncAutoproxy::default())
            }
        }
    }

    #[cfg(target_os = "macos")]
    async fn get_auto_proxy_impl() -> Result<AsyncAutoproxy> {
        // macOS: 使用 scutil --proxy 命令
        let output = Command::new("scutil").args(["--proxy"]).output().await?;

        if !output.status.success() {
            return Ok(AsyncAutoproxy::default());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        crate::logging!(
            debug,
            crate::utils::logging::Type::Network,
            "scutil output: {stdout}"
        );

        let mut pac_enabled = false;
        let mut pac_url = String::new();

        // 解析 scutil 输出
        for line in stdout.lines() {
            let line = line.trim();
            if line.contains("ProxyAutoConfigEnable") && line.contains("1") {
                pac_enabled = true;
            } else if line.contains("ProxyAutoConfigURLString") {
                // 正确解析包含冒号的URL
                // 格式: "ProxyAutoConfigURLString : http://127.0.0.1:11233/commands/pac"
                if let Some(colon_pos) = line.find(" : ") {
                    pac_url = line[colon_pos + 3..].trim().into();
                }
            }
        }

        crate::logging!(
            debug,
            crate::utils::logging::Type::Network,
            "解析结果: pac_enabled={pac_enabled}, pac_url={pac_url}"
        );

        Ok(AsyncAutoproxy {
            enable: pac_enabled && !pac_url.is_empty(),
            url: pac_url,
        })
    }

    #[cfg(target_os = "linux")]
    async fn get_auto_proxy_impl() -> Result<AsyncAutoproxy> {
        // Linux: 检查环境变量和GNOME设置

        // 首先检查环境变量
        if let Ok(auto_proxy) = std::env::var("auto_proxy")
            && !auto_proxy.is_empty()
        {
            return Ok(AsyncAutoproxy {
                enable: true,
                url: auto_proxy,
            });
        }

        // 尝试使用 gsettings 获取 GNOME 代理设置
        let output = Command::new("gsettings")
            .args(["get", "org.gnome.system.proxy", "mode"])
            .output()
            .await;

        if let Ok(output) = output
            && output.status.success()
        {
            let mode: String = String::from_utf8_lossy(&output.stdout).trim().into();
            if mode.contains("auto") {
                // 获取 PAC URL
                let pac_output = Command::new("gsettings")
                    .args(["get", "org.gnome.system.proxy", "autoconfig-url"])
                    .output()
                    .await;

                if let Ok(pac_output) = pac_output
                    && pac_output.status.success()
                {
                    let pac_url: String = String::from_utf8_lossy(&pac_output.stdout)
                        .trim()
                        .trim_matches('\'')
                        .trim_matches('"')
                        .into();

                    if !pac_url.is_empty() {
                        return Ok(AsyncAutoproxy {
                            enable: true,
                            url: pac_url,
                        });
                    }
                }
            }
        }

        Ok(AsyncAutoproxy::default())
    }

    #[cfg(target_os = "windows")]
    async fn get_system_proxy_impl() -> Result<AsyncSysproxy> {
        // Windows: 使用注册表直接读取代理设置
        AsyncHandler::spawn_blocking(move || -> Result<AsyncSysproxy> {
            Self::get_system_proxy_from_registry()
        })
        .await?
    }

    #[cfg(target_os = "windows")]
    fn get_system_proxy_from_registry() -> Result<AsyncSysproxy> {
        use std::ptr;
        use winapi::shared::minwindef::{DWORD, HKEY};
        use winapi::um::winnt::{KEY_READ, REG_DWORD, REG_SZ};
        use winapi::um::winreg::{HKEY_CURRENT_USER, RegCloseKey, RegOpenKeyExW, RegQueryValueExW};

        unsafe {
            let key_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\0"
                .encode_utf16()
                .collect::<Vec<u16>>();

            let mut hkey: HKEY = ptr::null_mut();
            let result =
                RegOpenKeyExW(HKEY_CURRENT_USER, key_path.as_ptr(), 0, KEY_READ, &mut hkey);

            if result != 0 {
                return Ok(AsyncSysproxy::default());
            }

            // 检查代理是否启用
            let proxy_enable_name = "ProxyEnable\0".encode_utf16().collect::<Vec<u16>>();
            let mut proxy_enable: DWORD = 0;
            let mut buffer_size: DWORD = 4;
            let mut value_type: DWORD = 0;

            let enable_result = RegQueryValueExW(
                hkey,
                proxy_enable_name.as_ptr(),
                ptr::null_mut(),
                &mut value_type,
                &mut proxy_enable as *mut DWORD as *mut u8,
                &mut buffer_size,
            );

            if enable_result != 0 || value_type != REG_DWORD || proxy_enable == 0 {
                RegCloseKey(hkey);
                return Ok(AsyncSysproxy::default());
            }

            // 读取代理服务器设置
            let proxy_server_name = "ProxyServer\0".encode_utf16().collect::<Vec<u16>>();
            let mut buffer = vec![0u16; 1024];
            let mut buffer_size: DWORD = (buffer.len() * 2) as DWORD;
            let mut value_type: DWORD = 0;

            let server_result = RegQueryValueExW(
                hkey,
                proxy_server_name.as_ptr(),
                ptr::null_mut(),
                &mut value_type,
                buffer.as_mut_ptr() as *mut u8,
                &mut buffer_size,
            );

            let proxy_server = if server_result == 0 && value_type == REG_SZ && buffer_size > 0 {
                let end_pos = buffer.iter().position(|&x| x == 0).unwrap_or(buffer.len());
                String::from_utf16_lossy(&buffer[..end_pos])
            } else {
                String::new()
            };

            // 读取代理绕过列表
            let proxy_override_name = "ProxyOverride\0".encode_utf16().collect::<Vec<u16>>();
            let mut bypass_buffer = vec![0u16; 1024];
            let mut bypass_buffer_size: DWORD = (bypass_buffer.len() * 2) as DWORD;
            let mut bypass_value_type: DWORD = 0;

            let override_result = RegQueryValueExW(
                hkey,
                proxy_override_name.as_ptr(),
                ptr::null_mut(),
                &mut bypass_value_type,
                bypass_buffer.as_mut_ptr() as *mut u8,
                &mut bypass_buffer_size,
            );

            let bypass_list =
                if override_result == 0 && bypass_value_type == REG_SZ && bypass_buffer_size > 0 {
                    let end_pos = bypass_buffer
                        .iter()
                        .position(|&x| x == 0)
                        .unwrap_or(bypass_buffer.len());
                    String::from_utf16_lossy(&bypass_buffer[..end_pos])
                } else {
                    String::new()
                };

            RegCloseKey(hkey);

            if !proxy_server.is_empty() {
                // 解析服务器地址和端口
                let (host, port) = if let Some(colon_pos) = proxy_server.rfind(':') {
                    let host = proxy_server[..colon_pos].into();
                    let port = proxy_server[colon_pos + 1..].parse::<u16>().unwrap_or(8080);
                    (host, port)
                } else {
                    (proxy_server, 8080)
                };

                logging!(
                    debug,
                    Type::Network,
                    "从注册表读取到代理设置: {host}:{port}, bypass: {bypass_list}"
                );

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
    }

    #[cfg(target_os = "macos")]
    async fn get_system_proxy_impl() -> Result<AsyncSysproxy> {
        let output = Command::new("scutil").args(["--proxy"]).output().await?;

        if !output.status.success() {
            return Ok(AsyncSysproxy::default());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        logging!(debug, Type::Network, "scutil proxy output: {stdout}");

        let mut http_enabled = false;
        let mut http_host = String::new();
        let mut http_port = 8080u16;
        let mut exceptions: Vec<String> = Vec::new();

        for line in stdout.lines() {
            let line = line.trim();
            if line.contains("HTTPEnable") && line.contains("1") {
                http_enabled = true;
            } else if line.contains("HTTPProxy") && !line.contains("Port") {
                if let Some(host_part) = line.split(':').nth(1) {
                    http_host = host_part.trim().into();
                }
            } else if line.contains("HTTPPort") {
                if let Some(port_part) = line.split(':').nth(1)
                    && let Ok(port) = port_part.trim().parse::<u16>()
                {
                    http_port = port;
                }
            } else if line.contains("ExceptionsList") {
                // 解析异常列表
                if let Some(list_part) = line.split(':').nth(1) {
                    let list = list_part.trim();
                    if !list.is_empty() {
                        exceptions.push(list.into());
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
        if let Ok(http_proxy) = std::env::var("http_proxy")
            && let Ok(proxy_info) = Self::parse_proxy_url(&http_proxy)
        {
            return Ok(proxy_info);
        }

        if let Ok(https_proxy) = std::env::var("https_proxy")
            && let Ok(proxy_info) = Self::parse_proxy_url(&https_proxy)
        {
            return Ok(proxy_info);
        }

        // 尝试使用 gsettings 获取 GNOME 代理设置
        let mode_output = Command::new("gsettings")
            .args(["get", "org.gnome.system.proxy", "mode"])
            .output()
            .await;

        if let Ok(mode_output) = mode_output
            && mode_output.status.success()
        {
            let mode: String = String::from_utf8_lossy(&mode_output.stdout).trim().into();
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

                if let (Ok(host_output), Ok(port_output)) = (host_result, port_result)
                    && host_output.status.success()
                    && port_output.status.success()
                {
                    let host: String = String::from_utf8_lossy(&host_output.stdout)
                        .trim()
                        .trim_matches('\'')
                        .trim_matches('"')
                        .into();

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
            let host: String = url[..colon_pos].into();
            let port = url[colon_pos + 1..].parse::<u16>().unwrap_or(8080);
            (host, port)
        } else {
            (url.into(), 8080)
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
