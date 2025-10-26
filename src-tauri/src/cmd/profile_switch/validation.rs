use crate::{
    config::Config,
    logging,
    utils::{dirs, logging::Type},
};
use serde_yaml_ng as serde_yaml;
use smartstring::alias::String;
use std::fs;

pub(super) async fn validate_switch_request(task_id: u64, profile_id: &str) -> Result<(), String> {
    logging!(
        info,
        Type::Cmd,
        "Validating profile switch task {} -> {}",
        task_id,
        profile_id
    );

    let profile_key: String = profile_id.into();
    let (file_path, profile_type, is_current, remote_url) = {
        let profiles_guard = Config::profiles().await;
        let latest = profiles_guard.latest_ref();
        let item = latest.get_item(&profile_key).map_err(|err| -> String {
            format!("Target profile {} not found: {}", profile_id, err).into()
        })?;
        (
            item.file.clone().map(|f| f.to_string()),
            item.itype.clone().map(|t| t.to_string()),
            latest
                .current
                .as_ref()
                .map(|current| current.as_str() == profile_id)
                .unwrap_or(false),
            item.url.clone().map(|u| u.to_string()),
        )
    };

    if is_current {
        logging!(
            info,
            Type::Cmd,
            "Switch task {} is targeting the current profile {}; skipping validation",
            task_id,
            profile_id
        );
        return Ok(());
    }

    if matches!(profile_type.as_deref(), Some("remote")) {
        let has_url = remote_url.as_ref().map(|u| !u.is_empty()).unwrap_or(false);
        if !has_url {
            return Err({
                let msg = format!("Remote profile {} is missing a download URL", profile_id);
                msg.into()
            });
        }
    }

    if let Some(file) = file_path {
        let profiles_dir = dirs::app_profiles_dir().map_err(|err| -> String {
            format!("Failed to resolve profiles directory: {}", err).into()
        })?;
        let path = profiles_dir.join(&file);

        let contents = fs::read_to_string(&path).map_err(|err| -> String {
            format!("Failed to read profile file {}: {}", path.display(), err).into()
        })?;

        serde_yaml::from_str::<serde_yaml::Value>(&contents).map_err(|err| -> String {
            format!("Profile YAML parse failed for {}: {}", path.display(), err).into()
        })?;
    }

    Ok(())
}
