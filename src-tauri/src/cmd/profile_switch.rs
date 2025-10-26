use super::{CmdResult, StringifyErr};
use crate::{
    config::{Config, IProfiles, profiles::profiles_save_file_safe},
    core::{CoreManager, handle, tray::Tray},
    logging,
    process::AsyncHandler,
    utils::{dirs, logging::Type},
};
use futures::FutureExt;
use once_cell::sync::OnceCell;
use serde_yaml_ng as serde_yaml;
use smartstring::alias::String;
use std::{
    any::Any,
    collections::VecDeque,
    fs,
    panic::AssertUnwindSafe,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tokio::{
    fs as tokio_fs,
    sync::{
        Mutex,
        mpsc::{self, error::TrySendError},
        oneshot,
    },
    time,
};

static SWITCH_MUTEX: OnceCell<Mutex<()>> = OnceCell::new();
static SWITCH_QUEUE: OnceCell<mpsc::Sender<SwitchDriverMessage>> = OnceCell::new();
const SWITCH_QUEUE_CAPACITY: usize = 32;
// Track global request sequence to avoid stale queued execution.
static CURRENT_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static CURRENT_SWITCHING_PROFILE: AtomicBool = AtomicBool::new(false);
static SWITCH_TASK_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const SWITCH_JOB_TIMEOUT: Duration = Duration::from_secs(30);
const SWITCH_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
struct SwitchRequest {
    task_id: u64,
    profile_id: String,
    notify: bool,
}

#[derive(Debug, Default)]
struct SwitchDriverState {
    active: Option<SwitchRequest>,
    queue: VecDeque<SwitchRequest>,
}

#[derive(Debug)]
enum SwitchDriverMessage {
    Request {
        request: SwitchRequest,
        respond_to: oneshot::Sender<bool>,
    },
    Completion {
        request: SwitchRequest,
        success: bool,
    },
}

struct SwitchScope;

impl SwitchScope {
    fn begin() -> Self {
        CURRENT_SWITCHING_PROFILE.store(true, Ordering::SeqCst);
        Self
    }
}

impl Drop for SwitchScope {
    fn drop(&mut self) {
        CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
    }
}

fn switch_driver_sender() -> &'static mpsc::Sender<SwitchDriverMessage> {
    SWITCH_QUEUE.get_or_init(|| {
        let (tx, mut rx) = mpsc::channel::<SwitchDriverMessage>(SWITCH_QUEUE_CAPACITY);
        let driver_tx = tx.clone();
        tokio::spawn(async move {
            let mutex = SWITCH_MUTEX.get_or_init(|| Mutex::new(()));
            let mut state = SwitchDriverState::default();
            while let Some(message) = rx.recv().await {
                match message {
                    SwitchDriverMessage::Request {
                        request,
                        respond_to,
                    } => {
                        let accepted = true;
                        let mut responder = Some(respond_to);

                        if let Some(active) = &mut state.active
                            && active.profile_id == request.profile_id
                        {
                            active.notify |= request.notify;
                            if let Some(sender) = responder.take() {
                                let _ = sender.send(accepted);
                            }
                            continue;
                        }

                        if let Some(existing) = state
                            .queue
                            .iter_mut()
                            .find(|queued| queued.profile_id == request.profile_id)
                        {
                            existing.notify |= request.notify;
                            if let Some(sender) = responder.take() {
                                let _ = sender.send(accepted);
                            }
                            continue;
                        }

                        if state.active.is_none() {
                            state.active = Some(request.clone());
                            if let Some(sender) = responder.take() {
                                let _ = sender.send(accepted);
                            }
                            start_switch_job(driver_tx.clone(), mutex, request);
                        } else {
                            state.queue.push_back(request.clone());
                            if let Some(sender) = responder.take() {
                                let _ = sender.send(accepted);
                            }
                        }
                    }
                    SwitchDriverMessage::Completion { request, success } => {
                        logging!(
                            info,
                            Type::Cmd,
                            "Switch task {} completed (success={})",
                            request.task_id,
                            success
                        );
                        if let Some(active) = &state.active
                            && active.task_id == request.task_id
                        {
                            state.active = None;
                        }
                        if state.active.is_none()
                            && let Some(next) = state.queue.pop_front()
                        {
                            state.active = Some(next.clone());
                            start_switch_job(driver_tx.clone(), mutex, next);
                        }
                    }
                }
            }
        });
        tx
    })
}

fn start_switch_job(
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    mutex: &'static Mutex<()>,
    request: SwitchRequest,
) {
    AsyncHandler::spawn(move || async move {
        let success = run_switch_job(mutex, &request).await;
        let task_id = request.task_id;
        let profile_id = request.profile_id.clone();
        if let Err(err) = driver_tx
            .send(SwitchDriverMessage::Completion { request, success })
            .await
        {
            logging!(
                error,
                Type::Cmd,
                "Failed to push switch completion to driver (task={} profile={}): {}",
                task_id,
                profile_id,
                err
            );
        }
    });
}

async fn run_switch_job(mutex: &'static Mutex<()>, request: &SwitchRequest) -> bool {
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
        (*message).to_string().into()
    } else if let Some(message) = payload.downcast_ref::<std::string::String>() {
        message.clone().into()
    } else {
        "unknown panic".into()
    }
}

pub(super) async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    let mutex = SWITCH_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex.lock().await;
    patch_profiles_config_internal(profiles).await
}

pub(super) async fn patch_profiles_config_by_profile_index(
    profile_index: String,
) -> CmdResult<bool> {
    switch_profile(profile_index, false).await
}

pub(super) async fn switch_profile(profile_index: String, notify_success: bool) -> CmdResult<bool> {
    let sender = switch_driver_sender();

    let task_id = SWITCH_TASK_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1;
    logging!(
        info,
        Type::Cmd,
        "Queue profile switch task {} -> {} (notify={})",
        task_id,
        profile_index,
        notify_success
    );
    let request = SwitchRequest {
        task_id,
        profile_id: profile_index.clone(),
        notify: notify_success,
    };
    let (tx, rx) = oneshot::channel();

    match sender.try_send(SwitchDriverMessage::Request {
        request,
        respond_to: tx,
    }) {
        Ok(_) => match rx.await {
            Ok(result) => Ok(result),
            Err(err) => {
                logging!(
                    error,
                    Type::Cmd,
                    "Failed to receive enqueue result for profile {}: {}",
                    profile_index,
                    err
                );
                Err("switch profile queue unavailable".into())
            }
        },
        Err(TrySendError::Full(msg)) => {
            logging!(
                warn,
                Type::Cmd,
                "Profile switch queue is full; waiting for space: {}",
                profile_index
            );
            match sender.send(msg).await {
                Ok(_) => match rx.await {
                    Ok(result) => Ok(result),
                    Err(err) => {
                        logging!(
                            error,
                            Type::Cmd,
                            "Failed to receive enqueue result after wait for {}: {}",
                            profile_index,
                            err
                        );
                        Err("switch profile queue unavailable".into())
                    }
                },
                Err(err) => {
                    logging!(
                        error,
                        Type::Cmd,
                        "Profile switch queue closed while waiting ({}): {}",
                        profile_index,
                        err
                    );
                    Err("switch profile queue unavailable".into())
                }
            }
        }
        Err(TrySendError::Closed(_)) => {
            logging!(
                error,
                Type::Cmd,
                "Profile switch queue is closed, cannot enqueue: {}",
                profile_index
            );
            Err("switch profile queue unavailable".into())
        }
    }
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

    // Assign a sequence number to the current request
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

    // Save the current configuration so it can be restored if validation fails
    let current_profile = Config::profiles().await.latest_ref().current.clone();
    logging!(info, Type::Cmd, "Current profile: {:?}", current_profile);

    // Before switching, validate the target profile for syntax errors
    if let Some(new_profile) = profiles.current.as_ref()
        && current_profile.as_ref() != Some(new_profile)
    {
        logging!(info, Type::Cmd, "Switching to new profile: {}", new_profile);

        // Resolve the target profile file path
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

        // If we have a file path, validate YAML syntax
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

            // Timeout guard
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

    // Validate the request after acquiring the lock
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

    // Update profiles configuration
    logging!(
        info,
        Type::Cmd,
        "Updating configuration draft, sequence: {}",
        current_sequence
    );

    let current_value = profiles.current.clone();

    let _ = Config::profiles().await.draft_mut().patch_config(profiles);

    // Before invoking the core, validate the request again
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

    // Add timeout protection for the configuration update
    logging!(
        info,
        Type::Cmd,
        "Starting core configuration update, sequence: {}",
        current_sequence
    );
    let update_result = time::timeout(
        Duration::from_secs(30), // 30-second timeout
        CoreManager::global().update_config(),
    )
    .await;

    // Apply the configuration and validate the result
    match update_result {
        Ok(Ok((true, _))) => {
            // After the core operation completes, verify the request again
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

            // Force refresh proxy cache to ensure the latest nodes are fetched after switching
            // crate::process::AsyncHandler::spawn(|| async move {
            //     if let Err(e) = super::proxy::force_refresh_proxies().await {
            //         log::warn!(target: "app", "Failed to force refresh proxy cache: {e}");
            //     }
            // });

            if let Err(e) = Tray::global().update_tooltip().await {
                log::warn!(target: "app", "Failed to update tray tooltip asynchronously: {e}");
            }

            if let Err(e) = Tray::global().update_menu().await {
                log::warn!(target: "app", "Failed to update tray menu asynchronously: {e}");
            }

            // Persist configuration file
            if let Err(e) = profiles_save_file_safe().await {
                log::warn!(target: "app", "Failed to persist configuration file asynchronously: {e}");
            }

            // Immediately notify the frontend about the configuration change
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
            // If validation fails, restore the previous configuration
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
                // Restore silently without triggering validation
                Config::profiles()
                    .await
                    .draft_mut()
                    .patch_config(restore_profiles)
                    .stringify_err()?;
                Config::profiles().await.apply();

                crate::process::AsyncHandler::spawn(|| async move {
                    if let Err(e) = profiles_save_file_safe().await {
                        log::warn!(target: "app", "Failed to persist restored configuration asynchronously: {e}");
                    }
                });

                logging!(
                    info,
                    Type::Cmd,
                    "Successfully restored previous configuration"
                );
            }

            // Emit validation error notification
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
            // Timeout handling
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

/// Validate profile switch request before queueing.
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
