use crate::{
    config::{Config, IVerge},
    core::{handle, hotkey, sysopt, tray, CoreManager},
    log_err,
    utils::resolve,
};
use anyhow::Result;
use serde_yaml::Mapping;

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

// Define update flags as bitflags for better performance
#[derive(Clone, Copy)]
enum UpdateFlags {
    None = 0,
    RestartCore = 1 << 0,
    ClashConfig = 1 << 1,
    VergeConfig = 1 << 2,
    Launch = 1 << 3,
    SysProxy = 1 << 4,
    SystrayIcon = 1 << 5,
    Hotkey = 1 << 6,
    SystrayMenu = 1 << 7,
    SystrayTooltip = 1 << 8,
    SystrayClickBehavior = 1 << 9,
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
    let tray_event = patch.tray_event;
    let home_cards = patch.home_cards.clone();

    let res: std::result::Result<(), anyhow::Error> = {
        // Initialize with no flags set
        let mut update_flags: i32 = UpdateFlags::None as i32;

        if tun_mode.is_some() {
            update_flags |= UpdateFlags::ClashConfig as i32;
            update_flags |= UpdateFlags::SystrayMenu as i32;
            update_flags |= UpdateFlags::SystrayTooltip as i32;
            update_flags |= UpdateFlags::SystrayIcon as i32;
        }
        if enable_global_hotkey.is_some() || home_cards.is_some() {
            update_flags |= UpdateFlags::VergeConfig as i32;
        }
        #[cfg(not(target_os = "windows"))]
        if redir_enabled.is_some() || redir_port.is_some() {
            update_flags |= UpdateFlags::RestartCore as i32;
        }
        #[cfg(target_os = "linux")]
        if tproxy_enabled.is_some() || tproxy_port.is_some() {
            update_flags |= UpdateFlags::RestartCore as i32;
        }
        if socks_enabled.is_some()
            || http_enabled.is_some()
            || socks_port.is_some()
            || http_port.is_some()
            || mixed_port.is_some()
        {
            update_flags |= UpdateFlags::RestartCore as i32;
        }
        if auto_launch.is_some() {
            update_flags |= UpdateFlags::Launch as i32;
        }

        if system_proxy.is_some() {
            update_flags |= UpdateFlags::SysProxy as i32;
            update_flags |= UpdateFlags::SystrayMenu as i32;
            update_flags |= UpdateFlags::SystrayTooltip as i32;
            update_flags |= UpdateFlags::SystrayIcon as i32;
        }

        if proxy_bypass.is_some() || pac_content.is_some() || pac.is_some() {
            update_flags |= UpdateFlags::SysProxy as i32;
        }

        if language.is_some() {
            update_flags |= UpdateFlags::SystrayMenu as i32;
        }
        if common_tray_icon.is_some()
            || sysproxy_tray_icon.is_some()
            || tun_tray_icon.is_some()
            || tray_icon.is_some()
            || enable_tray_speed.is_some()
        {
            update_flags |= UpdateFlags::SystrayIcon as i32;
        }

        if patch.hotkeys.is_some() {
            update_flags |= UpdateFlags::Hotkey as i32;
            update_flags |= UpdateFlags::SystrayMenu as i32;
        }

        if tray_event.is_some() {
            update_flags |= UpdateFlags::SystrayClickBehavior as i32;
        }

        // Process updates based on flags
        if (update_flags & (UpdateFlags::RestartCore as i32)) != 0 {
            CoreManager::global().restart_core().await?;
        }
        if (update_flags & (UpdateFlags::ClashConfig as i32)) != 0 {
            CoreManager::global().update_config().await?;
            handle::Handle::refresh_clash();
        }
        if (update_flags & (UpdateFlags::VergeConfig as i32)) != 0 {
            Config::verge().draft().enable_global_hotkey = enable_global_hotkey;
            handle::Handle::refresh_verge();
        }
        if (update_flags & (UpdateFlags::Launch as i32)) != 0 {
            sysopt::Sysopt::global().update_launch()?;
        }
        if (update_flags & (UpdateFlags::SysProxy as i32)) != 0 {
            sysopt::Sysopt::global().update_sysproxy().await?;
        }
        if (update_flags & (UpdateFlags::Hotkey as i32)) != 0 {
            hotkey::Hotkey::global().update(patch.hotkeys.unwrap())?;
        }
        if (update_flags & (UpdateFlags::SystrayMenu as i32)) != 0 {
            tray::Tray::global().update_menu()?;
        }
        if (update_flags & (UpdateFlags::SystrayIcon as i32)) != 0 {
            tray::Tray::global().update_icon(None)?;
        }
        if (update_flags & (UpdateFlags::SystrayTooltip as i32)) != 0 {
            tray::Tray::global().update_tooltip()?;
        }
        if (update_flags & (UpdateFlags::SystrayClickBehavior as i32)) != 0 {
            tray::Tray::global().update_click_behavior()?;
        }

        // Handle lite mode switch
        if let Some(enable) = lite_mode {
            if enable {
                handle::Handle::global().destroy_window().ok();
            } else {
                resolve::create_window();
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
