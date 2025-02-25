//！
//! feat mod 里的函数主要用于
//! - hotkey 快捷键
//! - timer 定时器
//! - cmds 页面调用
//!
use crate::cmds;
use crate::config::*;
use crate::core::*;
use crate::log_err;
use crate::utils::dirs::app_home_dir;
use crate::utils::resolve;
use anyhow::{bail, Result};
use reqwest_dav::list_cmd::ListFile;
use serde_yaml::{Mapping, Value};
use std::fs;
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use std::env;

// 打开面板
#[allow(dead_code)]
pub fn open_or_close_dashboard() {
    println!("Attempting to open/close dashboard");
    log::info!(target: "app", "Attempting to open/close dashboard");

    if let Some(window) = handle::Handle::global().get_window() {
        println!("Found existing window");
        log::info!(target: "app", "Found existing window");

        // 如果窗口存在，则切换其显示状态
        match window.is_visible() {
            Ok(visible) => {
                println!("Window visibility status: {}", visible);
                log::info!(target: "app", "Window visibility status: {}", visible);

                if visible {
                    println!("Attempting to hide window");
                    log::info!(target: "app", "Attempting to hide window");
                    let _ = window.hide();
                } else {
                    println!("Attempting to show and focus window");
                    log::info!(target: "app", "Attempting to show and focus window");
                    if window.is_minimized().unwrap_or(false) {
                        let _ = window.unminimize();
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            Err(e) => {
                println!("Failed to get window visibility: {:?}", e);
                log::error!(target: "app", "Failed to get window visibility: {:?}", e);
            }
        }
    } else {
        println!("No existing window found, creating new window");
        log::info!(target: "app", "No existing window found, creating new window");
        resolve::create_window();
    }
}

// 重启clash
pub fn restart_clash_core() {
    tauri::async_runtime::spawn(async {
        match CoreManager::global().restart_core().await {
            Ok(_) => {
                handle::Handle::refresh_clash();
                handle::Handle::notice_message("set_config::ok", "ok");
            }
            Err(err) => {
                handle::Handle::notice_message("set_config::error", format!("{err}"));
                log::error!(target:"app", "{err}");
            }
        }
    });
}

pub fn restart_app() {
    tauri::async_runtime::spawn_blocking(|| {
        tauri::async_runtime::block_on(async {
            log_err!(CoreManager::global().stop_core().await);
        });
        resolve::resolve_reset();
        let app_handle = handle::Handle::global().app_handle().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(1));
        tauri::process::restart(&app_handle.env());
    });
}

/// 设置窗口状态监控，实时保存窗口位置和大小
pub fn setup_window_state_monitor(app_handle: &tauri::AppHandle) {
    let window = app_handle.get_webview_window("main").unwrap();
    let app_handle_clone = app_handle.clone();
    
    // 监听窗口移动事件
    let app_handle_move = app_handle_clone.clone();
    window.on_window_event(move |event| {
        match event {
            // 窗口移动时保存状态
            tauri::WindowEvent::Moved(_) => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            },
            // 窗口调整大小时保存状态
            tauri::WindowEvent::Resized(_) => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            },
            // 其他可能改变窗口状态的事件
            tauri::WindowEvent::ScaleFactorChanged { .. } => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            },
            // 窗口关闭时保存
            tauri::WindowEvent::CloseRequested { .. } => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            },
            _ => {}
        }
    });
}

// 切换模式 rule/global/direct/script mode
pub fn change_clash_mode(mode: String) {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), mode.clone().into());
    tauri::async_runtime::spawn(async move {
        log::debug!(target: "app", "change clash mode to {mode}");

        match clash_api::patch_configs(&mapping).await {
            Ok(_) => {
                // 更新订阅
                Config::clash().data().patch_config(mapping);

                if Config::clash().data().save_config().is_ok() {
                    handle::Handle::refresh_clash();
                    log_err!(tray::Tray::global().update_menu());
                    log_err!(tray::Tray::global().update_icon(None));
                }
            }
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

// 切换系统代理
pub fn toggle_system_proxy() {
    let enable = Config::verge().draft().enable_system_proxy;
    let enable = enable.unwrap_or(false);

    tauri::async_runtime::spawn(async move {
        match patch_verge(IVerge {
            enable_system_proxy: Some(!enable),
            ..IVerge::default()
        })
        .await
        {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

// 切换代理文件
pub fn toggle_proxy_profile(profile_index: String) {
    tauri::async_runtime::spawn(async move {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        match cmds::patch_profiles_config_by_profile_index(app_handle, profile_index).await {
            Ok(_) => {
                let _ = tray::Tray::global().update_menu();
            }
            Err(err) => {
                log::error!(target: "app", "{err}");
            }
        }
    });
}

// 切换tun模式
pub fn toggle_tun_mode() {
    let enable = Config::verge().data().enable_tun_mode;
    let enable = enable.unwrap_or(false);

    tauri::async_runtime::spawn(async move {
        match patch_verge(IVerge {
            enable_tun_mode: Some(!enable),
            ..IVerge::default()
        })
        .await
        {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

pub fn quit(code: Option<i32>) {
    let app_handle = handle::Handle::global().app_handle().unwrap();
    handle::Handle::global().set_is_exiting();
    resolve::resolve_reset();
    log_err!(handle::Handle::global().get_window().unwrap().close());
    app_handle.exit(code.unwrap_or(0));
}

/// 修改clash的订阅
pub async fn patch_clash(patch: Mapping) -> Result<()> {
    Config::clash().draft().patch_config(patch.clone());

    let res = {
        // 激活订阅
        if patch.get("secret").is_some() || patch.get("external-controller").is_some() {
            Config::generate().await?;
            CoreManager::global().restart_core().await?;
        } else {
            if patch.get("mode").is_some() {
                log_err!(tray::Tray::global().update_menu());
                log_err!(tray::Tray::global().update_icon(None));
            }
            Config::runtime().latest().patch_config(patch);
            CoreManager::global().update_config().await?;
        }
        handle::Handle::refresh_clash();
        <Result<()>>::Ok(())
    };
    match res {
        Ok(()) => {
            Config::clash().apply();
            Config::clash().data().save_config()?;
            Ok(())
        }
        Err(err) => {
            Config::clash().discard();
            Err(err)
        }
    }
}

/// 修改verge的订阅
/// 一般都是一个个的修改
pub async fn patch_verge(patch: IVerge) -> Result<()> {
    Config::verge().draft().patch_config(patch.clone());

    let tun_mode = patch.enable_tun_mode;
    let auto_launch = patch.enable_auto_launch;
    let system_proxy = patch.enable_system_proxy;
    let pac = patch.proxy_auto_config;
    let pac_content = patch.pac_file_content;
    let proxy_bypass = patch.system_proxy_bypass;
    let language = patch.language;
    let mixed_port = patch.verge_mixed_port;
    let lite_mode = patch.enable_lite_mode;
    #[cfg(target_os = "macos")]
    let tray_icon = patch.tray_icon;
    #[cfg(not(target_os = "macos"))]
    let tray_icon: Option<String> = None;
    let common_tray_icon = patch.common_tray_icon;
    let sysproxy_tray_icon = patch.sysproxy_tray_icon;
    let tun_tray_icon = patch.tun_tray_icon;
    #[cfg(not(target_os = "windows"))]
    let redir_enabled = patch.verge_redir_enabled;
    #[cfg(not(target_os = "windows"))]
    let redir_port = patch.verge_redir_port;
    #[cfg(target_os = "linux")]
    let tproxy_enabled = patch.verge_tproxy_enabled;
    #[cfg(target_os = "linux")]
    let tproxy_port = patch.verge_tproxy_port;
    let socks_enabled = patch.verge_socks_enabled;
    let socks_port = patch.verge_socks_port;
    let http_enabled = patch.verge_http_enabled;
    let http_port = patch.verge_port;
    let enable_tray_speed = patch.enable_tray_speed;
    let enable_global_hotkey = patch.enable_global_hotkey;

    let res: std::result::Result<(), anyhow::Error> = {
        let mut should_restart_core = false;
        let mut should_update_clash_config = false;
        let mut should_update_verge_config = false;
        let mut should_update_launch = false;
        let mut should_update_sysproxy = false;
        let mut should_update_systray_icon = false;
        let mut should_update_hotkey = false;
        let mut should_update_systray_menu = false;
        let mut should_update_systray_tooltip = false;

        if tun_mode.is_some() {
            should_update_clash_config = true;
            should_update_systray_menu = true;
            should_update_systray_tooltip = true;
            should_update_systray_icon = true;
        }
        if enable_global_hotkey.is_some() {
            should_update_verge_config = true;
        }
        #[cfg(not(target_os = "windows"))]
        if redir_enabled.is_some() || redir_port.is_some() {
            should_restart_core = true;
        }
        #[cfg(target_os = "linux")]
        if tproxy_enabled.is_some() || tproxy_port.is_some() {
            should_restart_core = true;
        }
        if socks_enabled.is_some()
            || http_enabled.is_some()
            || socks_port.is_some()
            || http_port.is_some()
            || mixed_port.is_some()
        {
            should_restart_core = true;
        }
        if auto_launch.is_some() {
            should_update_launch = true;
        }

        if system_proxy.is_some() {
            should_update_sysproxy = true;
            should_update_systray_menu = true;
            should_update_systray_tooltip = true;
            should_update_systray_icon = true;
        }

        if proxy_bypass.is_some() || pac_content.is_some() || pac.is_some() {
            should_update_sysproxy = true;
        }

        if language.is_some() {
            should_update_systray_menu = true;
        }
        if common_tray_icon.is_some()
            || sysproxy_tray_icon.is_some()
            || tun_tray_icon.is_some()
            || tray_icon.is_some()
        {
            should_update_systray_icon = true;
        }

        if patch.hotkeys.is_some() {
            should_update_hotkey = true;
            should_update_systray_menu = true;
        }

        if enable_tray_speed.is_some() {
            should_update_systray_icon = true;
        }

        if should_restart_core {
            CoreManager::global().restart_core().await?;
        }
        if should_update_clash_config {
            CoreManager::global().update_config().await?;
            handle::Handle::refresh_clash();
        }
        if should_update_verge_config {
            Config::verge().draft().enable_global_hotkey = enable_global_hotkey;
            handle::Handle::refresh_verge();
        }
        if should_update_launch {
            sysopt::Sysopt::global().update_launch()?;
        }

        if should_update_sysproxy {
            sysopt::Sysopt::global().update_sysproxy().await?;
        }

        if should_update_hotkey {
            hotkey::Hotkey::global().update(patch.hotkeys.unwrap())?;
        }

        if should_update_systray_menu {
            tray::Tray::global().update_menu()?;
        }

        if should_update_systray_icon {
            tray::Tray::global().update_icon(None)?;
        }

        if should_update_systray_tooltip {
            tray::Tray::global().update_tooltip()?;
        }

        // 处理轻量模式切换
        if lite_mode.is_some() {
            if let Some(window) = handle::Handle::global().get_window() {
                if lite_mode.unwrap() {
                    // 完全退出 webview 进程
                    window.close()?;  // 先关闭窗口
                    let app_handle = handle::Handle::global().app_handle().unwrap();
                    if let Some(webview) = app_handle.get_webview_window("main") {
                        webview.destroy()?;  // 销毁 webview 进程
                    }
                } else {
                    resolve::create_window();  // 重新创建窗口
                }
            }
        }

        <Result<()>>::Ok(())
    };
    match res {
        Ok(()) => {
            Config::verge().apply();
            Config::verge().data().save_file()?;

            Ok(())
        }
        Err(err) => {
            Config::verge().discard();
            Err(err)
        }
    }
}

/// 更新某个profile
/// 如果更新当前订阅就激活订阅
pub async fn update_profile(uid: String, option: Option<PrfOption>) -> Result<()> {
    println!("[订阅更新] 开始更新订阅 {}", uid);
    
    let url_opt = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let item = profiles.get_item(&uid)?;
        let is_remote = item.itype.as_ref().map_or(false, |s| s == "remote");

        if !is_remote {
            println!("[订阅更新] {} 不是远程订阅，跳过更新", uid);
            None // 非远程订阅直接更新
        } else if item.url.is_none() {
            println!("[订阅更新] {} 缺少URL，无法更新", uid);
            bail!("failed to get the profile item url");
        } else {
            println!("[订阅更新] {} 是远程订阅，URL: {}", uid, item.url.clone().unwrap());
            Some((item.url.clone().unwrap(), item.option.clone()))
        }
    };

    let should_update = match url_opt {
        Some((url, opt)) => {
            println!("[订阅更新] 开始下载新的订阅内容");
            let merged_opt = PrfOption::merge(opt, option);
            let item = PrfItem::from_url(&url, None, None, merged_opt).await?;
            
            println!("[订阅更新] 更新订阅配置");
            let profiles = Config::profiles();
            let mut profiles = profiles.latest();
            profiles.update_item(uid.clone(), item)?;

            let is_current = Some(uid.clone()) == profiles.get_current();
            println!("[订阅更新] 是否为当前使用的订阅: {}", is_current);
            is_current
        }
        None => true,
    };

    if should_update {
        println!("[订阅更新] 更新内核配置");
        match CoreManager::global().update_config().await {
            Ok(_) => {
                println!("[订阅更新] 更新成功");
                handle::Handle::refresh_clash();
            }
            Err(err) => {
                println!("[订阅更新] 更新失败: {}", err);
                handle::Handle::notice_message("set_config::error", format!("{err}"));
                log::error!(target: "app", "{err}");
            }
        }
    }

    Ok(())
}

/// copy env variable
pub fn copy_clash_env() {
    // 从环境变量获取IP地址，默认127.0.0.1
    let clash_verge_rev_ip = env::var("CLASH_VERGE_REV_IP").unwrap_or_else(|_| "127.0.0.1".to_string());
    
    let app_handle = handle::Handle::global().app_handle().unwrap();
    let port = { Config::verge().latest().verge_mixed_port.unwrap_or(7897) };
    let http_proxy = format!("http://{clash_verge_rev_ip}:{}", port);
    let socks5_proxy = format!("socks5://{clash_verge_rev_ip}:{}", port);

    let sh =
        format!("export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}");
    let cmd: String = format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}");
    let ps: String = format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"");
    let nu: String =
        format!("load-env {{ http_proxy: \"{http_proxy}\", https_proxy: \"{http_proxy}\" }}");

    let cliboard = app_handle.clipboard();
    let env_type = { Config::verge().latest().env_type.clone() };
    let env_type = match env_type {
        Some(env_type) => env_type,
        None => {
            #[cfg(not(target_os = "windows"))]
            let default = "bash";
            #[cfg(target_os = "windows")]
            let default = "powershell";

            default.to_string()
        }
    };
    match env_type.as_str() {
        "bash" => cliboard.write_text(sh).unwrap_or_default(),
        "cmd" => cliboard.write_text(cmd).unwrap_or_default(),
        "powershell" => cliboard.write_text(ps).unwrap_or_default(),
        "nushell" => cliboard.write_text(nu).unwrap_or_default(),
        _ => log::error!(target: "app", "copy_clash_env: Invalid env type! {env_type}"),
    };
}

pub async fn test_delay(url: String) -> Result<u32> {
    use tokio::time::{Duration, Instant};
    let mut builder = reqwest::ClientBuilder::new().use_rustls_tls().no_proxy();

    let port = Config::verge()
        .latest()
        .verge_mixed_port
        .unwrap_or(Config::clash().data().get_mixed_port());
    let tun_mode = Config::verge().latest().enable_tun_mode.unwrap_or(false);

    let proxy_scheme = format!("http://127.0.0.1:{port}");

    if !tun_mode {
        if let Ok(proxy) = reqwest::Proxy::http(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
        if let Ok(proxy) = reqwest::Proxy::https(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
    }

    let request = builder
        .timeout(Duration::from_millis(10000))
        .build()?
        .get(url).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0");
    let start = Instant::now();

    let response = request.send().await;
    match response {
        Ok(response) => {
            log::trace!(target: "app", "test_delay response: {:#?}", response);
            if response.status().is_success() {
                Ok(start.elapsed().as_millis() as u32)
            } else {
                Ok(10000u32)
            }
        }
        Err(err) => {
            log::trace!(target: "app", "test_delay error: {:#?}", err);
            Err(err.into())
        }
    }
}

pub async fn create_backup_and_upload_webdav() -> Result<()> {
    let (file_name, temp_file_path) = backup::create_backup().map_err(|err| {
        log::error!(target: "app", "Failed to create backup: {:#?}", err);
        err
    })?;

    if let Err(err) = backup::WebDavClient::global()
        .upload(temp_file_path.clone(), file_name)
        .await
    {
        log::error!(target: "app", "Failed to upload to WebDAV: {:#?}", err);
        return Err(err);
    }

    if let Err(err) = std::fs::remove_file(&temp_file_path) {
        log::warn!(target: "app", "Failed to remove temp file: {:#?}", err);
    }

    Ok(())
}

pub async fn list_wevdav_backup() -> Result<Vec<ListFile>> {
    backup::WebDavClient::global().list().await.map_err(|err| {
        log::error!(target: "app", "Failed to list WebDAV backup files: {:#?}", err);
        err
    })
}

pub async fn delete_webdav_backup(filename: String) -> Result<()> {
    backup::WebDavClient::global()
        .delete(filename)
        .await
        .map_err(|err| {
            log::error!(target: "app", "Failed to delete WebDAV backup file: {:#?}", err);
            err
        })
}

pub async fn restore_webdav_backup(filename: String) -> Result<()> {
    let verge = Config::verge();
    let verge_data = verge.data().clone();
    let webdav_url = verge_data.webdav_url.clone();
    let webdav_username = verge_data.webdav_username.clone();
    let webdav_password = verge_data.webdav_password.clone();

    let backup_storage_path = app_home_dir().unwrap().join(&filename);
    backup::WebDavClient::global()
        .download(filename, backup_storage_path.clone())
        .await
        .map_err(|err| {
            log::error!(target: "app", "Failed to download WebDAV backup file: {:#?}", err);
            err
        })?;

    // extract zip file
    let mut zip = zip::ZipArchive::new(fs::File::open(backup_storage_path.clone())?)?;
    zip.extract(app_home_dir()?)?;

    log_err!(
        patch_verge(IVerge {
            webdav_url,
            webdav_username,
            webdav_password,
            ..IVerge::default()
        })
        .await
    );
    // 最后删除临时文件
    fs::remove_file(backup_storage_path)?;
    Ok(())
}
