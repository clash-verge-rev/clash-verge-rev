use crate::config::{Config, IVerge};
use crate::core::{handle, hotkey, sysopt, tray, CoreManager};
use crate::log_err;
use crate::utils::resolve;
use anyhow::Result;
use serde_yaml::Mapping;
use tauri::Manager;

/// Patch Clash configuration
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

/// Patch Verge configuration
pub async fn patch_verge(patch: IVerge, not_save_file: bool) -> Result<()> {
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
                    window.close()?; // 先关闭窗口
                    let app_handle = handle::Handle::global().app_handle().unwrap();
                    if let Some(webview) = app_handle.get_webview_window("main") {
                        webview.destroy()?; // 销毁 webview 进程
                    }
                } else {
                    resolve::create_window(); // 重新创建窗口
                }
            }
        }

        <Result<()>>::Ok(())
    };
    match res {
        Ok(()) => {
            Config::verge().apply();
            if !not_save_file {
                Config::verge().data().save_file()?;
            }

            Ok(())
        }
        Err(err) => {
            Config::verge().discard();
            Err(err)
        }
    }
}
