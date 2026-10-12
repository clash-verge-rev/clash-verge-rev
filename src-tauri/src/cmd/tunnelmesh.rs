use super::{CmdResult, StringifyErr as _};
use crate::{
    config::Config,
    core::handle::Handle,
    tunnelmesh::{
        config::{TunnelMeshConfig, TunnelMeshConfigSnapshot},
        manager::{TunnelMeshManager, TunnelMeshStatusSnapshot},
    },
    utils::dirs,
};
use serde::Deserialize;
use std::sync::OnceLock;

static MANAGER: OnceLock<TunnelMeshManager> = OnceLock::new();

fn manager() -> &'static TunnelMeshManager {
    MANAGER.get_or_init(TunnelMeshManager::default)
}

/// Starts the embedded client during application initialization when the user
/// enabled it in verge.yaml. Startup errors are returned to the caller so the
/// app can report them without silently falling back to the tray client.
pub(crate) async fn start_tunnelmesh_if_enabled() -> anyhow::Result<()> {
    let enabled = Config::verge().await.latest_arc().enable_tunnelmesh.unwrap_or(false);
    if !enabled {
        return Ok(());
    }
    let config = TunnelMeshConfig::load_from_app_dir().await?;
    manager().reload(config).await.map(|_| ())
}

#[derive(Debug, Deserialize)]
pub struct TunnelMeshSaveRequest {
    pub config: TunnelMeshConfig,
    /// `None` keeps the stored token; an empty string clears it.
    pub token: Option<String>,
}

#[tauri::command]
pub async fn get_tunnelmesh_config() -> CmdResult<TunnelMeshConfigSnapshot> {
    TunnelMeshConfig::load_from_app_dir()
        .await
        .map(|config| config.redacted_snapshot())
        .stringify_err()
}

#[tauri::command]
pub async fn validate_tunnelmesh_config(request: TunnelMeshSaveRequest) -> CmdResult<TunnelMeshConfigSnapshot> {
    let mut config = request.config;
    if let Some(token) = request.token {
        config.client.token = token;
    } else if config.client.token.is_empty() {
        config.client.token = TunnelMeshConfig::load_from_app_dir()
            .await
            .map_err(super::CommandFailure::plain)?
            .client
            .token;
    }
    config.validate().stringify_err()?;
    Ok(config.redacted_snapshot())
}

#[tauri::command]
pub async fn save_tunnelmesh_config(request: TunnelMeshSaveRequest) -> CmdResult<TunnelMeshConfigSnapshot> {
    let existing = TunnelMeshConfig::load_from_app_dir().await.stringify_err()?;
    let mut config = request.config;
    if let Some(token) = request.token {
        config.client.token = token;
    } else if config.client.token.is_empty() {
        config.client.token = existing.client.token;
    }
    config.validate().stringify_err()?;
    let path = dirs::tunnelmesh_config_path().stringify_err()?;
    let _write_lock = Config::lock_config_write().await;
    config.save(&path).await.stringify_err()?;

    let enabled = Config::verge().await.latest_arc().enable_tunnelmesh.unwrap_or(false);
    if enabled {
        // Listener sockets cannot be rebound while the previous generation is
        // alive. Stop it at the shared write boundary before applying the new
        // validated listener set; a failed candidate is still reported and
        // the persisted file remains the last validated snapshot.
        let _ = manager().stop().await;
        manager().reload(config.clone()).await.stringify_err()?;
        Config::generate().await.stringify_err()?;
        Handle::refresh_clash();
    }
    Ok(config.redacted_snapshot())
}

#[tauri::command]
pub async fn get_tunnelmesh_status() -> CmdResult<TunnelMeshStatusSnapshot> {
    Ok(manager().status().await)
}

#[tauri::command]
pub async fn set_tunnelmesh_enabled(enabled: bool) -> CmdResult<TunnelMeshStatusSnapshot> {
    let config = if enabled {
        let config = TunnelMeshConfig::load_from_app_dir().await.stringify_err()?;
        config.validate().stringify_err()?;
        Some(config)
    } else {
        None
    };

    let _write_lock = Config::lock_config_write().await;
    let verge = Config::verge().await;
    verge.edit_draft(|draft| draft.enable_tunnelmesh = Some(enabled));
    verge.apply();
    verge.data_arc().save_file().await.stringify_err()?;

    let status = if let Some(config) = config {
        manager().reload(config).await.stringify_err()?
    } else {
        manager().stop().await.stringify_err()?
    };
    Config::generate().await.stringify_err()?;
    Handle::refresh_clash();
    Ok(status)
}
