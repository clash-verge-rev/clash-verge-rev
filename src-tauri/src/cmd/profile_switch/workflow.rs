use super::{
    CmdResult,
    state::{SWITCH_CLEANUP_TIMEOUT, SWITCH_JOB_TIMEOUT, SwitchManager, SwitchRequest, manager},
    validation::validate_switch_request,
};
use crate::cmd::StringifyErr;
use crate::{
    config::{Config, IProfiles, profiles::profiles_save_file_safe},
    core::handle,
    logging,
    process::AsyncHandler,
    utils::{dirs, logging::Type},
};
use futures::FutureExt;
use serde_yaml_ng as serde_yaml;
use smartstring::alias::String as SmartString;
use std::{any::Any, panic::AssertUnwindSafe, time::Duration};
use tokio::{fs as tokio_fs, time};

mod state_machine;

use state_machine::SwitchStateMachine;

pub(super) async fn run_switch_job(
    manager: &'static SwitchManager,
    request: SwitchRequest,
) -> bool {
    if request.cancel_token().is_cancelled() {
        logging!(
            info,
            Type::Cmd,
            "Switch task {} cancelled before validation",
            request.task_id()
        );
        handle::Handle::notify_profile_switch_finished(
            request.profile_id().clone(),
            false,
            request.notify(),
            request.task_id(),
        );
        return false;
    }

    let profile_id = request.profile_id().clone();
    let task_id = request.task_id();
    let notify = request.notify();

    if let Err(err) = validate_switch_request(task_id, profile_id.as_str()).await {
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

    let pipeline_request = request;
    let pipeline = async move {
        let target_profile = pipeline_request.profile_id().clone();
        SwitchStateMachine::new(
            manager,
            Some(pipeline_request),
            IProfiles {
                current: Some(target_profile),
                items: None,
            },
        )
        .run()
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
    SwitchStateMachine::new(manager(), None, profiles)
        .run()
        .await
}

pub(super) async fn validate_profile_yaml(profile: &SmartString) -> CmdResult<bool> {
    let file_path = {
        let profiles_guard = Config::profiles().await;
        let profiles_data = profiles_guard.latest_ref();
        match profiles_data.get_item(profile) {
            Ok(item) => item.file.as_ref().and_then(|file| {
                dirs::app_profiles_dir()
                    .ok()
                    .map(|dir| dir.join(file.as_str()))
            }),
            Err(e) => {
                logging!(
                    error,
                    Type::Cmd,
                    "Failed to load target profile metadata: {}",
                    e
                );
                return Ok(false);
            }
        }
    };

    let Some(path) = file_path else {
        return Ok(true);
    };

    if !path.exists() {
        logging!(
            error,
            Type::Cmd,
            "Target profile file does not exist: {}",
            path.display()
        );
        handle::Handle::notice_message(
            "config_validate::file_not_found",
            format!("{}", path.display()),
        );
        return Ok(false);
    }

    let file_read_result =
        time::timeout(Duration::from_secs(5), tokio_fs::read_to_string(&path)).await;

    match file_read_result {
        Ok(Ok(content)) => {
            let yaml_parse_result = AsyncHandler::spawn_blocking(move || {
                serde_yaml::from_str::<serde_yaml::Value>(&content)
            })
            .await;

            match yaml_parse_result {
                Ok(Ok(_)) => {
                    logging!(info, Type::Cmd, "Target profile YAML syntax is valid");
                    Ok(true)
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
                    Ok(false)
                }
                Err(join_err) => {
                    let error_msg = format!("YAML parsing task failed: {join_err}");
                    logging!(error, Type::Cmd, "{}", error_msg);
                    handle::Handle::notice_message(
                        "config_validate::yaml_parse_error",
                        error_msg.clone(),
                    );
                    Ok(false)
                }
            }
        }
        Ok(Err(err)) => {
            let error_msg = format!("Failed to read target profile file: {err}");
            logging!(error, Type::Cmd, "{}", error_msg);
            handle::Handle::notice_message("config_validate::file_read_error", error_msg.clone());
            Ok(false)
        }
        Err(_) => {
            let error_msg = "Timed out reading profile file (5s)".to_string();
            logging!(error, Type::Cmd, "{}", error_msg);
            handle::Handle::notice_message("config_validate::file_read_timeout", error_msg.clone());
            Err(error_msg.into())
        }
    }
}

pub(super) async fn restore_previous_profile(previous: Option<SmartString>) -> CmdResult<()> {
    if let Some(prev_profile) = previous {
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
    }

    Ok(())
}

async fn close_connections_after_switch(profile_id: &SmartString) {
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
