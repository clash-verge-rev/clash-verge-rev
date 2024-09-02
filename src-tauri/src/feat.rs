//！
//! feat mod 里的函数主要用于
//! - hotkey 快捷键
//! - timer 定时器
//! - cmds 页面调用
//!
use crate::config::*;
use crate::core::*;
use crate::log_err;
use crate::utils::resolve;
use anyhow::{bail, Result};
use serde_yaml::{Mapping, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

// 打开面板
pub fn open_or_close_dashboard() {
    let handle = handle::Handle::global();
    let app_handle = handle.app_handle.lock();
    if let Some(app_handle) = app_handle.as_ref() {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Ok(true) = window.is_focused() {
                let _ = window.close();
                return;
            }
        }
        resolve::create_window(app_handle);
    }
}

// 重启clash
pub fn restart_clash_core() {
    tauri::async_runtime::spawn(async {
        match CoreManager::global().run_core().await {
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
                    log_err!(handle::Handle::update_systray_part());
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

/// 修改clash的订阅
pub async fn patch_clash(patch: Mapping) -> Result<()> {
    Config::clash().draft().patch_config(patch.clone());

    let res = {
        // 激活订阅
        if patch.get("secret").is_some() || patch.get("external-controller").is_some() {
            Config::generate().await?;
            CoreManager::global().run_core().await?;
            handle::Handle::refresh_clash();
        }

        if patch.get("mode").is_some() {
            log_err!(handle::Handle::update_systray_part());
        }

        Config::runtime().latest().patch_config(patch);

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
    #[cfg(target_os = "macos")]
    let tray_icon = patch.tray_icon;
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
    let res = {
        let service_mode = patch.enable_service_mode;
        let mut generated = false;
        if service_mode.is_some() {
            log::debug!(target: "app", "change service mode to {}", service_mode.unwrap());
            if !generated {
                Config::generate().await?;
                CoreManager::global().run_core().await?;
                generated = true;
            }
        } else if tun_mode.is_some() {
            update_core_config().await?;
        }
        #[cfg(not(target_os = "windows"))]
        if redir_enabled.is_some() || redir_port.is_some() {
            if !generated {
                Config::generate().await?;
                CoreManager::global().run_core().await?;
                generated = true;
            }
        }
        #[cfg(target_os = "linux")]
        if tproxy_enabled.is_some() || tproxy_port.is_some() {
            if !generated {
                Config::generate().await?;
                CoreManager::global().run_core().await?;
                generated = true;
            }
        }
        if socks_enabled.is_some()
            || http_enabled.is_some()
            || socks_port.is_some()
            || http_port.is_some()
            || mixed_port.is_some()
        {
            if !generated {
                Config::generate().await?;
                CoreManager::global().run_core().await?;
            }
        }
        if auto_launch.is_some() {
            sysopt::Sysopt::global().update_launch()?;
        }
        if system_proxy.is_some()
            || proxy_bypass.is_some()
            || mixed_port.is_some()
            || pac.is_some()
            || pac_content.is_some()
        {
            sysopt::Sysopt::global().update_sysproxy()?;
            sysopt::Sysopt::global().guard_proxy();
        }

        if let Some(true) = patch.enable_proxy_guard {
            sysopt::Sysopt::global().guard_proxy();
        }

        if let Some(hotkeys) = patch.hotkeys {
            hotkey::Hotkey::global().update(hotkeys)?;
        }

        if language.is_some() {
            handle::Handle::update_systray()?;
        } else if system_proxy.is_some()
            || tun_mode.is_some()
            || common_tray_icon.is_some()
            || sysproxy_tray_icon.is_some()
            || tun_tray_icon.is_some()
        {
            handle::Handle::update_systray_part()?;
        }
        #[cfg(target_os = "macos")]
        if tray_icon.is_some() {
            handle::Handle::update_systray_part()?;
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
    let url_opt = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let item = profiles.get_item(&uid)?;
        let is_remote = item.itype.as_ref().map_or(false, |s| s == "remote");

        if !is_remote {
            None // 直接更新
        } else if item.url.is_none() {
            bail!("failed to get the profile item url");
        } else {
            Some((item.url.clone().unwrap(), item.option.clone()))
        }
    };

    let should_update = match url_opt {
        Some((url, opt)) => {
            let merged_opt = PrfOption::merge(opt, option);
            let item = PrfItem::from_url(&url, None, None, merged_opt).await?;
            let profiles = Config::profiles();
            let mut profiles = profiles.latest();
            profiles.update_item(uid.clone(), item)?;

            Some(uid) == profiles.get_current()
        }
        None => true,
    };

    if should_update {
        update_core_config().await?;
    }

    Ok(())
}

/// 更新订阅
async fn update_core_config() -> Result<()> {
    match CoreManager::global().update_config().await {
        Ok(_) => {
            handle::Handle::refresh_clash();
            handle::Handle::notice_message("set_config::ok", "ok");
            Ok(())
        }
        Err(err) => {
            handle::Handle::notice_message("set_config::error", format!("{err}"));
            Err(err)
        }
    }
}

/// copy env variable
pub fn copy_clash_env(app_handle: &AppHandle) {
    let port = { Config::verge().latest().verge_mixed_port.unwrap_or(7897) };
    let http_proxy = format!("http://127.0.0.1:{}", port);
    let socks5_proxy = format!("socks5://127.0.0.1:{}", port);

    let sh =
        format!("export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}");
    let cmd: String = format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}");
    let ps: String = format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"");

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
