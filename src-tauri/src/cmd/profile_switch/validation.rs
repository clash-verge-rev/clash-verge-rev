use crate::{
    config::Config,
    logging,
    process::AsyncHandler,
    utils::{dirs, logging::Type},
};
use serde_yaml_ng as serde_yaml;
use smartstring::alias::String;
use std::time::Duration;
use tokio::{fs as tokio_fs, time};

const YAML_READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Verify that the requested profile exists locally and is well-formed before switching.
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
        // Remote profiles must retain a URL so the subsequent refresh job knows where to download.
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

        let contents = match time::timeout(YAML_READ_TIMEOUT, tokio_fs::read_to_string(&path)).await
        {
            Ok(Ok(contents)) => contents,
            Ok(Err(err)) => {
                return Err(
                    format!("Failed to read profile file {}: {}", path.display(), err).into(),
                );
            }
            Err(_) => {
                return Err(format!(
                    "Timed out reading profile file {} after {:?}",
                    path.display(),
                    YAML_READ_TIMEOUT
                )
                .into());
            }
        };

        let parse_result = AsyncHandler::spawn_blocking(move || {
            serde_yaml::from_str::<serde_yaml::Value>(&contents)
        })
        .await;

        match parse_result {
            Ok(Ok(_)) => {}
            Ok(Err(err)) => {
                return Err(
                    format!("Profile YAML parse failed for {}: {}", path.display(), err).into(),
                );
            }
            Err(join_err) => {
                return Err(format!(
                    "Profile YAML parse task panicked for {}: {}",
                    path.display(),
                    join_err
                )
                .into());
            }
        }
    }

    Ok(())
}
