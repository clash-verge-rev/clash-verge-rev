#[cfg(target_os = "macos")]
use crate::AppHandleManager;
use crate::{
    config::{Config, IVerge, PrfItem},
    core::*,
    logging, logging_error,
    module::lightweight,
    process::AsyncHandler,
    utils::{error, init, logging::Type, server},
    wrap_err,
};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use percent_encoding::percent_decode_str;
use serde_json;
use serde_yaml::Mapping;
use std::{net::TcpListener, sync::Arc};
use tauri::{App, Manager};

use tauri::Url;
//#[cfg(not(target_os = "linux"))]
// use window_shadows::set_shadow;

pub static VERSION: OnceCell<String> = OnceCell::new();

// 窗口状态文件中的尺寸
static STATE_WIDTH: OnceCell<u32> = OnceCell::new();
static STATE_HEIGHT: OnceCell<u32> = OnceCell::new();

// 添加全局UI准备就绪标志
static UI_READY: OnceCell<Arc<RwLock<bool>>> = OnceCell::new();

fn get_ui_ready() -> &'static Arc<RwLock<bool>> {
    UI_READY.get_or_init(|| Arc::new(RwLock::new(false)))
}

// 标记UI已准备就绪
pub fn mark_ui_ready() {
    let mut ready = get_ui_ready().write();
    *ready = true;
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

/// create main window
pub fn create_window(is_showup: bool) {
    // 打印 .window-state.json 文件路径
    if let Ok(app_dir) = crate::utils::dirs::app_home_dir() {
        let window_state_path = app_dir.join(".window-state.json");
        logging!(
            info,
            Type::Window,
            true,
            "窗口状态文件路径: {:?}",
            window_state_path
        );

        // 尝试读取窗口状态文件内容
        if window_state_path.exists() {
            match std::fs::read_to_string(&window_state_path) {
                Ok(content) => {
                    logging!(info, Type::Window, true, "窗口状态文件内容: {}", content);

                    // 解析窗口状态文件
                    match serde_json::from_str::<serde_json::Value>(&content) {
                        Ok(state_json) => {
                            if let Some(main_window) = state_json.get("main") {
                                let width = main_window
                                    .get("width")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0)
                                    as u32;
                                let height = main_window
                                    .get("height")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0)
                                    as u32;

                                logging!(
                                    info,
                                    Type::Window,
                                    true,
                                    "窗口状态文件中的尺寸: {}x{}",
                                    width,
                                    height
                                );

                                // 保存读取到的尺寸，用于后续检查
                                STATE_WIDTH.get_or_init(|| width);
                                STATE_HEIGHT.get_or_init(|| height);
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

    if let Some(window) = handle::Handle::global().get_window() {
        logging!(
            info,
            Type::Window,
            true,
            "Found existing window, attempting to restore visibility"
        );

        if window.is_minimized().unwrap_or(false) {
            logging!(
                info,
                Type::Window,
                true,
                "Window is minimized, restoring window state"
            );
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    // 定义默认窗口大小
    const DEFAULT_WIDTH: u32 = 900;
    const DEFAULT_HEIGHT: u32 = 700;
    const MIN_WIDTH: u32 = 650;
    const MIN_HEIGHT: u32 = 580;

    #[cfg(target_os = "windows")]
    let window = tauri::WebviewWindowBuilder::new(
                &app_handle,
                "main".to_string(),
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Clash Verge")
            .inner_size(DEFAULT_WIDTH as f64, DEFAULT_HEIGHT as f64)
            .min_inner_size(MIN_WIDTH as f64, MIN_HEIGHT as f64)
            .decorations(false)
            .maximizable(true)
            .additional_browser_args("--enable-features=msWebView2EnableDraggableRegions --disable-features=OverscrollHistoryNavigation,msExperimentalScrolling")
            .transparent(true)
            .shadow(true)
            .visible(false) // 初始不可见，等待UI加载完成后再显示
            .build();

    #[cfg(target_os = "macos")]
    let window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "main".to_string(),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .decorations(true)
    .hidden_title(true)
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .inner_size(DEFAULT_WIDTH as f64, DEFAULT_HEIGHT as f64)
    .min_inner_size(MIN_WIDTH as f64, MIN_HEIGHT as f64)
    .visible(false) // 初始不可见，等待UI加载完成后再显示
    .build();

    #[cfg(target_os = "linux")]
    let window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "main".to_string(),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .decorations(false)
    .inner_size(DEFAULT_WIDTH as f64, DEFAULT_HEIGHT as f64)
    .min_inner_size(MIN_WIDTH as f64, MIN_HEIGHT as f64)
    .transparent(true)
    .visible(false) // 初始不可见，等待UI加载完成后再显示
    .build();

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

                if state_width < DEFAULT_WIDTH || state_height < DEFAULT_HEIGHT {
                    logging!(
                        info,
                        Type::Window,
                        true,
                        "状态文件窗口尺寸小于默认值，将使用默认尺寸: {}x{}",
                        DEFAULT_WIDTH,
                        DEFAULT_HEIGHT
                    );

                    let _ = window.set_size(tauri::LogicalSize::new(
                        DEFAULT_WIDTH as f64,
                        DEFAULT_HEIGHT as f64,
                    ));
                } else if size.width != state_width || size.height != state_height {
                    // 如果API报告的尺寸与状态文件不一致，记录日志
                    logging!(
                        warn,
                        Type::Window,
                        true,
                        "API报告的窗口尺寸与状态文件不一致"
                    );
                }
            }

            AsyncHandler::spawn(move || async move {
                use tauri::Emitter;

                logging!(info, Type::Window, true, "UI gets ready.");
                handle::Handle::global().mark_startup_completed();

                if let Some(window) = app_handle_clone.get_webview_window("main") {
                    // 检查窗口大小
                    match window.inner_size() {
                        Ok(size) => {
                            let width = size.width;
                            let height = size.height;

                            let state_width = STATE_WIDTH.get().copied().unwrap_or(DEFAULT_WIDTH);
                            let state_height =
                                STATE_HEIGHT.get().copied().unwrap_or(DEFAULT_HEIGHT);

                            logging!(
                                info,
                                Type::Window,
                                true,
                                "异步任务中窗口尺寸: {}x{}, 状态文件尺寸: {}x{}",
                                width,
                                height,
                                state_width,
                                state_height
                            );
                        }
                        Err(e) => {
                            logging!(
                                error,
                                Type::Window,
                                true,
                                "Failed to get window size: {:?}",
                                e
                            );
                        }
                    }

                    // 发送启动完成事件
                    let _ = window.emit("verge://startup-completed", ());

                    if is_showup {
                        // 启动一个任务等待UI准备就绪再显示窗口
                        let window_clone = window.clone();
                        AsyncHandler::spawn(move || async move {
                            async fn wait_for_ui_ready() {
                                while !*get_ui_ready().read() {
                                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                                }
                            }

                            match tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                wait_for_ui_ready(),
                            )
                            .await
                            {
                                Ok(_) => {
                                    logging!(info, Type::Window, true, "UI准备就绪，显示窗口");
                                }
                                Err(_) => {
                                    logging!(
                                        warn,
                                        Type::Window,
                                        true,
                                        "等待UI准备就绪超时，强制显示窗口"
                                    );
                                }
                            }

                            let _ = window_clone.show();
                            let _ = window_clone.set_focus();
                        });
                    }
                }
            });
        }
        Err(e) => {
            logging!(
                error,
                Type::Window,
                true,
                "Failed to create window: {:?}",
                e
            );
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
