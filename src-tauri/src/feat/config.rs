use crate::{
    config::{Config, IVerge},
    core::{CoreManager, handle, hotkey, sysopt, tray},
    logging_error,
    module::{auto_backup::AutoBackupManager, lightweight},
    utils::{draft::SharedBox, logging::Type},
};
use anyhow::Result;
use serde_yaml_ng::Mapping;

/// Patch Clash configuration
pub async fn patch_clash(patch: Mapping) -> Result<()> {
    Config::clash()
        .await
        .edit_draft(|d| d.patch_config(patch.clone()));

    let res = {
        // 激活订阅
        if patch.get("secret").is_some() || patch.get("external-controller").is_some() {
            Config::generate().await?;
            CoreManager::global().restart_core().await?;
        } else {
            if patch.get("mode").is_some() {
                logging_error!(Type::Tray, tray::Tray::global().update_menu().await);
                logging_error!(
                    Type::Tray,
                    tray::Tray::global()
                        .update_icon(&Config::verge().await.data_arc())
                        .await
                );
            }
            Config::runtime()
                .await
                .edit_draft(|d| d.patch_config(patch));
            CoreManager::global().update_config().await?;
        }
        handle::Handle::refresh_clash();
        <Result<()>>::Ok(())
    };
    match res {
        Ok(()) => {
            Config::clash().await.apply();
            // 分离数据获取和异步调用
            let clash_data = Config::clash().await.data_arc();
            clash_data.save_config().await?;
            Ok(())
        }
        Err(err) => {
            Config::clash().await.discard();
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
    LighteWeight = 1 << 10,
}

fn determine_update_flags(patch: &IVerge) -> i32 {
    let mut update_flags: i32 = UpdateFlags::None as i32;

    let tun_mode = patch.enable_tun_mode;
    let auto_launch = patch.enable_auto_launch;
    let system_proxy = patch.enable_system_proxy;
    let pac = patch.proxy_auto_config;
    let pac_content = &patch.pac_file_content;
    let proxy_bypass = &patch.system_proxy_bypass;
    let language = &patch.language;
    let mixed_port = patch.verge_mixed_port;
    #[cfg(target_os = "macos")]
    let tray_icon = &patch.tray_icon;
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
    // let enable_tray_icon = patch.enable_tray_icon;
    let enable_global_hotkey = patch.enable_global_hotkey;
    let tray_event = &patch.tray_event;
    let home_cards = patch.home_cards.clone();
    let enable_auto_light_weight = patch.enable_auto_light_weight_mode;
    let enable_external_controller = patch.enable_external_controller;
    let tray_inline_proxy_groups = patch.tray_inline_proxy_groups;

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
    // || enable_tray_icon.is_some()
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

    if enable_auto_light_weight.is_some() {
        update_flags |= UpdateFlags::LighteWeight as i32;
    }

    if enable_external_controller.is_some() {
        update_flags |= UpdateFlags::RestartCore as i32;
    }

    if tray_inline_proxy_groups.is_some() {
        update_flags |= UpdateFlags::SystrayMenu as i32;
    }

    update_flags
}

#[allow(clippy::cognitive_complexity)]
async fn process_terminated_flags(update_flags: i32, patch: &IVerge) -> Result<()> {
    // Process updates based on flags
    if (update_flags & (UpdateFlags::RestartCore as i32)) != 0 {
        Config::generate().await?;
        CoreManager::global().restart_core().await?;
    }
    if (update_flags & (UpdateFlags::ClashConfig as i32)) != 0 {
        CoreManager::global().update_config().await?;
        handle::Handle::refresh_clash();
    }
    if (update_flags & (UpdateFlags::VergeConfig as i32)) != 0 {
        Config::verge()
            .await
            .edit_draft(|d| d.enable_global_hotkey = patch.enable_global_hotkey);
        handle::Handle::refresh_verge();
    }
    if (update_flags & (UpdateFlags::Launch as i32)) != 0 {
        sysopt::Sysopt::global().update_launch().await?;
    }
    if (update_flags & (UpdateFlags::SysProxy as i32)) != 0 {
        sysopt::Sysopt::global().update_sysproxy().await?;
    }
    if (update_flags & (UpdateFlags::Hotkey as i32)) != 0
        && let Some(hotkeys) = &patch.hotkeys
    {
        hotkey::Hotkey::global().update(hotkeys.to_owned()).await?;
    }
    if (update_flags & (UpdateFlags::SystrayMenu as i32)) != 0 {
        tray::Tray::global().update_menu().await?;
    }
    if (update_flags & (UpdateFlags::SystrayIcon as i32)) != 0 {
        tray::Tray::global()
            .update_icon(&Config::verge().await.latest_arc())
            .await?;
    }
    if (update_flags & (UpdateFlags::SystrayTooltip as i32)) != 0 {
        tray::Tray::global().update_tooltip().await?;
    }
    if (update_flags & (UpdateFlags::SystrayClickBehavior as i32)) != 0 {
        tray::Tray::global().update_click_behavior().await?;
    }
    if (update_flags & (UpdateFlags::LighteWeight as i32)) != 0 {
        if patch.enable_auto_light_weight_mode.unwrap_or(false) {
            lightweight::enable_auto_light_weight_mode().await;
        } else {
            lightweight::disable_auto_light_weight_mode();
        }
    }
    Ok(())
}

pub async fn patch_verge(patch: &IVerge, not_save_file: bool) -> Result<()> {
    Config::verge().await.edit_draft(|d| d.patch_config(patch));

    let update_flags = determine_update_flags(patch);
    let process_flag_result: std::result::Result<(), anyhow::Error> = {
        process_terminated_flags(update_flags, patch).await?;
        Ok(())
    };

    if let Err(err) = process_flag_result {
        Config::verge().await.discard();
        return Err(err);
    }
    Config::verge().await.apply();
    logging_error!(
        Type::Backup,
        AutoBackupManager::global().refresh_settings().await
    );
    if !not_save_file {
        // 分离数据获取和异步调用
        let verge_data = Config::verge().await.data_arc();
        verge_data.save_file().await?;
    }
    Ok(())
}

pub async fn fetch_verge_config() -> Result<SharedBox<IVerge>> {
    let draft = Config::verge().await;
    let data = draft.data_arc();
    Ok(data)
}
