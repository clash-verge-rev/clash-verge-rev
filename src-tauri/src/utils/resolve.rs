#[cfg(target_os = "macos")]
use crate::AppHandleManager;
use crate::{
    config::{Config, IVerge, PrfItem},
    core::*,
    logging, logging_error,
    module::lightweight::{self, auto_lightweight_mode_init},
    process::AsyncHandler,
    utils::{init, logging::Type, server},
    wrap_err,
};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
use percent_encoding::percent_decode_str;
use serde_yaml::Mapping;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use tauri::Url;
//#[cfg(not(target_os = "linux"))]
// use window_shadows::set_shadow;

pub static VERSION: OnceCell<String> = OnceCell::new();

// 定义默认窗口尺寸常量
const DEFAULT_WIDTH: u32 = 940;
const DEFAULT_HEIGHT: u32 = 700;

// 添加全局UI准备就绪标志
static UI_READY: OnceCell<Arc<RwLock<bool>>> = OnceCell::new();

// 窗口创建锁，防止并发创建窗口
static WINDOW_CREATING: OnceCell<Mutex<(bool, Instant)>> = OnceCell::new();

// UI就绪阶段状态枚举
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UiReadyStage {
    NotStarted,
    Loading,
    DomReady,
    ResourcesLoaded,
    Ready,
}

// UI就绪详细状态
#[derive(Debug)]
struct UiReadyState {
    stage: RwLock<UiReadyStage>,
    last_update: RwLock<Instant>,
}

impl Default for UiReadyState {
    fn default() -> Self {
        Self {
            stage: RwLock::new(UiReadyStage::NotStarted),
            last_update: RwLock::new(Instant::now()),
        }
    }
}

// 获取UI就绪状态细节
static UI_READY_STATE: OnceCell<Arc<UiReadyState>> = OnceCell::new();

fn get_window_creating_lock() -> &'static Mutex<(bool, Instant)> {
    WINDOW_CREATING.get_or_init(|| Mutex::new((false, Instant::now())))
}

fn get_ui_ready() -> &'static Arc<RwLock<bool>> {
    UI_READY.get_or_init(|| Arc::new(RwLock::new(false)))
}

fn get_ui_ready_state() -> &'static Arc<UiReadyState> {
    UI_READY_STATE.get_or_init(|| Arc::new(UiReadyState::default()))
}

// 更新UI准备阶段
pub fn update_ui_ready_stage(stage: UiReadyStage) {
    let state = get_ui_ready_state();
    let mut stage_lock = state.stage.write();
    let mut time_lock = state.last_update.write();

    *stage_lock = stage;
    *time_lock = Instant::now();

    logging!(
        info,
        Type::Window,
        true,
        "UI准备阶段更新: {:?}, 耗时: {:?}ms",
        stage,
        time_lock.elapsed().as_millis()
    );

    // 如果是最终阶段，标记UI完全就绪
    if stage == UiReadyStage::Ready {
        mark_ui_ready();
    }
}

// 标记UI已准备就绪
pub fn mark_ui_ready() {
    let mut ready = get_ui_ready().write();
    *ready = true;
    logging!(info, Type::Window, true, "UI已标记为完全就绪");
}

// 重置UI就绪状态
pub fn reset_ui_ready() {
    {
        let mut ready = get_ui_ready().write();
        *ready = false;
    }
    {
        let state = get_ui_ready_state();
        let mut stage = state.stage.write();
        let mut time = state.last_update.write();
        *stage = UiReadyStage::NotStarted;
        *time = Instant::now();
    }
    logging!(info, Type::Window, true, "UI就绪状态已重置");
}

pub async fn find_unused_port() -> Result<u16> {
    match TcpListener::bind("127.0.0.1:0").await {
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

/// 异步方式处理启动后的额外任务
pub async fn resolve_setup_async(app_handle: &AppHandle) {
    let start_time = std::time::Instant::now();
    logging!(info, Type::Setup, true, "开始执行异步设置任务...");

    if VERSION.get().is_none() {
        let version = app_handle.package_info().version.to_string();
        VERSION.get_or_init(|| {
            logging!(info, Type::Setup, true, "初始化版本信息: {}", version);
            version.clone()
        });
    }

    logging_error!(Type::Setup, true, init::init_scheme());

    logging_error!(Type::Setup, true, init::startup_script().await);

    if let Err(err) = resolve_random_port_config().await {
        logging!(
            error,
            Type::System,
            true,
            "Failed to resolve random port config: {}",
            err
        );
    }

    logging!(trace, Type::Config, true, "初始化配置...");
    logging_error!(Type::Config, true, Config::init_config().await);

    // 启动时清理冗余的 Profile 文件
    logging!(info, Type::Setup, true, "清理冗余的Profile文件...");
    let profiles = Config::profiles();
    if let Err(e) = profiles.latest().auto_cleanup() {
        logging!(warn, Type::Setup, true, "启动时清理Profile文件失败: {}", e);
    } else {
        logging!(info, Type::Setup, true, "启动时Profile文件清理完成");
    }

    logging!(trace, Type::Core, true, "启动核心管理器...");
    logging_error!(Type::Core, true, CoreManager::global().init().await);

    log::trace!(target: "app", "启动内嵌服务器...");
    server::embed_server();

    logging_error!(Type::Tray, true, tray::Tray::global().init());

    if let Some(app_handle) = handle::Handle::global().app_handle() {
        logging!(info, Type::Tray, true, "创建系统托盘...");
        let result = tray::Tray::global().create_tray_from_handle(&app_handle);
        if result.is_ok() {
            logging!(info, Type::Tray, true, "系统托盘创建成功");
        } else if let Err(e) = result {
            logging!(error, Type::Tray, true, "系统托盘创建失败: {}", e);
        }
    } else {
        logging!(
            error,
            Type::Tray,
            true,
            "无法创建系统托盘: app_handle不存在"
        );
    }

    // 更新系统代理
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

    // 创建窗口
    let is_silent_start = { Config::verge().data().enable_silent_start }.unwrap_or(false);
    #[cfg(target_os = "macos")]
    {
        if is_silent_start {
            use crate::AppHandleManager;

            AppHandleManager::global().set_activation_policy_accessory();
        }
    }
    create_window(!is_silent_start);

    // 初始化定时器
    logging_error!(Type::System, true, timer::Timer::global().init());

    // 自动进入轻量模式
    auto_lightweight_mode_init();

    logging_error!(Type::Tray, true, tray::Tray::global().update_part());

    logging!(trace, Type::System, true, "初始化热键...");
    logging_error!(Type::System, true, hotkey::Hotkey::global().init());

    let elapsed = start_time.elapsed();
    logging!(
        info,
        Type::Setup,
        true,
        "异步设置任务完成，耗时: {:?}",
        elapsed
    );

    // 如果初始化时间过长，记录警告
    if elapsed.as_secs() > 10 {
        logging!(
            warn,
            Type::Setup,
            true,
            "异步设置任务耗时较长({:?})",
            elapsed
        );
    }
}

/// reset system proxy (异步)
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

/// Create the main window
pub fn create_window(is_show: bool) -> bool {
    logging!(
        info,
        Type::Window,
        true,
        "开始创建/显示主窗口, is_show={}",
        is_show
    );

    if !is_show {
        logging!(info, Type::Window, true, "静默模式启动时不创建窗口");
        handle::Handle::notify_startup_completed();
        return false;
    }

    if let Some(app_handle) = handle::Handle::global().app_handle() {
        if let Some(window) = app_handle.get_webview_window("main") {
            logging!(info, Type::Window, true, "主窗口已存在，将显示现有窗口");
            if is_show {
                if window.is_minimized().unwrap_or(false) {
                    logging!(info, Type::Window, true, "窗口已最小化，正在取消最小化");
                    let _ = window.unminimize();
                }
                let _ = window.show();
                let _ = window.set_focus();

                #[cfg(target_os = "macos")]
                {
                    AppHandleManager::global().set_activation_policy_regular();
                }
            }
            return true;
        }
    }

    let creating_lock = get_window_creating_lock();
    let mut creating = creating_lock.lock();

    let (is_creating, last_time) = *creating;
    let elapsed = last_time.elapsed();

    if is_creating && elapsed < Duration::from_secs(2) {
        logging!(
            info,
            Type::Window,
            true,
            "窗口创建请求被忽略，因为最近创建过 ({:?}ms)",
            elapsed.as_millis()
        );
        return false;
    }

    *creating = (true, Instant::now());

    match tauri::WebviewWindowBuilder::new(
        &handle::Handle::global().app_handle().unwrap(),
        "main", /* the unique window label */
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .center()
    .decorations(true)
    .fullscreen(false)
    .inner_size(DEFAULT_WIDTH as f64, DEFAULT_HEIGHT as f64)
    .min_inner_size(520.0, 520.0)
    .visible(true) // 立即显示窗口，避免用户等待
    .initialization_script(
        r#"
        console.log('[Tauri] 窗口初始化脚本开始执行');

        function createLoadingOverlay() {

            if (document.getElementById('initial-loading-overlay')) {
                console.log('[Tauri] 加载指示器已存在');
                return;
            }

            console.log('[Tauri] 创建加载指示器');
            const loadingDiv = document.createElement('div');
            loadingDiv.id = 'initial-loading-overlay';
            loadingDiv.innerHTML = `
                <div style="
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: var(--bg-color, #f5f5f5); color: var(--text-color, #333);
                    display: flex; flex-direction: column; align-items: center;
                    justify-content: center; z-index: 9999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    transition: opacity 0.3s ease;
                ">
                    <div style="margin-bottom: 20px;">
                        <div style="
                            width: 40px; height: 40px; border: 3px solid #e3e3e3;
                            border-top: 3px solid #3498db; border-radius: 50%;
                            animation: spin 1s linear infinite;
                        "></div>
                    </div>
                    <div style="font-size: 14px; opacity: 0.7;">Loading Clash Verge...</div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    @media (prefers-color-scheme: dark) {
                        :root { --bg-color: #1a1a1a; --text-color: #ffffff; }
                    }
                </style>
            `;

            if (document.body) {
                document.body.appendChild(loadingDiv);
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    if (document.body && !document.getElementById('initial-loading-overlay')) {
                        document.body.appendChild(loadingDiv);
                    }
                });
            }
        }

        createLoadingOverlay();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createLoadingOverlay);
        } else {
            createLoadingOverlay();
        }

        console.log('[Tauri] 窗口初始化脚本执行完成');
    "#,
    )
    .build()
    {
        Ok(newly_created_window) => {
            logging!(debug, Type::Window, true, "主窗口实例创建成功");

            *creating = (false, Instant::now());

            update_ui_ready_stage(UiReadyStage::NotStarted);

            AsyncHandler::spawn(move || async move {
                handle::Handle::global().mark_startup_completed();
                logging!(
                    debug,
                    Type::Window,
                    true,
                    "异步窗口任务开始 (启动已标记完成)"
                );

                // 先运行轻量模式检测
                lightweight::run_once_auto_lightweight();

                // 发送启动完成事件，触发前端开始加载
                logging!(
                    debug,
                    Type::Window,
                    true,
                    "发送 verge://startup-completed 事件"
                );
                handle::Handle::notify_startup_completed();

                if is_show {
                    let window_clone = newly_created_window.clone();

                    // 立即显示窗口
                    let _ = window_clone.show();
                    let _ = window_clone.set_focus();
                    logging!(info, Type::Window, true, "窗口已立即显示");
                    #[cfg(target_os = "macos")]
                    {
                        AppHandleManager::global().set_activation_policy_regular();
                    }

                    let timeout_seconds = if crate::module::lightweight::is_in_lightweight_mode() {
                        3
                    } else {
                        8
                    };

                    logging!(
                        info,
                        Type::Window,
                        true,
                        "开始监控UI加载状态 (最多{}秒)...",
                        timeout_seconds
                    );

                    // 异步监控UI状态，不影响窗口显示
                    tokio::spawn(async move {
                        let wait_result =
                            tokio::time::timeout(Duration::from_secs(timeout_seconds), async {
                                let mut check_count = 0;
                                while !*get_ui_ready().read() {
                                    tokio::time::sleep(Duration::from_millis(100)).await;
                                    check_count += 1;

                                    // 每2秒记录一次等待状态
                                    if check_count % 20 == 0 {
                                        logging!(
                                            debug,
                                            Type::Window,
                                            true,
                                            "UI加载状态检查... ({}秒)",
                                            check_count / 10
                                        );
                                    }
                                }
                            })
                            .await;

                        match wait_result {
                            Ok(_) => {
                                logging!(info, Type::Window, true, "UI已完全加载就绪");
                                // 移除初始加载指示器
                                if let Some(window) = handle::Handle::global().get_window() {
                                    let _ = window.eval(r#"
                                        const overlay = document.getElementById('initial-loading-overlay');
                                        if (overlay) {
                                            overlay.style.opacity = '0';
                                            setTimeout(() => overlay.remove(), 300);
                                        }
                                    "#);
                                }
                            }
                            Err(_) => {
                                logging!(
                                    warn,
                                    Type::Window,
                                    true,
                                    "UI加载监控超时({}秒)，但窗口已正常显示",
                                    timeout_seconds
                                );
                                *get_ui_ready().write() = true;
                            }
                        }
                    });

                    logging!(info, Type::Window, true, "窗口显示流程完成");
                } else {
                    logging!(
                        debug,
                        Type::Window,
                        true,
                        "is_show为false，窗口保持隐藏状态"
                    );
                }
            });
            true
        }
        Err(e) => {
            logging!(error, Type::Window, true, "主窗口构建失败: {}", e);
            *creating = (false, Instant::now()); // Reset the creating state if window creation failed
            false
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

async fn resolve_random_port_config() -> Result<()> {
    let verge_config = Config::verge();
    let clash_config = Config::clash();
    let enable_random_port = verge_config.latest().enable_random_port.unwrap_or(false);

    let default_port = verge_config
        .latest()
        .verge_mixed_port
        .unwrap_or(clash_config.data().get_mixed_port());

    let port = if enable_random_port {
        find_unused_port().await.unwrap_or(default_port)
    } else {
        default_port
    };

    let port_to_save = port;

    tokio::task::spawn_blocking(move || {
        let verge_config_accessor = Config::verge();
        let mut verge_data = verge_config_accessor.data();
        verge_data.patch_config(IVerge {
            verge_mixed_port: Some(port_to_save),
            ..IVerge::default()
        });
        verge_data.save_file()
    })
    .await??; // First ? for spawn_blocking error, second for save_file Result

    tokio::task::spawn_blocking(move || {
        let clash_config_accessor = Config::clash(); // Extend lifetime of the accessor
        let mut clash_data = clash_config_accessor.data(); // Access within blocking task, made mutable
        let mut mapping = Mapping::new();
        mapping.insert("mixed-port".into(), port_to_save.into());
        clash_data.patch_config(mapping);
        clash_data.save_config()
    })
    .await??;

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
