use super::CmdResult;
use super::StringifyErr;
use super::profile_switch::validate_switch_request;
use crate::{
    config::{
        Config, IProfiles, PrfItem, PrfOption,
        profiles::{
            profiles_append_item_with_filedata_safe, profiles_delete_item_safe,
            profiles_patch_item_safe, profiles_reorder_safe, profiles_save_file_safe,
        },
        profiles_append_item_safe,
    },
    core::{CoreManager, handle, timer::Timer, tray::Tray},
    feat, logging,
    process::AsyncHandler,
    ret_err,
    utils::{dirs, help, logging::Type},
};
use futures::FutureExt;
use once_cell::sync::OnceCell;

use smartstring::alias::String;
use std::{
    any::Any,
    collections::VecDeque,
    panic::AssertUnwindSafe,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tokio::sync::{
    Mutex,
    mpsc::{self, error::TrySendError},
    oneshot,
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

    match tokio::time::timeout(
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
    match tokio::time::timeout(SWITCH_CLEANUP_TIMEOUT, async {
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
            let file_read_result = tokio::time::timeout(
                Duration::from_secs(5),
                tokio::fs::read_to_string(&file_path),
            )
            .await;

            match file_read_result {
                Ok(Ok(content)) => {
                    let yaml_parse_result = AsyncHandler::spawn_blocking(move || {
                        serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&content)
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
    let update_result = tokio::time::timeout(
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

/// Patch profiles configuration by profile name
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(profile_index: String) -> CmdResult<bool> {
    switch_profile(profile_index, false).await
}

#[tauri::command]
pub async fn switch_profile(profile_index: String, notify_success: bool) -> CmdResult<bool> {
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
