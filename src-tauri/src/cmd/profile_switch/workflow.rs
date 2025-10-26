use super::{
    CmdResult,
    state::{
        CURRENT_REQUEST_SEQUENCE, CURRENT_SWITCHING_PROFILE, SWITCH_CLEANUP_TIMEOUT,
        SWITCH_JOB_TIMEOUT, SWITCH_MUTEX, SwitchRequest, SwitchScope,
    },
    validation::validate_switch_request,
};
use crate::cmd::StringifyErr;
use crate::{
    config::{Config, IProfiles, profiles::profiles_save_file_safe},
    core::{CoreManager, handle, tray::Tray},
    logging,
    process::AsyncHandler,
    utils::{dirs, logging::Type},
};
use futures::FutureExt;
use serde_yaml_ng as serde_yaml;
use std::{any::Any, panic::AssertUnwindSafe, sync::atomic::Ordering, time::Duration};
use tokio::{fs as tokio_fs, sync::Mutex, time};

pub(super) async fn run_switch_job(mutex: &'static Mutex<()>, request: &SwitchRequest) -> bool {
    let profile_id = request.profile_id.clone();
    let task_id = request.task_id;
    let notify = request.notify;

    if let Err(err) = validate_switch_request(task_id, &profile_id).await {
        logging!(
            warn,
            Type::Cmd,
            "Validation failed for switch task {} -> {}: {}",
            task_id,
            profile_id,
            err
        );
        handle::Handle::notice_message("config_validate::error", err.clone());
        handle::Handle::notify_profile_switch_finished(profile_id.clone(), false, notify, task_id);
        return false;
    }

    logging!(
        info,
        Type::Cmd,
        "Starting switch task {} for profile {} (notify={})",
        task_id,
        profile_id,
        notify
    );

    let profile_for_patch = profile_id.clone();
    let pipeline = async move {
        let _guard = mutex.lock().await;
        patch_profiles_config_internal(IProfiles {
            current: Some(profile_for_patch),
            items: None,
        })
        .await
    };

    match time::timeout(
        SWITCH_JOB_TIMEOUT,
        AssertUnwindSafe(pipeline).catch_unwind(),
    )
    .await
    {
        Err(_) => {
            logging!(
                error,
                Type::Cmd,
                "Profile switch task {} timed out after {:?}",
                task_id,
                SWITCH_JOB_TIMEOUT
            );
            handle::Handle::notice_message(
                "config_validate::error",
                format!("profile switch timed out: {}", profile_id),
            );
            handle::Handle::notify_profile_switch_finished(
                profile_id.clone(),
                false,
                notify,
                task_id,
            );
            false
        }
        Ok(Err(panic_payload)) => {
            let panic_message = describe_panic_payload(panic_payload.as_ref());
            logging!(
                error,
                Type::Cmd,
                "Panic captured during profile switch task {} ({}): {}",
                task_id,
                profile_id,
                panic_message
            );
            handle::Handle::notice_message(
                "config_validate::panic",
                format!("profile switch panic: {}", profile_id),
            );
            handle::Handle::notify_profile_switch_finished(
                profile_id.clone(),
                false,
                notify,
                task_id,
            );
            false
        }
        Ok(Ok(result)) => match result {
            Ok(success) => {
                handle::Handle::notify_profile_switch_finished(
                    profile_id.clone(),
                    success,
                    notify,
                    task_id,
                );
                close_connections_after_switch(&profile_id).await;
                if notify && success {
                    handle::Handle::notice_message("info", "Profile Switched");
                }
                logging!(
                    info,
                    Type::Cmd,
                    "Profile switch task finished: {} (success={})",
                    profile_id,
                    success
                );
                success
            }
            Err(err) => {
                logging!(
                    error,
                    Type::Cmd,
                    "Profile switch failed ({}): {}",
                    profile_id,
                    err
                );
                handle::Handle::notice_message("config_validate::error", err.clone());
                handle::Handle::notify_profile_switch_finished(
                    profile_id.clone(),
                    false,
                    notify,
                    task_id,
                );
                false
            }
        },
    }
}

pub(super) async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    let mutex = SWITCH_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex.lock().await;
    patch_profiles_config_internal(profiles).await
}

async fn patch_profiles_config_internal(profiles: IProfiles) -> CmdResult<bool> {
    if CURRENT_SWITCHING_PROFILE.load(Ordering::SeqCst) {
        logging!(
            info,
            Type::Cmd,
            "Profile switch already in progress; skipping request"
        );
        return Ok(false);
    }
    let _switch_guard = SwitchScope::begin();

    let current_sequence = CURRENT_REQUEST_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1;
    let target_profile = profiles.current.clone();

    logging!(
        info,
        Type::Cmd,
        "Begin modifying configuration; sequence: {}, target profile: {:?}",
        current_sequence,
        target_profile
    );

    let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
    if current_sequence < latest_sequence {
        logging!(
            info,
            Type::Cmd,
            "Detected a newer request after acquiring the lock (sequence: {} < {}), abandoning current request",
            current_sequence,
            latest_sequence
        );
        return Ok(false);
    }

    let current_profile = Config::profiles().await.latest_ref().current.clone();
    logging!(info, Type::Cmd, "Current profile: {:?}", current_profile);

    if let Some(new_profile) = profiles.current.as_ref()
        && current_profile.as_ref() != Some(new_profile)
    {
        logging!(info, Type::Cmd, "Switching to new profile: {}", new_profile);

        let config_file_result = {
            let profiles_config = Config::profiles().await;
            let profiles_data = profiles_config.latest_ref();
            match profiles_data.get_item(new_profile) {
                Ok(item) => {
                    if let Some(file) = &item.file {
                        let path = dirs::app_profiles_dir().map(|dir| dir.join(file.as_str()));
                        path.ok()
                    } else {
                        None
                    }
                }
                Err(e) => {
                    logging!(
                        error,
                        Type::Cmd,
                        "Failed to load target profile metadata: {}",
                        e
                    );
                    None
                }
            }
        };

        if let Some(file_path) = config_file_result {
            if !file_path.exists() {
                logging!(
                    error,
                    Type::Cmd,
                    "Target profile file does not exist: {}",
                    file_path.display()
                );
                handle::Handle::notice_message(
                    "config_validate::file_not_found",
                    format!("{}", file_path.display()),
                );
                return Ok(false);
            }

            let file_read_result =
                time::timeout(Duration::from_secs(5), tokio_fs::read_to_string(&file_path)).await;

            match file_read_result {
                Ok(Ok(content)) => {
                    let yaml_parse_result = AsyncHandler::spawn_blocking(move || {
                        serde_yaml::from_str::<serde_yaml::Value>(&content)
                    })
                    .await;

                    match yaml_parse_result {
                        Ok(Ok(_)) => {
                            logging!(info, Type::Cmd, "Target profile YAML syntax is valid");
                        }
                        Ok(Err(err)) => {
                            let error_msg = format!(" {err}");
                            logging!(
                                error,
                                Type::Cmd,
                                "Target profile contains YAML syntax errors: {}",
                                error_msg
                            );
                            handle::Handle::notice_message(
                                "config_validate::yaml_syntax_error",
                                error_msg.clone(),
                            );
                            return Ok(false);
                        }
                        Err(join_err) => {
                            let error_msg = format!("YAML parsing task failed: {join_err}");
                            logging!(error, Type::Cmd, "{}", error_msg);
                            handle::Handle::notice_message(
                                "config_validate::yaml_parse_error",
                                error_msg.clone(),
                            );
                            return Ok(false);
                        }
                    }
                }
                Ok(Err(err)) => {
                    let error_msg = format!("Failed to read target profile file: {err}");
                    logging!(error, Type::Cmd, "{}", error_msg);
                    handle::Handle::notice_message(
                        "config_validate::file_read_error",
                        error_msg.clone(),
                    );
                    return Ok(false);
                }
                Err(_) => {
                    let error_msg = "Timed out reading profile file (5s)".to_string();
                    logging!(error, Type::Cmd, "{}", error_msg);
                    handle::Handle::notice_message(
                        "config_validate::file_read_timeout",
                        error_msg.clone(),
                    );
                    return Ok(false);
                }
            }
        }
    }

    let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
    if current_sequence < latest_sequence {
        logging!(
            info,
            Type::Cmd,
            "Detected a newer request before core operation (sequence: {} < {}), abandoning current request",
            current_sequence,
            latest_sequence
        );
        return Ok(false);
    }

    logging!(
        info,
        Type::Cmd,
        "Updating configuration draft, sequence: {}",
        current_sequence
    );

    let current_value = profiles.current.clone();

    let _ = Config::profiles().await.draft_mut().patch_config(profiles);

    let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
    if current_sequence < latest_sequence {
        logging!(
            info,
            Type::Cmd,
            "Detected a newer request before core interaction (sequence: {} < {}), abandoning current request",
            current_sequence,
            latest_sequence
        );
        Config::profiles().await.discard();
        return Ok(false);
    }

    logging!(
        info,
        Type::Cmd,
        "Starting core configuration update, sequence: {}",
        current_sequence
    );
    let update_result = time::timeout(
        Duration::from_secs(30),
        CoreManager::global().update_config(),
    )
    .await;

    match update_result {
        Ok(Ok((true, _))) => {
            let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
            if current_sequence < latest_sequence {
                logging!(
                    info,
                    Type::Cmd,
                    "Detected a newer request after core operation (sequence: {} < {}), ignoring current result",
                    current_sequence,
                    latest_sequence
                );
                Config::profiles().await.discard();
                return Ok(false);
            }

            logging!(
                info,
                Type::Cmd,
                "Configuration update succeeded, sequence: {}",
                current_sequence
            );
            Config::profiles().await.apply();
            handle::Handle::refresh_clash();

            if let Err(e) = Tray::global().update_tooltip().await {
                logging!(
                    warn,
                    Type::Cmd,
                    "Failed to update tray tooltip asynchronously: {}",
                    e
                );
            }

            if let Err(e) = Tray::global().update_menu().await {
                logging!(
                    warn,
                    Type::Cmd,
                    "Failed to update tray menu asynchronously: {}",
                    e
                );
            }

            if let Err(e) = profiles_save_file_safe().await {
                logging!(
                    warn,
                    Type::Cmd,
                    "Failed to persist configuration file asynchronously: {}",
                    e
                );
            }

            if let Some(current) = &current_value {
                logging!(
                    info,
                    Type::Cmd,
                    "Emitting configuration change event to frontend: {}, sequence: {}",
                    current,
                    current_sequence
                );
                handle::Handle::notify_profile_changed(current.clone());
            }

            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(true)
        }
        Ok(Ok((false, error_msg))) => {
            logging!(
                warn,
                Type::Cmd,
                "Configuration validation failed: {}",
                error_msg
            );
            Config::profiles().await.discard();
            if let Some(prev_profile) = current_profile {
                logging!(
                    info,
                    Type::Cmd,
                    "Attempting to restore previous configuration: {}",
                    prev_profile
                );
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                Config::profiles()
                    .await
                    .draft_mut()
                    .patch_config(restore_profiles)
                    .stringify_err()?;
                Config::profiles().await.apply();

                AsyncHandler::spawn(|| async move {
                    if let Err(e) = profiles_save_file_safe().await {
                        logging!(
                            warn,
                            Type::Cmd,
                            "Failed to persist restored configuration asynchronously: {}",
                            e
                        );
                    }
                });

                logging!(
                    info,
                    Type::Cmd,
                    "Successfully restored previous configuration"
                );
            }

            handle::Handle::notice_message("config_validate::error", error_msg.to_string());
            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(false)
        }
        Ok(Err(e)) => {
            logging!(
                warn,
                Type::Cmd,
                "Error occurred during update: {}, sequence: {}",
                e,
                current_sequence
            );
            Config::profiles().await.discard();
            handle::Handle::notice_message("config_validate::boot_error", e.to_string());

            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(false)
        }
        Err(_) => {
            let timeout_msg = "Configuration update timed out (30s); possible validation or core communication stall";
            logging!(
                error,
                Type::Cmd,
                "{}, sequence: {}",
                timeout_msg,
                current_sequence
            );
            Config::profiles().await.discard();

            if let Some(prev_profile) = current_profile {
                logging!(
                    info,
                    Type::Cmd,
                    "Attempting to restore previous configuration after timeout: {}, sequence: {}",
                    prev_profile,
                    current_sequence
                );
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                Config::profiles()
                    .await
                    .draft_mut()
                    .patch_config(restore_profiles)
                    .stringify_err()?;
                Config::profiles().await.apply();
            }

            handle::Handle::notice_message("config_validate::timeout", timeout_msg);
            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(false)
        }
    }
}

async fn close_connections_after_switch(profile_id: &str) {
    match time::timeout(SWITCH_CLEANUP_TIMEOUT, async {
        handle::Handle::mihomo().await.close_all_connections().await
    })
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            logging!(
                warn,
                Type::Cmd,
                "Failed to close connections after profile switch ({}): {}",
                profile_id,
                err
            );
        }
        Err(_) => {
            logging!(
                warn,
                Type::Cmd,
                "Closing connections after profile switch ({}) timed out after {:?}",
                profile_id,
                SWITCH_CLEANUP_TIMEOUT
            );
        }
    }
}

fn describe_panic_payload(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<std::string::String>() {
        message.clone()
    } else {
        "unknown panic".into()
    }
}
