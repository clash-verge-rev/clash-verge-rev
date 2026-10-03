use crate::{
    config::{Config, IVerge},
    core::{autostart, hotkey, lightweight, tray},
};
use anyhow::Result;
use futures::future::BoxFuture;

pub(crate) fn ensure_autostart(_patch: &IVerge) -> BoxFuture<'_, Result<()>> {
    Box::pin(async move { autostart::update_launch().await })
}

pub(crate) fn ensure_hotkey(patch: &IVerge) -> BoxFuture<'_, Result<()>> {
    Box::pin(async move {
        if let Some(hotkeys) = &patch.hotkeys {
            hotkey::Hotkey::global().update(hotkeys.to_owned()).await?;
        }
        Ok(())
    })
}

pub(crate) fn ensure_tray_menu(_patch: &IVerge) -> BoxFuture<'_, Result<()>> {
    Box::pin(async move { tray::Tray::global().update_menu().await })
}

pub(crate) fn ensure_tray_icon(patch: &IVerge) -> BoxFuture<'_, Result<()>> {
    Box::pin(async move {
        tray::Tray::global()
            .update_icon(&Config::verge().await.latest_arc())
            .await?;
        #[cfg(target_os = "macos")]
        if let Some(enabled) = patch.enable_tray_speed {
            tray::Tray::global().update_speed_task(enabled);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = patch;
        Ok(())
    })
}

pub(crate) fn ensure_tray_tooltip(_patch: &IVerge) -> BoxFuture<'_, Result<()>> {
    Box::pin(async move { tray::Tray::global().update_tooltip().await })
}

pub(crate) fn ensure_tray_click(_patch: &IVerge) -> BoxFuture<'_, Result<()>> {
    Box::pin(async move { tray::Tray::global().update_click_behavior().await })
}

pub(crate) fn ensure_lightweight(patch: &IVerge) -> BoxFuture<'_, Result<()>> {
    Box::pin(async move {
        if patch.enable_auto_light_weight_mode.unwrap_or(false) {
            lightweight::enable_auto_light_weight_mode().await;
        } else {
            lightweight::disable_auto_light_weight_mode();
        }
        Ok(())
    })
}
