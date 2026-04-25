use super::CmdResult;
use crate::cmd::StringifyErr as _;
use crate::core::sysopt::Sysopt;
use clash_verge_logging::{Type, logging};
use gethostname::gethostname;
use network_interface::NetworkInterface;
use serde_yaml_ng::Mapping;
use std::net::TcpListener;
use sysproxy::{Autoproxy, Sysproxy};
use tauri_plugin_clash_verge_sysinfo;

/// get the system proxy
#[tauri::command]
pub async fn get_sys_proxy() -> CmdResult<Mapping> {
    logging!(debug, Type::Network, "异步获取系统代理配置");

    Sysopt::global().wait_idle().await;
    let sys_proxy = Sysproxy::get_system_proxy().stringify_err()?;
    let Sysproxy {
        ref host,
        ref bypass,
        ref port,
        ref enable,
    } = sys_proxy;

    let mut map = Mapping::new();
    map.insert("enable".into(), (*enable).into());
    map.insert("server".into(), format!("{}:{}", host, port).into());
    map.insert("bypass".into(), bypass.as_str().into());

    logging!(
        debug,
        Type::Network,
        "返回系统代理配置: enable={}, {}:{}",
        sys_proxy.enable,
        sys_proxy.host,
        sys_proxy.port
    );
    Ok(map)
}

/// 获取自动代理配置
#[tauri::command]
pub async fn get_auto_proxy() -> CmdResult<Mapping> {
    Sysopt::global().wait_idle().await;
    let auto_proxy = Autoproxy::get_auto_proxy().stringify_err()?;
    let Autoproxy { ref enable, ref url } = auto_proxy;

    let mut map = Mapping::new();
    map.insert("enable".into(), (*enable).into());
    map.insert("url".into(), url.as_str().into());

    logging!(
        debug,
        Type::Network,
        "返回自动代理配置（缓存）: enable={}, url={}",
        auto_proxy.enable,
        auto_proxy.url
    );
    Ok(map)
}

/// 获取系统主机名
#[tauri::command]
pub fn get_system_hostname() -> String {
    // 获取系统主机名，处理可能的非UTF-8字符
    match gethostname().into_string() {
        Ok(name) => name,
        Err(os_string) => {
            // 对于包含非UTF-8的主机名，使用调试格式化
            let fallback = format!("{os_string:?}");
            // 去掉可能存在的引号
            fallback.trim_matches('"').to_string()
        }
    }
}

/// 获取网络接口列表
#[tauri::command]
pub fn get_network_interfaces() -> Vec<String> {
    tauri_plugin_clash_verge_sysinfo::list_network_interfaces()
}

/// 获取网络接口详细信息
#[tauri::command]
pub fn get_network_interfaces_info() -> CmdResult<Vec<NetworkInterface>> {
    use network_interface::{NetworkInterface, NetworkInterfaceConfig as _};

    let names = get_network_interfaces();
    let interfaces = NetworkInterface::show().stringify_err()?;

    let mut result = Vec::new();

    for interface in interfaces {
        if names.contains(&interface.name) {
            result.push(interface);
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn is_port_in_use(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// 前端查询的 Wi-Fi 识别开关 + 授权状态快照。
/// - `enabled`：当前 toggle 值（netmon atomic 的 load）
/// - `needs_authorization`：是否是需要操作系统授权的平台（仅 macOS=true）
/// - `auth_status`：仅 macOS 有意义；`"notDetermined"|"authorized"|"denied"|"restricted"`；
///   其他平台固定 `"notApplicable"`
/// - `location_services_enabled`：仅 macOS 有意义；全局位置服务开关；其他平台固定 true
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiDetectionStatus {
    pub enabled: bool,
    pub needs_authorization: bool,
    pub auth_status: &'static str,
    pub location_services_enabled: bool,
}

/// 读取 Wi-Fi 识别状态快照（UI 副标题渲染用）。
///
/// macOS 下 `CLLocationManager.authorizationStatus`（实例方法）未明确线程安全，
/// 通过 `AppHandle::run_on_main_thread` 派发到主线程查询。
/// `locationServicesEnabled_class`（Apple 文档提示可能阻塞磁盘 IO）**不**挂在
/// 主线程派发里，改在命令侧的 tokio runtime 查询，避免 UI 卡顿。
#[tauri::command]
pub async fn get_wifi_detection_status(app: tauri::AppHandle) -> WifiDetectionStatus {
    #[cfg(target_os = "macos")]
    {
        return macos_wifi::status(&app).await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        WifiDetectionStatus {
            enabled: crate::module::netmon::wifi_detection_enabled(),
            needs_authorization: false,
            auth_status: "notApplicable",
            location_services_enabled: true,
        }
    }
}

/// 请求 Wi-Fi 识别所需的授权；仅 macOS 触发 CoreLocation 弹窗。非 macOS 直接 no-op。
/// 命令立即返回当前状态快照；授权是异步的，授权变化由 delegate 回调 emit
/// `verge://wifi-auth-changed` 事件驱动前端刷新。
///
/// Tauri 的 `#[tauri::command]` 默认在 tokio blocking 池执行，不是主线程；
/// 但 CoreLocation 的 `requestWhenInUseAuthorization` / 实例 `authorizationStatus`
/// 要求主线程。`AppHandle::run_on_main_thread` 派发主线程完成授权请求与状态查询；
/// `services_enabled`（类方法，可能阻塞磁盘 IO）不进主线程。
#[tauri::command]
pub async fn request_wifi_detection_auth(app: tauri::AppHandle) -> WifiDetectionStatus {
    #[cfg(target_os = "macos")]
    {
        macos_wifi::request_then_status(&app).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        get_wifi_detection_status(app).await
    }
}

#[cfg(target_os = "macos")]
mod macos_wifi {
    use std::time::Duration;

    use tauri::AppHandle;

    use super::WifiDetectionStatus;
    use crate::module::netmon::wifi_auth;

    /// 主线程派发超时。派发失败或超时（主线程被其它长任务阻塞）时，前端 Promise
    /// 不应无限挂起；超时后走兜底 `"notDetermined"`。
    const MAIN_THREAD_DISPATCH_TIMEOUT: Duration = Duration::from_secs(3);

    pub async fn status(app: &AppHandle) -> WifiDetectionStatus {
        let auth_status = dispatch_main_thread(app, wifi_auth::current_status_str).await;
        // services_enabled 不进主线程闭包——类方法，可能阻塞磁盘 IO；
        // 当前频率由前端 invalidate 决定，如未来成热点再加缓存/spawn_blocking
        let location_services_enabled = wifi_auth::services_enabled();
        build_status(auth_status, location_services_enabled)
    }

    pub async fn request_then_status(app: &AppHandle) -> WifiDetectionStatus {
        let auth_status = dispatch_main_thread(app, || {
            wifi_auth::request_authorization();
            wifi_auth::current_status_str()
        })
        .await;
        let location_services_enabled = wifi_auth::services_enabled();
        build_status(auth_status, location_services_enabled)
    }

    fn build_status(auth_status: Option<&'static str>, location_services_enabled: bool) -> WifiDetectionStatus {
        WifiDetectionStatus {
            enabled: crate::module::netmon::wifi_detection_enabled(),
            needs_authorization: true,
            auth_status: auth_status.unwrap_or("notDetermined"),
            location_services_enabled,
        }
    }

    /// 把同步闭包派发到主线程执行，带超时。派发失败或超时返回 `None`。
    async fn dispatch_main_thread<F>(app: &AppHandle, f: F) -> Option<&'static str>
    where
        F: FnOnce() -> &'static str + Send + 'static,
    {
        let (tx, rx) = tokio::sync::oneshot::channel::<&'static str>();
        if app
            .run_on_main_thread(move || {
                let _ = tx.send(f());
            })
            .is_err()
        {
            return None;
        }
        tokio::time::timeout(MAIN_THREAD_DISPATCH_TIMEOUT, rx).await.ok()?.ok()
    }
}

/// 打开系统设置的位置服务面板；仅 macOS 实现，其他平台 no-op。
///
/// 返回 `Result<(), String>` 而非 `()`，覆盖两类失败：
/// 1. `open` 子进程**无法运行**（`open` 二进制缺失、沙盒拒绝 fork/exec、
///    wait/reap 过程失败等）—— `output()` 本身返回 `Err`
/// 2. `open` **成功启动但以非零退出码结束**（URL scheme 无人处理、deep link
///    目标不存在等 Launch Services 层面的失败）—— `output().status.success()
///    == false`，本函数把退出码与 stderr 组合成错误字符串
///
/// 这两种都透传到前端，`openLocationSettings().catch(showNotice.error)` 才能
/// 真正对用户可见。改用 `output()` 而非 `spawn()` 的理由：`spawn()` 只捕获
/// 第 1 类的创建阶段失败，第 2 类会被前端 Promise resolve，用户点链接没反应
/// 时毫无线索。`output()` 顺带通过内部 `wait` 回收子进程，避免 zombie。
///
/// `open` 命令本身是 fire-and-forget 语义——它 fork 目标 app 后立即退出，
/// `output()` 等待的是 `open` 本身而非目标 app，实际阻塞通常在毫秒级。
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn open_location_settings() -> Result<(), String> {
    use std::process::{Command, Stdio};
    let output = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("run `open` failed: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let code = output
        .status
        .code()
        .map_or_else(|| "signal".to_string(), |c| c.to_string());
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    if stderr.is_empty() {
        Err(format!("`open` exited with code {code}"))
    } else {
        Err(format!("`open` exited with code {code}: {stderr}"))
    }
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
// 非 macOS 平台不需要打开位置设置面板（没有 CoreLocation 概念），但返回
// `Result<(), String>` 与 macOS 保持一致：前端 `openLocationSettings()` 的
// `invoke<void>` 绑定对两个平台走同一条 `.catch(showNotice.error)` 路径。
// 拆成 `() -> ()` 会让前端 TypeScript 绑定也需要平台条件，得不偿失。
#[expect(clippy::unnecessary_wraps, reason = "cross-platform type parity")]
pub const fn open_location_settings() -> Result<(), String> {
    Ok(())
}
