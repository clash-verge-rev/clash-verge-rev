use super::effects::{Effect, Effects};
use crate::core::notify::{Refresh, announce};
use crate::{
    config::{
        Config, IVerge,
        snapshot::{capture_config_files, restore_files},
    },
    core::auto_backup::AutoBackupManager,
    core::{
        CoreManager, SilentUpdater, autostart, hotkey, lightweight, logger, manager::ConfigUpdateGuard, proxy_control,
        tray,
    },
};
use anyhow::Result;
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging_error};
use serde_yaml_ng::Mapping;
use std::sync::Arc;
use tokio::sync::MutexGuard;

pub(super) enum Patch<'a> {
    Verge { patch: &'a IVerge, persist: bool },
    Clash(&'a Mapping),
}

async fn ensure_restart(manager: &CoreManager) -> Result<()> {
    Config::generate().await?;
    let previous = manager.current_core_readiness_generation();
    let result = manager.restart_core_during_config_update().await;
    if result.is_ok()
        || manager
            .current_core_readiness_generation()
            .is_some_and(|current| Some(current) != previous)
    {
        Config::runtime().await.apply();
    }
    result?;
    Ok(())
}

async fn ensure_effect(
    effect: Effect,
    patch: &IVerge,
    manager: &CoreManager,
    update: &ConfigUpdateGuard<'_>,
) -> Result<()> {
    match effect {
        Effect::RestartCore => {
            ensure_restart(manager).await?;
        }
        Effect::ClashConfig => {
            manager.update_config_in_patch(update).await?;
        }
        Effect::Autostart => autostart::update_launch().await?,
        Effect::Language => {
            if let Some(language) = &patch.language {
                clash_verge_i18n::set_locale(language.as_str());
            }
        }
        Effect::SystemProxy => {
            let _lifecycle = manager.lifecycle_lock.lock().await;
            // Disabling only writes OS state and must remain available when the Core is stopped.
            if Config::verge()
                .await
                .latest_arc()
                .enable_system_proxy
                .unwrap_or_default()
            {
                manager.apply_proxy_after_start().await?;
            } else {
                proxy_control::apply().await?;
                proxy_control::refresh_guard().await?;
            }
        }
        Effect::Hotkey => {
            if let Some(hotkeys) = &patch.hotkeys {
                hotkey::Hotkey::global().update(hotkeys.to_owned()).await?;
            }
        }
        Effect::TrayMenu => tray::Tray::global().update_menu().await?,
        Effect::TrayIcon => {
            tray::Tray::global()
                .update_icon(&Config::verge().await.latest_arc())
                .await?;
            #[cfg(target_os = "macos")]
            if let Some(enabled) = patch.enable_tray_speed {
                tray::Tray::global().update_speed_task(enabled);
            }
        }
        Effect::TrayTooltip => tray::Tray::global().update_tooltip().await?,
        Effect::TrayClick => tray::Tray::global().update_click_behavior().await?,
        Effect::Lightweight => {
            if patch.enable_auto_light_weight_mode.unwrap_or(false) {
                lightweight::enable_auto_light_weight_mode().await;
            } else {
                lightweight::disable_auto_light_weight_mode();
            }
        }
        Effect::LogLevel => logger::Logger::global().update_log_level(patch.get_log_level())?,
        Effect::LogFile => {
            logger::update_log_config(
                patch.app_log_max_size.unwrap_or(128),
                patch.app_log_max_count.unwrap_or(8),
            )
            .await?;
        }
    }
    Ok(())
}

pub(super) async fn apply(config_write: &MutexGuard<'_, ()>, patch: Patch<'_>, effects: Effects) -> Result<()> {
    let manager = CoreManager::global();
    let update = manager.claim_config_update(config_write)?;
    let clash = Config::clash().await;
    let verge = Config::verge().await;
    let runtime = Config::runtime().await;
    let transaction = match patch {
        Patch::Verge { .. } => DraftTransaction::begin(vec![&verge, &runtime])?,
        Patch::Clash(_) => DraftTransaction::begin(vec![&clash, &runtime])?,
    };
    let original_runtime = runtime.data_arc();
    let mut snapshots = capture_config_files().await?;
    let empty = IVerge::default();
    let verge_patch = match &patch {
        Patch::Verge { patch, .. } => patch,
        Patch::Clash(_) => &empty,
    };
    match &patch {
        Patch::Verge { patch, .. } => verge.edit_draft(|draft| draft.patch_config(patch)),
        Patch::Clash(patch) => clash.edit_draft(|draft| draft.patch_config(patch)),
    }
    let result: Result<()> = async {
        for effect in effects.iter().copied() {
            let result = Box::pin(ensure_effect(effect, verge_patch, manager, &update)).await;
            if matches!(patch, Patch::Clash(_)) && matches!(effect, Effect::TrayMenu | Effect::TrayIcon) {
                // Tray failures must not reject an applied Clash mode change.
                logging_error!(Type::Tray, result);
            } else {
                result?;
            }
        }
        match patch {
            Patch::Verge { persist: true, .. } => verge.latest_arc().save_file().await?,
            Patch::Verge { persist: false, .. } => {}
            Patch::Clash(_) => clash.latest_arc().save_config().await?,
        }
        Ok(())
    }
    .await;
    if let Err(error) = result {
        transaction.rollback();
        if !Arc::ptr_eq(&original_runtime, &runtime.data_arc()) {
            announce(Refresh::Clash);
            // The Core already loaded this runtime; restoring its file would only hide that state.
            let runtime_path = crate::utils::dirs::app_home_dir()?.join(crate::constants::files::RUNTIME_CONFIG);
            snapshots.retain(|snapshot| snapshot.path != runtime_path);
        }
        return match restore_files(&snapshots).await {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(proxy_control::rollback_failure(error, rollback_error)),
        };
    }
    transaction.commit();
    match patch {
        Patch::Verge { patch, .. } => {
            if patch.auto_check_update == Some(false) {
                SilentUpdater::global().discard_pending();
            }
            if effects.contains(&Effect::ClashConfig) {
                announce(Refresh::Clash);
            }
            logging_error!(Type::Backup, AutoBackupManager::global().refresh_settings().await);
            announce(Refresh::Verge);
        }
        Patch::Clash(_) => announce(Refresh::Clash),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn config_claim_is_exclusive_and_released_on_drop() -> Result<()> {
        let write_lock = tokio::sync::Mutex::new(());
        let write = write_lock.lock().await;
        let manager = CoreManager::default();
        let first = manager.claim_config_update(&write)?;
        assert!(manager.claim_config_update(&write).is_err());
        drop(first);
        assert!(manager.claim_config_update(&write).is_ok());
        drop(write);
        Ok(())
    }
}
