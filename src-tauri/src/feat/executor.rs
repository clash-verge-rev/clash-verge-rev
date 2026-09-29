use super::effects::{Effect, Effects};
use crate::{
    config::{
        Config, IVerge,
        snapshot::{capture_config_files, restore_files},
    },
    core::{CoreManager, autostart, handle::Handle, hotkey, logger, manager::ConfigUpdateGuard, proxy_control, tray},
    module::{auto_backup::AutoBackupManager, lightweight},
};
use anyhow::Result;
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging_error};
use futures::future::BoxFuture;
use serde_yaml_ng::Mapping;
use tokio::sync::MutexGuard;

pub(super) enum Patch<'a> {
    Verge { patch: &'a IVerge, persist: bool },
    Clash(&'a Mapping),
}

struct EffectContext<'a> {
    patch: &'a IVerge,
    manager: &'a CoreManager,
    update: &'a ConfigUpdateGuard<'a>,
}

type Ensure = for<'a> fn(&'a EffectContext<'_>) -> BoxFuture<'a, Result<()>>;

const EFFECT_ORDER: &[(Effect, Ensure)] = &[
    (Effect::RestartCore, ensure_restart),
    (Effect::ClashConfig, ensure_clash),
    (Effect::VergeConfig, ensure_verge),
    (Effect::Autostart, ensure_autostart),
    (Effect::Language, ensure_language),
    (Effect::SystemProxy, ensure_system_proxy),
    (Effect::Hotkey, ensure_hotkey),
    (Effect::TrayMenu, ensure_tray_menu),
    (Effect::TrayIcon, ensure_tray_icon),
    (Effect::TrayTooltip, ensure_tray_tooltip),
    (Effect::TrayClick, ensure_tray_click),
    (Effect::Lightweight, ensure_lightweight),
    (Effect::LogLevel, ensure_log_level),
    (Effect::LogFile, ensure_log_file),
];

macro_rules! ensure {
    ($name:ident, $ctx:ident, $body:block) => {
        fn $name<'a>($ctx: &'a EffectContext<'_>) -> BoxFuture<'a, Result<()>> {
            Box::pin(async move $body)
        }
    };
}

ensure!(ensure_restart, ctx, {
    Config::generate().await?;
    ctx.manager.restart_core_during_config_update().await
});
ensure!(ensure_clash, ctx, {
    ctx.manager.update_config_in_patch(ctx.update).await?;
    Handle::refresh_clash();
    Ok(())
});
ensure!(ensure_verge, _ctx, { Ok(()) });
ensure!(ensure_autostart, _ctx, { autostart::update_launch().await });
ensure!(ensure_language, ctx, {
    if let Some(language) = &ctx.patch.language {
        clash_verge_i18n::set_locale(language.as_str());
    }
    Ok(())
});
ensure!(ensure_system_proxy, ctx, {
    let _lifecycle = ctx.manager.lifecycle_lock.lock().await;
    // Disabling only writes OS state and must remain available when the Core is stopped.
    if Config::verge()
        .await
        .latest_arc()
        .enable_system_proxy
        .unwrap_or_default()
    {
        ctx.manager.apply_proxy_after_start().await
    } else {
        proxy_control::apply().await?;
        proxy_control::refresh_guard().await
    }
});
ensure!(ensure_hotkey, ctx, {
    if let Some(hotkeys) = &ctx.patch.hotkeys {
        hotkey::Hotkey::global().update(hotkeys.to_owned()).await?;
    }
    Ok(())
});
ensure!(ensure_tray_menu, _ctx, { tray::Tray::global().update_menu().await });
ensure!(ensure_tray_icon, ctx, {
    tray::Tray::global()
        .update_icon(&Config::verge().await.latest_arc())
        .await?;
    #[cfg(target_os = "macos")]
    if let Some(enabled) = ctx.patch.enable_tray_speed {
        tray::Tray::global().update_speed_task(enabled);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = ctx;
    Ok(())
});
ensure!(ensure_tray_tooltip, _ctx, {
    tray::Tray::global().update_tooltip().await
});
ensure!(ensure_tray_click, _ctx, {
    tray::Tray::global().update_click_behavior().await
});
ensure!(ensure_lightweight, ctx, {
    if ctx.patch.enable_auto_light_weight_mode.unwrap_or(false) {
        lightweight::enable_auto_light_weight_mode().await;
    } else {
        lightweight::disable_auto_light_weight_mode();
    }
    Ok(())
});
ensure!(ensure_log_level, ctx, {
    logger::Logger::global().update_log_level(ctx.patch.get_log_level())
});
ensure!(ensure_log_file, ctx, {
    logger::update_log_config(
        ctx.patch.app_log_max_size.unwrap_or(128),
        ctx.patch.app_log_max_count.unwrap_or(8),
    )
    .await
});

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
    let snapshots = capture_config_files().await?;
    let empty = IVerge::default();
    let context = EffectContext {
        patch: match &patch {
            Patch::Verge { patch, .. } => patch,
            Patch::Clash(_) => &empty,
        },
        manager,
        update: &update,
    };
    match &patch {
        Patch::Verge { patch, .. } => verge.edit_draft(|draft| draft.patch_config(patch)),
        Patch::Clash(patch) => clash.edit_draft(|draft| draft.patch_config(patch)),
    }
    let result: Result<()> = async {
        for (effect, ensure) in EFFECT_ORDER {
            if effects.contains(effect) {
                ensure(&context).await?;
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
        return match restore_files(&snapshots).await {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(proxy_control::rollback_failure(error, rollback_error)),
        };
    }
    transaction.commit();
    match patch {
        Patch::Verge { .. } => {
            logging_error!(Type::Backup, AutoBackupManager::global().refresh_settings().await);
            Handle::refresh_verge();
        }
        Patch::Clash(_) => Handle::refresh_clash(),
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
