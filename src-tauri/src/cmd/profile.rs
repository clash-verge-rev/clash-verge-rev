use super::{CmdResult, StringifyErr, profile_switch};
use crate::{
    config::{
        Config, IProfiles, PrfItem, PrfOption,
        profiles::{
            profiles_append_item_with_filedata_safe, profiles_delete_item_safe,
            profiles_patch_item_safe, profiles_reorder_safe, profiles_save_file_safe,
        },
        profiles_append_item_safe,
    },
    core::{CoreManager, handle, timer::Timer},
    feat, logging, ret_err,
    utils::{dirs, help, logging::Type},
};
use smartstring::alias::String;
use std::time::Duration;

#[tauri::command]
pub async fn get_profiles() -> CmdResult<IProfiles> {
    // Strategy 1: attempt to fetch the latest data quickly
    let latest_result = tokio::time::timeout(Duration::from_millis(500), async {
        let profiles = Config::profiles().await;
        let latest = profiles.latest_ref();
        IProfiles {
            current: latest.current.clone(),
            items: latest.items.clone(),
        }
    })
    .await;

    match latest_result {
        Ok(profiles) => {
            logging!(info, Type::Cmd, "Fetched configuration list successfully");
            return Ok(profiles);
        }
        Err(_) => {
            logging!(
                warn,
                Type::Cmd,
                "Quick configuration fetch timed out (500ms)"
            );
        }
    }

    // Strategy 2: fall back to data() if the quick fetch fails
    let data_result = tokio::time::timeout(Duration::from_secs(2), async {
        let profiles = Config::profiles().await;
        let data = profiles.latest_ref();
        IProfiles {
            current: data.current.clone(),
            items: data.items.clone(),
        }
    })
    .await;

    match data_result {
        Ok(profiles) => {
            logging!(
                info,
                Type::Cmd,
                "Fetched draft configuration list successfully"
            );
            return Ok(profiles);
        }
        Err(join_err) => {
            logging!(
                error,
                Type::Cmd,
                "Draft configuration task failed or timed out: {}",
                join_err
            );
        }
    }

    // Strategy 3: fallback to recreating the configuration
    logging!(
        warn,
        Type::Cmd,
        "All retrieval strategies failed; attempting fallback"
    );

    Ok(IProfiles::new().await)
}

/// Enhance profiles
#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    match feat::enhance_profiles().await {
        Ok(_) => {}
        Err(e) => {
            log::error!(target: "app", "{}", e);
            return Err(e.to_string().into());
        }
    }
    handle::Handle::refresh_clash();
    Ok(())
}

/// Import profile
#[tauri::command]
pub async fn import_profile(url: std::string::String, option: Option<PrfOption>) -> CmdResult {
    logging!(info, Type::Cmd, "[Profile Import] Begin: {}", url);

    // Rely on PrfItem::from_url internal timeout/retry logic instead of wrapping with tokio::time::timeout
    let item = match PrfItem::from_url(&url, None, None, option).await {
        Ok(it) => {
            logging!(
                info,
                Type::Cmd,
                "[Profile Import] Download complete; saving configuration"
            );
            it
        }
        Err(e) => {
            logging!(error, Type::Cmd, "[Profile Import] Download failed: {}", e);
            return Err(format!("Profile import failed: {}", e).into());
        }
    };

    match profiles_append_item_safe(item.clone()).await {
        Ok(_) => match profiles_save_file_safe().await {
            Ok(_) => {
                logging!(
                    info,
                    Type::Cmd,
                    "[Profile Import] Configuration file saved successfully"
                );
            }
            Err(e) => {
                logging!(
                    error,
                    Type::Cmd,
                    "[Profile Import] Failed to save configuration file: {}",
                    e
                );
            }
        },
        Err(e) => {
            logging!(
                error,
                Type::Cmd,
                "[Profile Import] Failed to persist configuration: {}",
                e
            );
            return Err(format!("Profile import failed: {}", e).into());
        }
    }
    // Immediately emit a configuration change notification
    if let Some(uid) = &item.uid {
        logging!(
            info,
            Type::Cmd,
            "[Profile Import] Emitting configuration change event: {}",
            uid
        );
        handle::Handle::notify_profile_changed(uid.clone());
    }

    // Save configuration asynchronously and emit a global notification
    let uid_clone = item.uid.clone();
    if let Some(uid) = uid_clone {
        // Delay notification to ensure the file is fully written
        tokio::time::sleep(Duration::from_millis(100)).await;
        handle::Handle::notify_profile_changed(uid);
    }

    logging!(info, Type::Cmd, "[Profile Import] Completed: {}", url);
    Ok(())
}

/// Reorder profiles
#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    match profiles_reorder_safe(active_id, over_id).await {
        Ok(_) => {
            log::info!(target: "app", "Reordered profiles");
            Ok(())
        }
        Err(err) => {
            log::error!(target: "app", "Failed to reorder profiles: {}", err);
            Err(format!("Failed to reorder profiles: {}", err).into())
        }
    }
}

/// Create a new profile
/// Create a new configuration file
#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    match profiles_append_item_with_filedata_safe(item.clone(), file_data).await {
        Ok(_) => {
            // Emit configuration change notification
            if let Some(uid) = &item.uid {
                logging!(
                    info,
                    Type::Cmd,
                    "[Profile Create] Emitting configuration change event: {}",
                    uid
                );
                handle::Handle::notify_profile_changed(uid.clone());
            }
            Ok(())
        }
        Err(err) => match err.to_string().as_str() {
            "the file already exists" => Err("the file already exists".into()),
            _ => Err(format!("add profile error: {err}").into()),
        },
    }
}

/// Update profile
#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
    match feat::update_profile(index, option, Some(true)).await {
        Ok(_) => Ok(()),
        Err(e) => {
            log::error!(target: "app", "{}", e);
            Err(e.to_string().into())
        }
    }
}

/// Delete profile
#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    println!("delete_profile: {}", index);
    // Use send-safe helper function
    let should_update = profiles_delete_item_safe(index.clone())
        .await
        .stringify_err()?;
    profiles_save_file_safe().await.stringify_err()?;

    if should_update {
        match CoreManager::global().update_config().await {
            Ok(_) => {
                handle::Handle::refresh_clash();
                // Emit configuration change notification
                logging!(
                    info,
                    Type::Cmd,
                    "[Profile Delete] Emitting configuration change event: {}",
                    index
                );
                handle::Handle::notify_profile_changed(index);
            }
            Err(e) => {
                log::error!(target: "app", "{}", e);
                return Err(e.to_string().into());
            }
        }
    }
    Ok(())
}

/// Patch profiles configuration
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    profile_switch::patch_profiles_config(profiles).await
}

/// Patch profiles configuration by profile name
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(profile_index: String) -> CmdResult<bool> {
    profile_switch::patch_profiles_config_by_profile_index(profile_index).await
}

#[tauri::command]
pub async fn switch_profile(profile_index: String, notify_success: bool) -> CmdResult<bool> {
    profile_switch::switch_profile(profile_index, notify_success).await
}

/// Patch a specific profile item
#[tauri::command]
pub async fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    // Check for update_interval changes before saving
    let profiles = Config::profiles().await;
    let should_refresh_timer = if let Ok(old_profile) = profiles.latest_ref().get_item(&index) {
        let old_interval = old_profile.option.as_ref().and_then(|o| o.update_interval);
        let new_interval = profile.option.as_ref().and_then(|o| o.update_interval);
        let old_allow_auto_update = old_profile
            .option
            .as_ref()
            .and_then(|o| o.allow_auto_update);
        let new_allow_auto_update = profile.option.as_ref().and_then(|o| o.allow_auto_update);
        (old_interval != new_interval) || (old_allow_auto_update != new_allow_auto_update)
    } else {
        false
    };

    profiles_patch_item_safe(index.clone(), profile)
        .await
        .stringify_err()?;

    // If the interval or auto-update flag changes, refresh the timer asynchronously
    if should_refresh_timer {
        let index_clone = index.clone();
        crate::process::AsyncHandler::spawn(move || async move {
            logging!(
                info,
                Type::Timer,
                "Timer interval changed; refreshing timer..."
            );
            if let Err(e) = crate::core::Timer::global().refresh().await {
                logging!(error, Type::Timer, "Failed to refresh timer: {}", e);
            } else {
                // After refreshing successfully, emit a custom event without triggering a reload
                crate::core::handle::Handle::notify_timer_updated(index_clone);
            }
        });
    }

    Ok(())
}

/// View profile file
#[tauri::command]
pub async fn view_profile(index: String) -> CmdResult {
    let profiles = Config::profiles().await;
    let profiles_ref = profiles.latest_ref();
    let file = profiles_ref
        .get_item(&index)
        .stringify_err()?
        .file
        .clone()
        .ok_or("the file field is null")?;

    let path = dirs::app_profiles_dir()
        .stringify_err()?
        .join(file.as_str());
    if !path.exists() {
        ret_err!("the file not found");
    }

    help::open_file(path).stringify_err()
}

/// Read profile file contents
#[tauri::command]
pub async fn read_profile_file(index: String) -> CmdResult<String> {
    let profiles = Config::profiles().await;
    let profiles_ref = profiles.latest_ref();
    let item = profiles_ref.get_item(&index).stringify_err()?;
    let data = item.read_file().stringify_err()?;
    Ok(data)
}

/// Get the next update time
#[tauri::command]
pub async fn get_next_update_time(uid: String) -> CmdResult<Option<i64>> {
    let timer = Timer::global();
    let next_time = timer.get_next_update_time(&uid).await;
    Ok(next_time)
}
