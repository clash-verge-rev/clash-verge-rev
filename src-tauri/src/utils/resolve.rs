#[cfg(target_os = "macos")]
use crate::AppHandleManager;
use crate::{
    config::{Config, IVerge, PrfItem},
    core::*,
    logging, logging_error,
    module::lightweight,
    process::AsyncHandler,
    utils::{dirs, error, init, logging::Type, server},
    wrap_err,
};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use serde_json;
use serde_yaml::Mapping;
use std::{
    net::TcpListener,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{App, Emitter, Manager};

use tauri::Url;
//#[cfg(not(target_os = "linux"))]
// use window_shadows::set_shadow;

pub static VERSION: OnceCell<String> = OnceCell::new();

// 窗口状态文件中的尺寸
static STATE_WIDTH: OnceCell<u32> = OnceCell::new();
static STATE_HEIGHT: OnceCell<u32> = OnceCell::new();

// 定义默认窗口尺寸常量
const DEFAULT_WIDTH: u32 = 900;
const DEFAULT_HEIGHT: u32 = 700;

// 添加全局UI准备就绪标志
static UI_READY: OnceCell<Arc<RwLock<bool>>> = OnceCell::new();

// 窗口创建锁，防止并发创建窗口
static WINDOW_CREATING: OnceCell<Mutex<(bool, Instant)>> = OnceCell::new();

// 定义窗口状态结构体
#[derive(Debug, Serialize, Deserialize)]
struct WindowState {
    width: Option<u32>,
    height: Option<u32>,
}

fn get_window_creating_lock() -> &'static Mutex<(bool, Instant)> {
    WINDOW_CREATING.get_or_init(|| Mutex::new((false, Instant::now())))
}

fn get_ui_ready() -> &'static Arc<RwLock<bool>> {
    UI_READY.get_or_init(|| Arc::new(RwLock::new(false)))
}

// 标记UI已准备就绪
pub fn mark_ui_ready() {
    let mut ready = get_ui_ready().write();
    *ready = true;
}

// 重置UI就绪状态
pub fn reset_ui_ready() {
    let mut ready = get_ui_ready().write();
    *ready = false;
    logging!(info, Type::Window, true, "UI就绪状态已重置");
}

pub fn find_unused_port() -> Result<u16> {
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => {
            let port = listener.local_addr()?.port();
            Ok(port)
        }
        Err(_) => {
            let port = Config::verge()
                .latest()
                .verge_mixed_port
                .unwrap_or(Config::clash().data().get_mixed_port());
            log::warn!(target: "app", "use default port: {}", port);
            Ok(port)
        }
    }
}

/// handle something when start app
pub async fn resolve_setup(app: &mut App) {
    error::redirect_panic_to_log();
    #[cfg(target_os = "macos")]
    {
        AppHandleManager::global().init(app.app_handle().clone());
        AppHandleManager::global().set_activation_policy_accessory();
    }
    let version = app.package_info().version.to_string();

    handle::Handle::global().init(app.app_handle());
    VERSION.get_or_init(|| version.clone());

    logging_error!(Type::Config, true, init::init_config());
    logging_error!(Type::Setup, true, init::init_resources());
    logging_error!(Type::Setup, true, init::init_scheme());
    logging_error!(Type::Setup, true, init::startup_script().await);
    // 处理随机端口
    logging_error!(Type::System, true, resolve_random_port_config());
    // 启动核心
    logging!(trace, Type::Config, true, "Initial config");
    logging_error!(Type::Config, true, Config::init_config().await);

    logging!(trace, Type::Core, "Starting CoreManager");
    logging_error!(Type::Core, true, CoreManager::global().init().await);

    // setup a simple http server for singleton
    log::trace!(target: "app", "launch embed server");
    server::embed_server();

    log::trace!(target: "app", "Initial system tray");
    logging_error!(Type::Tray, true, tray::Tray::global().init());
    logging_error!(Type::Tray, true, tray::Tray::global().create_systray(app));

    logging_error!(
        Type::System,
        true,
        sysopt::Sysopt::global().update_sysproxy().await
    );
    logging_error!(
        Type::System,
        true,
        sysopt::Sysopt::global().init_guard_sysproxy()
    );

    let is_silent_start = { Config::verge().data().enable_silent_start }.unwrap_or(false);
    create_window(!is_silent_start);

    logging_error!(Type::System, true, timer::Timer::global().init());

    let enable_auto_light_weight_mode =
        { Config::verge().data().enable_auto_light_weight_mode }.unwrap_or(false);
    if enable_auto_light_weight_mode && !is_silent_start {
        lightweight::enable_auto_light_weight_mode();
    }

    logging_error!(Type::Tray, true, tray::Tray::global().update_part());

    // 初始化热键
    logging!(trace, Type::System, true, "Initial hotkeys");
    logging_error!(Type::System, true, hotkey::Hotkey::global().init());
}

/// reset system proxy (异步版)
pub async fn resolve_reset_async() {
    #[cfg(target_os = "macos")]
    logging!(info, Type::Tray, true, "Unsubscribing from traffic updates");
    #[cfg(target_os = "macos")]
    tray::Tray::global().unsubscribe_traffic();

    logging_error!(
        Type::System,
        true,
        sysopt::Sysopt::global().reset_sysproxy().await
    );
    logging_error!(Type::Core, true, CoreManager::global().stop_core().await);
    #[cfg(target_os = "macos")]
    {
        logging!(info, Type::System, true, "Restoring system DNS settings");
        restore_public_dns().await;
    }
}

/// 窗口创建锁守卫
struct WindowCreateGuard;

impl Drop for WindowCreateGuard {
    fn drop(&mut self) {
        let mut lock = get_window_creating_lock().lock();
        lock.0 = false;
        logging!(info, Type::Window, true, "窗口创建过程已完成，释放锁");
    }
}

/// create main window
pub fn create_window(is_showup: bool) {
    // 尝试获取窗口创建锁
    let mut creating_lock = get_window_creating_lock().lock();
    let (is_creating, last_create_time) = *creating_lock;
    let now = Instant::now();

    // 检查是否有其他线程正在创建窗口，防止短时间内多次创建窗口导致竞态条件
    if is_creating && now.duration_since(last_create_time) < Duration::from_secs(2) {
        logging!(
            warn,
            Type::Window,
            true,
            "另一个窗口创建过程正在进行中，跳过本次创建请求"
        );
        return;
    }

    *creating_lock = (true, now);
    drop(creating_lock);

    // 创建窗口锁守卫结束时自动释放锁
    let _guard = WindowCreateGuard;

    // 打印 .window-state.json 文件路径
    let window_state_file = dirs::app_home_dir()
        .ok()
        .map(|dir| dir.join(".window-state.json"));
    logging!(
        info,
        Type::Window,
        true,
        "窗口状态文件路径: {:?}",
        window_state_file
    );

    // 从文件加载窗口状态
    if let Some(window_state_file_path) = window_state_file {
        if window_state_file_path.exists() {
            match std::fs::read_to_string(&window_state_file_path) {
                Ok(content) => {
                    logging!(
                        debug,
                        Type::Window,
                        true,
                        "读取窗口状态文件内容成功: {} 字节",
                        content.len()
                    );

                    match serde_json::from_str::<WindowState>(&content) {
                        Ok(window_state) => {
                            logging!(
                                info,
                                Type::Window,
                                true,
                                "成功解析窗口状态: width={:?}, height={:?}",
                                window_state.width,
                                window_state.height
                            );

                            // 存储窗口状态以供后续使用
                            if let Some(width) = window_state.width {
                                STATE_WIDTH.set(width).ok();
                            }
                            if let Some(height) = window_state.height {
                                STATE_HEIGHT.set(height).ok();
                            }
                        }
                        Err(e) => {
                            logging!(error, Type::Window, true, "解析窗口状态文件失败: {:?}", e);
                        }
                    }
                }
                Err(e) => {
                    logging!(error, Type::Window, true, "读取窗口状态文件失败: {:?}", e);
                }
            }
        } else {
            logging!(
                info,
                Type::Window,
                true,
                "窗口状态文件不存在，将使用默认设置"
            );
        }
    }

    if !is_showup {
        logging!(info, Type::Window, "Not to display create window");
        return;
    }

    logging!(info, Type::Window, true, "Creating window");

    let app_handle = handle::Handle::global().app_handle().unwrap();
    #[cfg(target_os = "macos")]
    AppHandleManager::global().set_activation_policy_regular();

    // 检查是否从轻量模式恢复
    let from_lightweight = crate::module::lightweight::is_in_lightweight_mode();
    if from_lightweight {
        logging!(info, Type::Window, true, "从轻量模式恢复窗口");
        crate::module::lightweight::exit_lightweight_mode();
    }

    if let Some(window) = handle::Handle::global().get_window() {
        logging!(info, Type::Window, true, "Found existing window");

        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }

        if from_lightweight {
            // 从轻量模式恢复需要销毁旧窗口以重建
            logging!(info, Type::Window, true, "销毁旧窗口以重建新窗口");
            let _ = window.close();

            // 添加短暂延迟确保窗口正确关闭
            std::thread::sleep(std::time::Duration::from_millis(100));
        } else {
            // 普通情况直接显示窗口
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
    }

    let width = STATE_WIDTH.get().copied().unwrap_or(DEFAULT_WIDTH);
    let height = STATE_HEIGHT.get().copied().unwrap_or(DEFAULT_HEIGHT);

    logging!(
        info,
        Type::Window,
        true,
        "Initializing new window with size: {}x{}",
        width,
        height
    );

    // 根据不同平台创建不同配置的窗口
    #[cfg(target_os = "macos")]
    let win_builder = {
        // 基本配置
        let builder = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "main",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Clash Verge")
        .center()
        .decorations(true)
        .hidden_title(true) // 隐藏标题文本
        .fullscreen(false)
        .inner_size(width as f64, height as f64)
        .min_inner_size(520.0, 520.0)
        .visible(false);

        // 尝试设置标题栏样式
        // 注意：根据Tauri版本不同，此API可能有变化
        // 如果编译出错，请注释掉下面这行
        let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay);

        builder
    };

    #[cfg(not(target_os = "macos"))]
    let win_builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .center()
    .fullscreen(false)
    .inner_size(width as f64, height as f64)
    .min_inner_size(520.0, 520.0)
    .visible(false)
    .decorations(false);

    let window = win_builder.build();

    match window {
        Ok(window) => {
            logging!(info, Type::Window, true, "Window created successfully");

            // 静默启动模式等窗口初始化再启动自动进入轻量模式的计时监听器，防止初始化的时候找不到窗口对象导致监听器挂载失败
            lightweight::run_once_auto_lightweight();

            // 标记前端UI已准备就绪，向前端发送启动完成事件
            let app_handle_clone = app_handle.clone();

            // 获取窗口创建后的初始大小
            if let Ok(size) = window.inner_size() {
                let state_width = STATE_WIDTH.get().copied().unwrap_or(DEFAULT_WIDTH);
                let state_height = STATE_HEIGHT.get().copied().unwrap_or(DEFAULT_HEIGHT);

                // 输出所有尺寸信息
                logging!(
                    info,
                    Type::Window,
                    true,
                    "API报告的窗口尺寸: {}x{}, 状态文件尺寸: {}x{}, 默认尺寸: {}x{}",
                    size.width,
                    size.height,
                    state_width,
                    state_height,
                    DEFAULT_WIDTH,
                    DEFAULT_HEIGHT
                );

                // 优化窗口大小设置
                if size.width < state_width || size.height < state_height {
                    logging!(
                        info,
                        Type::Window,
                        true,
                        "强制设置窗口尺寸: {}x{}",
                        state_width,
                        state_height
                    );

                    // 尝试不同的方式设置窗口大小
                    let _ = window.set_size(tauri::PhysicalSize {
                        width: state_width,
                        height: state_height,
                    });

                    // 关键：等待短暂时间让窗口尺寸生效
                    std::thread::sleep(std::time::Duration::from_millis(50));

                    // 再次检查窗口尺寸
                    if let Ok(new_size) = window.inner_size() {
                        logging!(
                            info,
                            Type::Window,
                            true,
                            "设置后API报告的窗口尺寸: {}x{}",
                            new_size.width,
                            new_size.height
                        );
                    }
                }
            }

            // 标记此窗口是否从轻量模式恢复
            let was_from_lightweight = from_lightweight;

            AsyncHandler::spawn(move || async move {
                // 处理启动完成
                handle::Handle::global().mark_startup_completed();

                if let Some(window) = app_handle_clone.get_webview_window("main") {
                    // 发送启动完成事件
                    let _ = window.emit("verge://startup-completed", ());

                    if is_showup {
                        let window_clone = window.clone();

                        // 从轻量模式恢复时使用较短的超时，避免卡死
                        let timeout_seconds = if was_from_lightweight {
                            // 从轻量模式恢复只等待2秒，确保不会卡死
                            2
                        } else {
                            5
                        };

                        // 使用普通的等待方式替代事件监听，简化实现
                        let wait_result =
                            tokio::time::timeout(Duration::from_secs(timeout_seconds), async {
                                while !*get_ui_ready().read() {
                                    tokio::time::sleep(Duration::from_millis(100)).await;
                                }
                            })
                            .await;

                        // 根据结果处理
                        match wait_result {
                            Ok(_) => {
                                logging!(info, Type::Window, true, "UI就绪，显示窗口");
                            }
                            Err(_) => {
                                logging!(
                                    warn,
                                    Type::Window,
                                    true,
                                    "等待UI就绪超时({}秒)，强制显示窗口",
                                    timeout_seconds
                                );
                                // 强制设置UI就绪状态
                                *get_ui_ready().write() = true;
                            }
                        }

                        // 显示窗口
                        let _ = window_clone.show();
                        let _ = window_clone.set_focus();

                        logging!(info, Type::Window, true, "窗口创建和显示流程已完成");
                    }
                }
            });
        }
        Err(e) => {
            logging!(error, Type::Window, true, "Failed to create window: {}", e);
        }
    }
}

pub async fn resolve_scheme(param: String) -> Result<()> {
    log::info!(target:"app", "received deep link: {}", param);

    let param_str = if param.starts_with("[") && param.len() > 4 {
        param
            .get(2..param.len() - 2)
            .ok_or_else(|| anyhow::anyhow!("Invalid string slice boundaries"))?
    } else {
        param.as_str()
    };

    // 解析 URL
    let link_parsed = match Url::parse(param_str) {
        Ok(url) => url,
        Err(e) => {
            bail!("failed to parse deep link: {:?}, param: {:?}", e, param);
        }
    };

    if link_parsed.scheme() == "clash" || link_parsed.scheme() == "clash-verge" {
        let name = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "name")
            .map(|(_, value)| value.into_owned());

        // 通过直接获取查询部分并解析特定参数来避免 URL 转义问题
        let url_param = if let Some(query) = link_parsed.query() {
            let prefix = "url=";
            if let Some(pos) = query.find(prefix) {
                let raw_url = &query[pos + prefix.len()..];
                Some(percent_decode_str(raw_url).decode_utf8_lossy().to_string())
            } else {
                None
            }
        } else {
            None
        };

        match url_param {
            Some(url) => {
                log::info!(target:"app", "decoded subscription url: {}", url);

                create_window(false);
                match PrfItem::from_url(url.as_ref(), name, None, None).await {
                    Ok(item) => {
                        let uid = item.uid.clone().unwrap();
                        let _ = wrap_err!(Config::profiles().data().append_item(item));
                        handle::Handle::notice_message("import_sub_url::ok", uid);
                    }
                    Err(e) => {
                        handle::Handle::notice_message("import_sub_url::error", e.to_string());
                    }
                }
            }
            None => bail!("failed to get profile url"),
        }
    }

    Ok(())
}

fn resolve_random_port_config() -> Result<()> {
    let verge_config = Config::verge();
    let clash_config = Config::clash();
    let enable_random_port = verge_config.latest().enable_random_port.unwrap_or(false);

    let default_port = verge_config
        .latest()
        .verge_mixed_port
        .unwrap_or(clash_config.data().get_mixed_port());

    let port = if enable_random_port {
        find_unused_port().unwrap_or(default_port)
    } else {
        default_port
    };

    verge_config.data().patch_config(IVerge {
        verge_mixed_port: Some(port),
        ..IVerge::default()
    });
    verge_config.data().save_file()?;

    let mut mapping = Mapping::new();
    mapping.insert("mixed-port".into(), port.into());
    clash_config.data().patch_config(mapping);
    clash_config.data().save_config()?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn set_public_dns(dns_server: String) {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt;
    let app_handle = handle::Handle::global().app_handle().unwrap();

    log::info!(target: "app", "try to set system dns");
    let resource_dir = dirs::app_resources_dir().unwrap();
    let script = resource_dir.join("set_dns.sh");
    if !script.exists() {
        log::error!(target: "app", "set_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script, dns_server])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                log::info!(target: "app", "set system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                log::error!(target: "app", "set system dns failed: {code}");
            }
        }
        Err(err) => {
            log::error!(target: "app", "set system dns failed: {err}");
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn restore_public_dns() {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt;
    let app_handle = handle::Handle::global().app_handle().unwrap();
    log::info!(target: "app", "try to unset system dns");
    let resource_dir = dirs::app_resources_dir().unwrap();
    let script = resource_dir.join("unset_dns.sh");
    if !script.exists() {
        log::error!(target: "app", "unset_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                log::info!(target: "app", "unset system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                log::error!(target: "app", "unset system dns failed: {code}");
            }
        }
        Err(err) => {
            log::error!(target: "app", "unset system dns failed: {err}");
        }
    }
}
