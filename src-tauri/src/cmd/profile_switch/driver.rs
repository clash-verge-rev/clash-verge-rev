use super::{
    CmdResult,
    state::{SwitchCancellation, SwitchManager, SwitchRequest, manager},
    workflow::{self, SwitchPanicInfo, SwitchStage},
};
use crate::{logging, utils::logging::Type};
use futures::FutureExt;
use once_cell::sync::OnceCell;
use smartstring::alias::String as SmartString;
use std::{
    collections::{HashMap, VecDeque},
    panic::AssertUnwindSafe,
    time::Duration,
};
use tokio::{
    sync::{
        mpsc::{self, error::TrySendError},
        oneshot,
    },
    time::{self, MissedTickBehavior},
};

const SWITCH_QUEUE_CAPACITY: usize = 32;
static SWITCH_QUEUE: OnceCell<mpsc::Sender<SwitchDriverMessage>> = OnceCell::new();

const WATCHDOG_TIMEOUT: Duration = Duration::from_secs(5);
const WATCHDOG_TICK: Duration = Duration::from_millis(500);

#[derive(Debug, Default)]
struct SwitchDriverState {
    active: Option<SwitchRequest>,
    queue: VecDeque<SwitchRequest>,
    latest_tokens: HashMap<SmartString, SwitchCancellation>,
    cleanup_profiles: HashMap<SmartString, tokio::task::JoinHandle<()>>,
}

#[derive(Debug)]
enum SwitchDriverMessage {
    Request {
        request: SwitchRequest,
        respond_to: oneshot::Sender<bool>,
    },
    Completion {
        request: SwitchRequest,
        outcome: SwitchJobOutcome,
    },
    CleanupDone {
        profile: SmartString,
    },
}

#[derive(Debug)]
enum SwitchJobOutcome {
    Completed {
        success: bool,
        cleanup: workflow::CleanupHandle,
    },
    Panicked {
        info: SwitchPanicInfo,
        cleanup: workflow::CleanupHandle,
    },
}

pub(super) async fn switch_profile(
    profile_index: impl Into<SmartString>,
    notify_success: bool,
) -> CmdResult<bool> {
    switch_profile_impl(profile_index.into(), notify_success).await
}

async fn switch_profile_impl(profile_index: SmartString, notify_success: bool) -> CmdResult<bool> {
    let manager = manager();
    let sender = switch_driver_sender();

    let request = SwitchRequest::new(
        manager.next_task_id(),
        profile_index.clone(),
        notify_success,
    );

    logging!(
        info,
        Type::Cmd,
        "Queue profile switch task {} -> {} (notify={})",
        request.task_id(),
        profile_index,
        notify_success
    );

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

fn switch_driver_sender() -> &'static mpsc::Sender<SwitchDriverMessage> {
    SWITCH_QUEUE.get_or_init(|| {
        let (tx, mut rx) = mpsc::channel::<SwitchDriverMessage>(SWITCH_QUEUE_CAPACITY);
        let driver_tx = tx.clone();
        tokio::spawn(async move {
            let manager = manager();
            let mut state = SwitchDriverState::default();
            while let Some(message) = rx.recv().await {
                match message {
                    SwitchDriverMessage::Request {
                        request,
                        respond_to,
                    } => {
                        handle_enqueue(&mut state, request, respond_to, driver_tx.clone(), manager);
                    }
                    SwitchDriverMessage::Completion { request, outcome } => {
                        handle_completion(&mut state, request, outcome, driver_tx.clone(), manager);
                    }
                    SwitchDriverMessage::CleanupDone { profile } => {
                        handle_cleanup_done(&mut state, profile, driver_tx.clone(), manager);
                    }
                }
            }
        });
        tx
    })
}

fn handle_enqueue(
    state: &mut SwitchDriverState,
    request: SwitchRequest,
    respond_to: oneshot::Sender<bool>,
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    manager: &'static SwitchManager,
) {
    let mut responder = Some(respond_to);
    let accepted = true;
    let profile_key = request.profile_id().clone();
    let cleanup_pending = state.active.is_none() && !state.cleanup_profiles.is_empty();

    if cleanup_pending && state.cleanup_profiles.contains_key(&profile_key) {
        logging!(
            debug,
            Type::Cmd,
            "Switch task {} -> {} ignored because cleanup is still running",
            request.task_id(),
            profile_key
        );
        if let Some(sender) = responder.take() {
            let _ = sender.send(accepted);
        }
        return;
    }

    if cleanup_pending {
        logging!(
            debug,
            Type::Cmd,
            "Cleanup running for {} profile(s); collapsing pending requests before enqueuing task {} -> {}",
            state.cleanup_profiles.len(),
            request.task_id(),
            profile_key
        );
        drop_pending_requests(state);
    }

    if let Some(previous) = state
        .latest_tokens
        .insert(profile_key.clone(), request.cancel_token().clone())
    {
        previous.cancel();
    }

    if let Some(active) = state.active.as_mut()
        && active.profile_id() == &profile_key
    {
        active.cancel_token().cancel();
        active.merge_notify(request.notify());
        state
            .queue
            .retain(|queued| queued.profile_id() != &profile_key);
        state.queue.push_front(request.clone());
        if let Some(sender) = responder.take() {
            let _ = sender.send(accepted);
        }
        return;
    }

    state
        .queue
        .retain(|queued| queued.profile_id() != &profile_key);

    state.queue.push_back(request.clone());
    if let Some(sender) = responder.take() {
        let _ = sender.send(accepted);
    }

    start_next_job(state, driver_tx, manager);
}

fn handle_completion(
    state: &mut SwitchDriverState,
    request: SwitchRequest,
    outcome: SwitchJobOutcome,
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    manager: &'static SwitchManager,
) {
    match &outcome {
        SwitchJobOutcome::Completed { success, .. } => {
            logging!(
                info,
                Type::Cmd,
                "Switch task {} completed (success={})",
                request.task_id(),
                success
            );
        }
        SwitchJobOutcome::Panicked { info, .. } => {
            logging!(
                error,
                Type::Cmd,
                "Switch task {} panicked at stage {:?}: {}",
                request.task_id(),
                info.stage,
                info.detail
            );
        }
    }

    if let Some(active) = state.active.as_ref()
        && active.task_id() == request.task_id()
    {
        state.active = None;
    }

    if let Some(latest) = state.latest_tokens.get(request.profile_id())
        && latest.same_token(request.cancel_token())
    {
        state.latest_tokens.remove(request.profile_id());
    }

    let cleanup = match outcome {
        SwitchJobOutcome::Completed { cleanup, .. } => cleanup,
        SwitchJobOutcome::Panicked { cleanup, .. } => cleanup,
    };

    track_cleanup(
        state,
        driver_tx.clone(),
        request.profile_id().clone(),
        cleanup,
    );

    start_next_job(state, driver_tx, manager);
}

fn drop_pending_requests(state: &mut SwitchDriverState) {
    while let Some(request) = state.queue.pop_front() {
        discard_request(state, request);
    }
}

fn discard_request(state: &mut SwitchDriverState, request: SwitchRequest) {
    let key = request.profile_id().clone();
    let should_remove = state
        .latest_tokens
        .get(&key)
        .map(|latest| latest.same_token(request.cancel_token()))
        .unwrap_or(false);

    if should_remove {
        state.latest_tokens.remove(&key);
    }

    if !request.cancel_token().is_cancelled() {
        request.cancel_token().cancel();
    }
}

fn start_switch_job(
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    manager: &'static SwitchManager,
    request: SwitchRequest,
) {
    let completion_request = request.clone();
    let heartbeat = request.heartbeat().clone();
    let cancel_token = request.cancel_token().clone();
    let task_id = request.task_id();
    let profile_label = request.profile_id().clone();

    tokio::spawn(async move {
        let mut watchdog_interval = time::interval(WATCHDOG_TICK);
        watchdog_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

        let workflow_fut =
            AssertUnwindSafe(workflow::run_switch_job(manager, request)).catch_unwind();
        tokio::pin!(workflow_fut);

        let job_result = loop {
            tokio::select! {
                res = workflow_fut.as_mut() => {
                    break match res {
                        Ok(Ok(result)) => SwitchJobOutcome::Completed {
                            success: result.success,
                            cleanup: result.cleanup,
                        },
                        Ok(Err(error)) => SwitchJobOutcome::Panicked {
                            info: error.info,
                            cleanup: error.cleanup,
                        },
                        Err(payload) => {
                            let info = SwitchPanicInfo::driver_task(
                                workflow::describe_panic_payload(payload.as_ref()),
                            );
                            let cleanup = workflow::schedule_post_switch_failure(
                                profile_label.clone(),
                                completion_request.notify(),
                                completion_request.task_id(),
                            );
                            SwitchJobOutcome::Panicked { info, cleanup }
                        }
                    };
                }
                _ = watchdog_interval.tick() => {
                    if cancel_token.is_cancelled() {
                        continue;
                    }
                    let elapsed = heartbeat.elapsed();
                    if elapsed > WATCHDOG_TIMEOUT {
                        let stage = SwitchStage::from_code(heartbeat.stage_code())
                            .unwrap_or(SwitchStage::Workflow);
                        logging!(
                            warn,
                            Type::Cmd,
                            "Switch task {} watchdog timeout (profile={} stage={:?}, elapsed={:?}); cancelling",
                            task_id,
                            profile_label.as_str(),
                            stage,
                            elapsed
                        );
                        cancel_token.cancel();
                    }
                }
            }
        };

        if let Err(err) = driver_tx
            .send(SwitchDriverMessage::Completion {
                request: completion_request,
                outcome: job_result,
            })
            .await
        {
            logging!(
                error,
                Type::Cmd,
                "Failed to push switch completion to driver: {}",
                err
            );
        }
    });
}

fn track_cleanup(
    state: &mut SwitchDriverState,
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    profile: SmartString,
    cleanup: workflow::CleanupHandle,
) {
    if let Some(existing) = state.cleanup_profiles.remove(&profile) {
        existing.abort();
    }

    let profile_clone = profile.clone();
    let driver_clone = driver_tx.clone();
    let handle = tokio::spawn(async move {
        let profile_label = profile_clone.clone();
        if let Err(err) = cleanup.await {
            logging!(
                warn,
                Type::Cmd,
                "Cleanup task for profile {} failed: {}",
                profile_label.as_str(),
                err
            );
        }
        if let Err(err) = driver_clone
            .send(SwitchDriverMessage::CleanupDone {
                profile: profile_clone,
            })
            .await
        {
            logging!(
                error,
                Type::Cmd,
                "Failed to push cleanup completion for profile {}: {}",
                profile_label.as_str(),
                err
            );
        }
    });
    state.cleanup_profiles.insert(profile, handle);
}

fn handle_cleanup_done(
    state: &mut SwitchDriverState,
    profile: SmartString,
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    manager: &'static SwitchManager,
) {
    if let Some(handle) = state.cleanup_profiles.remove(&profile) {
        handle.abort();
    }
    start_next_job(state, driver_tx, manager);
}

fn start_next_job(
    state: &mut SwitchDriverState,
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    manager: &'static SwitchManager,
) {
    if state.active.is_some() || !state.cleanup_profiles.is_empty() {
        return;
    }

    while let Some(request) = state.queue.pop_front() {
        if request.cancel_token().is_cancelled() {
            discard_request(state, request);
            continue;
        }

        state.active = Some(request.clone());
        start_switch_job(driver_tx, manager, request);
        break;
    }
}
