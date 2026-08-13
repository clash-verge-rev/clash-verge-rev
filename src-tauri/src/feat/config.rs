use crate::{
    config::{Config, IVerge},
    core::{CoreManager, autostart, handle, hotkey, logger::Logger, proxy_control::SystemProxyStateUnknown, tray},
    module::{auto_backup::AutoBackupManager, lightweight},
};
use anyhow::Result;
use bitflags::bitflags;
use clash_verge_draft::{DraftTransaction, SharedDraft};
use clash_verge_logging::{Type, logging, logging_error};
use serde_yaml_ng::Mapping;

/// Patch Clash configuration
pub async fn patch_clash(patch: &Mapping) -> Result<()> {
    Config::clash().await.edit_draft(|d| d.patch_config(patch));

    let res = {
        // 激活订阅
        if patch.get("secret").is_some() || patch.get("external-controller").is_some() {
            Config::generate().await?;
            CoreManager::global().restart_core().await?;
        } else if patch.get("allow-lan").is_some() {
            CoreManager::global().update_config_checked().await?;
        } else {
            if patch.get("mode").is_some() {
                tray::Tray::global().update_menu_and_icon().await;
            }
            Config::runtime().await.edit_draft(|d| d.patch_config(patch));
            CoreManager::global().update_config_checked().await?;
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
bitflags! {
     #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
     struct UpdateFlags: u16 {
        const RESTART_CORE = 1 << 0;
        const CLASH_CONFIG = 1 << 1;
        const VERGE_CONFIG = 1 << 2;
        const LAUNCH = 1 << 3;
        const SYS_PROXY = 1 << 4;
        const SYSTRAY_ICON = 1 << 5;
        const HOTKEY = 1 << 6;
        const SYSTRAY_MENU = 1 << 7;
        const SYSTRAY_TOOLTIP = 1 << 8;
        const SYSTRAY_CLICK_BEHAVIOR = 1 << 9;
        const LIGHT_WEIGHT = 1 << 10;
        const LANGUAGE = 1 << 11;
        const LOG_LEVEL = 1 << 12;
        const LOG_FILE = 1 << 13;

        const GROUP_SYS_TRAY = Self::SYSTRAY_MENU.bits()
                             | Self::SYSTRAY_TOOLTIP.bits()
                             | Self::SYSTRAY_ICON.bits();
     }
}

fn determine_update_flags(patch: &IVerge) -> UpdateFlags {
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
    #[cfg(target_os = "macos")]
    let enable_tray_speed = patch.enable_tray_speed;
    #[cfg(not(target_os = "macos"))]
    let enable_tray_speed: Option<bool> = None;
    // let enable_tray_icon = patch.enable_tray_icon;
    let enable_global_hotkey = patch.enable_global_hotkey;
    let tray_event = &patch.tray_event;
    let home_cards = patch.home_cards.as_ref();
    let enable_auto_light_weight = patch.enable_auto_light_weight_mode;
    let enable_external_controller = patch.enable_external_controller;
    let tray_proxy_groups_display_mode = &patch.tray_proxy_groups_display_mode;
    let tray_inline_outbound_modes = patch.tray_inline_outbound_modes;
    let enable_proxy_guard = patch.enable_proxy_guard;
    let proxy_guard_duration = patch.proxy_guard_duration;
    let log_level = &patch.app_log_level;
    let log_max_size = patch.app_log_max_size;
    let log_max_count = patch.app_log_max_count;

    #[cfg(target_os = "windows")]
    let restart_core_needed = socks_enabled.is_some()
        || http_enabled.is_some()
        || socks_port.is_some()
        || http_port.is_some()
        || mixed_port.is_some()
        || enable_external_controller.is_some();
    #[cfg(not(target_os = "windows"))]
    let mut restart_core_needed = socks_enabled.is_some()
        || http_enabled.is_some()
        || socks_port.is_some()
        || http_port.is_some()
        || mixed_port.is_some()
        || enable_external_controller.is_some();
    #[cfg(not(target_os = "windows"))]
    {
        restart_core_needed |= redir_enabled.is_some() || redir_port.is_some();
    }
    #[cfg(target_os = "linux")]
    {
        restart_core_needed |= tproxy_enabled.is_some() || tproxy_port.is_some();
        restart_core_needed |= tun_mode == Some(true);
    }

    let mut update_flags = UpdateFlags::empty();
    if restart_core_needed {
        update_flags.insert(UpdateFlags::RESTART_CORE);
    }
    if tun_mode.is_some() {
        update_flags.insert(UpdateFlags::CLASH_CONFIG | UpdateFlags::GROUP_SYS_TRAY);
    }
    if enable_global_hotkey.is_some() || home_cards.is_some() {
        update_flags.insert(UpdateFlags::VERGE_CONFIG);
    }
    if auto_launch.is_some() {
        update_flags.insert(UpdateFlags::LAUNCH);
    }
    if system_proxy.is_some() {
        update_flags.insert(UpdateFlags::SYS_PROXY | UpdateFlags::GROUP_SYS_TRAY);
    }
    if proxy_bypass.is_some()
        || pac_content.is_some()
        || pac.is_some()
        || enable_proxy_guard.is_some()
        || proxy_guard_duration.is_some()
    {
        update_flags.insert(UpdateFlags::SYS_PROXY);
    }
    if language.is_some() {
        update_flags.insert(UpdateFlags::LANGUAGE | UpdateFlags::SYSTRAY_MENU | UpdateFlags::SYSTRAY_TOOLTIP);
    }
    if common_tray_icon.is_some()
        || sysproxy_tray_icon.is_some()
        || tun_tray_icon.is_some()
        || tray_icon.is_some()
        || enable_tray_speed.is_some()
    {
        update_flags.insert(UpdateFlags::SYSTRAY_ICON);
    }
    if patch.hotkeys.is_some() {
        update_flags.insert(UpdateFlags::HOTKEY | UpdateFlags::SYSTRAY_MENU);
    }
    if tray_event.is_some() {
        update_flags.insert(UpdateFlags::SYSTRAY_CLICK_BEHAVIOR);
    }
    if enable_auto_light_weight.is_some() {
        update_flags.insert(UpdateFlags::LIGHT_WEIGHT);
    }
    if tray_proxy_groups_display_mode.is_some() {
        update_flags.insert(UpdateFlags::SYSTRAY_MENU);
    }
    if log_level.is_some() {
        update_flags.insert(UpdateFlags::LOG_LEVEL);
    }
    if log_max_size.is_some() || log_max_count.is_some() {
        update_flags.insert(UpdateFlags::LOG_FILE);
    }
    if tray_inline_outbound_modes.is_some() {
        update_flags.insert(UpdateFlags::SYSTRAY_MENU);
    }

    update_flags
}

#[allow(clippy::cognitive_complexity)]
async fn process_terminated_flags(update_flags: UpdateFlags, patch: &IVerge) -> Result<()> {
    // Process updates based on flags
    if update_flags.contains(UpdateFlags::RESTART_CORE) {
        Config::generate().await?;
        CoreManager::global().restart_core().await?;
    }
    if update_flags.contains(UpdateFlags::CLASH_CONFIG) {
        CoreManager::global().update_config_checked().await?;
        handle::Handle::refresh_clash();
    }
    if update_flags.contains(UpdateFlags::LAUNCH) {
        autostart::update_launch().await?;
    }
    if update_flags.contains(UpdateFlags::LANGUAGE)
        && let Some(language) = &patch.language
    {
        clash_verge_i18n::set_locale(language.as_str());
    }
    if update_flags.contains(UpdateFlags::SYS_PROXY) {
        let manager = CoreManager::global();
        let _lifecycle = manager.lifecycle_lock.lock().await;
        manager.apply_proxy_after_start().await?;
    }
    if update_flags.contains(UpdateFlags::HOTKEY)
        && let Some(hotkeys) = &patch.hotkeys
    {
        hotkey::Hotkey::global().update(hotkeys.to_owned()).await?;
    }
    if update_flags.contains(UpdateFlags::SYSTRAY_MENU) {
        tray::Tray::global().update_menu().await?;
    }
    if update_flags.contains(UpdateFlags::SYSTRAY_ICON) {
        tray::Tray::global()
            .update_icon(&Config::verge().await.latest_arc())
            .await?;
        #[cfg(target_os = "macos")]
        if patch.enable_tray_speed.is_some() {
            tray::Tray::global().update_speed_task(patch.enable_tray_speed.unwrap_or(false));
        }
    }
    if update_flags.contains(UpdateFlags::SYSTRAY_TOOLTIP) {
        tray::Tray::global().update_tooltip().await?;
    }
    if update_flags.contains(UpdateFlags::SYSTRAY_CLICK_BEHAVIOR) {
        tray::Tray::global().update_click_behavior().await?;
    }
    if update_flags.contains(UpdateFlags::LIGHT_WEIGHT) {
        if patch.enable_auto_light_weight_mode.unwrap_or(false) {
            lightweight::enable_auto_light_weight_mode().await;
        } else {
            lightweight::disable_auto_light_weight_mode();
        }
    }
    if update_flags.contains(UpdateFlags::LOG_LEVEL) {
        Logger::global().update_log_level(patch.get_log_level())?;
    }
    if update_flags.contains(UpdateFlags::LOG_FILE) {
        let log_max_size = patch.app_log_max_size.unwrap_or(128);
        let log_max_count = patch.app_log_max_count.unwrap_or(8);
        Logger::global().update_log_config(log_max_size, log_max_count).await?;
    }
    Ok(())
}

/// Apply a patch to the app's configuration, then re-check anything it can invalidate.
///
/// Today that is TUN, which is a question about the *setting* rather than about the Run State:
/// no Run State transition follows a TUN patch, so the reconciliation that reacts to those
/// would never see it. Switching TUN on from the global hotkey is the case that reaches here —
/// unlike the tray item and the settings switch it is not gated on availability, and the flags
/// the patch raises are answered by a Core reload that changes no Run State at all. Left alone
/// the setting stays on and every surface reports TUN as enabled while nothing carries its
/// traffic.
///
/// The reconciliation writes configuration of its own, so it goes through
/// [`apply_verge_patch`] rather than back through here. That makes the absence of a cycle a
/// property of the call graph rather than of a runtime early-return.
pub async fn patch_verge(patch: &IVerge, not_save_file: bool) -> Result<()> {
    apply_verge_patch(patch, not_save_file).await?;
    if patch.enable_tun_mode.is_some() {
        super::reconcile_tun_availability().await;
    }
    Ok(())
}

/// Apply a patch and nothing else. For callers that are themselves a reconciliation.
pub(super) async fn apply_verge_patch(patch: &IVerge, not_save_file: bool) -> Result<()> {
    let verge = Config::verge().await;
    // Applying the flags can fail, and until now that `?` returned straight out of here past
    // an `if let Err(..) { discard() }` the compiler could never reach — leaving the failed
    // edit sitting in the draft, where every later reader saw a value that was never applied
    // and never written to disk.
    //
    // Claiming the layer is what makes the rollback safe. This function holds its draft across
    // `process_terminated_flags`, which restarts the Core and can take seconds; a second patch
    // arriving in that window used to share the one draft slot, and whichever of the two failed
    // first discarded the other's staged edit too.
    let transaction = DraftTransaction::begin(vec![&verge])?;
    verge.edit_draft(|d| d.patch_config(patch));

    let update_flags = determine_update_flags(patch);
    logging!(debug, Type::Setup, "Determined update flags: {:?}", update_flags);
    if let Err(error) = process_terminated_flags(update_flags, patch).await {
        if !may_commit_system_proxy_disabled(patch, &error) {
            return Err(error);
        }
        // Commit the safe state after a user-requested proxy patch partly lands.
        verge.edit_draft(|d| d.enable_system_proxy = Some(false));
        transaction.commit();
        announce_verge_change();
        // Persist the forced-off value even when the original patch was pre-saved.
        let unsaved = verge.data_arc().save_file().await.err();
        return Err(match unsaved {
            Some(save) => error.context(format!(
                "the system proxy state became unknown and the disabled safety value could not be saved: {save:#}"
            )),
            None => error,
        });
    }
    transaction.commit();
    announce_verge_change();

    logging_error!(Type::Backup, AutoBackupManager::global().refresh_settings().await);
    if !not_save_file {
        // 分离数据获取和异步调用
        let verge_data = verge.data_arc();
        logging!(debug, Type::Setup, "Saving Verge configuration to file...");
        verge_data.save_file().await?;
    }
    Ok(())
}

fn announce_verge_change() {
    handle::Handle::refresh_verge();
}

/// Whether a user proxy patch may commit disabled after a partial write.
fn may_commit_system_proxy_disabled(patch: &IVerge, error: &anyhow::Error) -> bool {
    patch.enable_system_proxy.is_some() && SystemProxyStateUnknown::is_in(error)
}

pub async fn fetch_verge_config() -> Result<SharedDraft<IVerge>> {
    let draft = Config::verge().await;
    let data = draft.data_arc();
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::{IVerge, SystemProxyStateUnknown, may_commit_system_proxy_disabled};

    fn state_unknown() -> anyhow::Error {
        anyhow::anyhow!("networksetup refused")
            .context(SystemProxyStateUnknown)
            .context("failed to apply the system proxy")
    }

    #[test]
    fn the_user_turning_the_proxy_on_gets_it_committed_as_off_when_the_os_ended_up_unknown() {
        let patch = IVerge {
            enable_system_proxy: Some(true),
            ..IVerge::default()
        };

        assert!(may_commit_system_proxy_disabled(&patch, &state_unknown()));
    }

    #[test]
    fn a_patch_about_something_else_never_rewrites_the_proxy_setting() {
        let patch = IVerge {
            enable_tun_mode: Some(true),
            ..IVerge::default()
        };

        assert!(!may_commit_system_proxy_disabled(&patch, &state_unknown()));
    }

    #[test]
    fn nothing_is_committed_when_nothing_is_known_to_have_been_written() {
        let patch = IVerge {
            enable_system_proxy: Some(true),
            ..IVerge::default()
        };
        let refused = anyhow::anyhow!("networksetup refused").context("failed to apply the system proxy");

        assert!(!may_commit_system_proxy_disabled(&patch, &refused));
    }

    #[test]
    fn turning_the_proxy_off_and_failing_that_way_still_commits_off() {
        let patch = IVerge {
            enable_system_proxy: Some(false),
            ..IVerge::default()
        };

        assert!(may_commit_system_proxy_disabled(&patch, &state_unknown()));
    }
}
