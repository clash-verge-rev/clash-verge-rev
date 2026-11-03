//! Wi-Fi hotspot commands that share the mihomo TUN uplink.

use super::{CmdResult, StringifyErr as _};
use crate::core::hotspot::{HotspotAdapter, HotspotManager, HotspotStartConfig, HotspotStatus};
use serde::Deserialize;

/// The hotspot password is stored encrypted, so the plaintext form value cannot
/// travel through `patch_verge_config` (its deserializer expects ciphertext).
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HotspotConfigPatch {
    pub ssid: std::string::String,
    pub password: std::string::String,
    pub band: std::string::String,
    pub adapter_id: Option<std::string::String>,
    pub auto_start: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn get_hotspot_status() -> CmdResult<HotspotStatus> {
    Ok(HotspotManager::global().status())
}

#[tauri::command]
#[specta::specta]
pub async fn list_hotspot_adapters() -> CmdResult<Vec<HotspotAdapter>> {
    HotspotManager::global().list_adapters().await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn start_hotspot(config: HotspotStartConfig) -> CmdResult<HotspotStatus> {
    HotspotManager::global().start(config).await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn stop_hotspot() -> CmdResult<HotspotStatus> {
    HotspotManager::global().stop().await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn save_hotspot_config(config: HotspotConfigPatch) -> CmdResult<()> {
    platform::save_hotspot_config(config).await
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{CmdResult, HotspotConfigPatch};
    use crate::cmd::{CommandFailure, StringifyErr as _};
    use crate::config::{Config, IVerge};
    use crate::core::hotspot::{HotspotStartConfig, validate_start_config};
    use clash_verge_logging::{Type, logging};
    use smartstring::alias::String;

    pub async fn save_hotspot_config(config: HotspotConfigPatch) -> CmdResult<()> {
        let start = HotspotStartConfig {
            ssid: config.ssid.clone(),
            password: config.password.clone(),
            band: config.band.clone(),
            adapter_id: config.adapter_id.clone(),
        };
        if let Err(error) = validate_start_config(&start) {
            logging!(warn, Type::Config, "hotspot config rejected: {error:#}");
            return Err(CommandFailure::plain(error));
        }

        let ssid: String = config.ssid.into();
        let password: String = config.password.into();
        let band: String = config.band.into();
        let adapter_id: String = config.adapter_id.unwrap_or_default().into();
        let patch = IVerge {
            hotspot_ssid: Some(ssid),
            hotspot_password: Some(password),
            hotspot_band: Some(band),
            hotspot_adapter_id: Some(adapter_id),
            hotspot_auto_start: Some(config.auto_start),
            ..IVerge::default()
        };
        Config::verge().await.edit_draft(|draft| draft.patch_config(&patch));
        Config::verge().await.apply();
        let result = Config::verge().await.data_arc().save_file().await;
        if let Err(error) = &result {
            logging!(warn, Type::Config, "hotspot config save failed: {error:#}");
        }
        result.stringify_err()
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::{CmdResult, HotspotConfigPatch};
    use crate::cmd::CommandFailure;

    pub async fn save_hotspot_config(_config: HotspotConfigPatch) -> CmdResult<()> {
        Err(CommandFailure::plain("the Wi-Fi hotspot is only supported on Windows"))
    }
}
