use super::{
    CmdResult,
    state::{
        ProfileSwitchStatus, SwitchCancellation, SwitchManager, SwitchRequest, SwitchResultStatus,
        SwitchTaskStatus, current_millis, manager,
    },
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
        Mutex as AsyncMutex,
        mpsc::{self, error::TrySendError},
        oneshot,
    },
    time::{self, MissedTickBehavior},
};

const SWITCH_QUEUE_CAPACITY: usize = 32;
static SWITCH_QUEUE: OnceCell<mpsc::Sender<SwitchDriverMessage>> = OnceCell::new();

type CompletionRegistry = AsyncMutex<HashMap<u64, oneshot::Sender<SwitchResultStatus>>>;

static SWITCH_COMPLETION_WAITERS: OnceCell<CompletionRegistry> = OnceCell::new();

fn completion_waiters() -> &'static CompletionRegistry {
    SWITCH_COMPLETION_WAITERS.get_or_init(|| AsyncMutex::new(HashMap::new()))
}

async fn register_completion_waiter(task_id: u64) -> oneshot::Receiver<SwitchResultStatus> {
    let (sender, receiver) = oneshot::channel();
    let mut guard = completion_waiters().lock().await;
    if guard.insert(task_id, sender).is_some() {
        logging!(
            warn,
            Type::Cmd,
            "Replacing existing completion waiter for task {}",
            task_id
        );
    }
    receiver
}

async fn remove_completion_waiter(task_id: u64) -> Option<oneshot::Sender<SwitchResultStatus>> {
    completion_waiters().lock().await.remove(&task_id)
}

fn notify_completion_waiter(task_id: u64, result: SwitchResultStatus) {
    tokio::spawn(async move {
        let sender = completion_waiters().lock().await.remove(&task_id);
        if let Some(sender) = sender {
            let _ = sender.send(result);
        }
    });
}

const WATCHDOG_TIMEOUT: Duration = Duration::from_secs(5);
const WATCHDOG_TICK: Duration = Duration::from_millis(500);

#[derive(Debug, Default)]
struct SwitchDriverState {
    active: Option<SwitchRequest>,
    queue: VecDeque<SwitchRequest>,
    latest_tokens: HashMap<SmartString, SwitchCancellation>,
    cleanup_profiles: HashMap<SmartString, tokio::task::JoinHandle<()>>,
    last_result: Option<SwitchResultStatus>,
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
    switch_profile_impl(profile_index.into(), notify_success, false).await
}

pub(super) async fn switch_profile_and_wait(
    profile_index: impl Into<SmartString>,
    notify_success: bool,
) -> CmdResult<bool> {
    switch_profile_impl(profile_index.into(), notify_success, true).await
}

async fn switch_profile_impl(
    profile_index: SmartString,
    notify_success: bool,
    wait_for_completion: bool,
) -> CmdResult<bool> {
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

    let task_id = request.task_id();
    let mut completion_rx = if wait_for_completion {
        Some(register_completion_waiter(task_id).await)
    } else {
        None
    };

    let (tx, rx) = oneshot::channel();

    let enqueue_result = match sender.try_send(SwitchDriverMessage::Request {
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
    };

    let accepted = match enqueue_result {
        Ok(result) => result,
        Err(err) => {
            if completion_rx.is_some() {
                remove_completion_waiter(task_id).await;
            }
            return Err(err);
        }
    };

    if !accepted {
        if completion_rx.is_some() {
            remove_completion_waiter(task_id).await;
        }
        return Ok(false);
    }

    if let Some(rx_completion) = completion_rx.take() {
        match rx_completion.await {
            Ok(status) => Ok(status.success),
            Err(err) => {
                logging!(
                    error,
                    Type::Cmd,
                    "Switch task {} completion channel dropped: {}",
                    task_id,
                    err
                );
                Err("profile switch completion unavailable".into())
            }
        }
    } else {
        Ok(true)
    }
}

fn switch_driver_sender() -> &'static mpsc::Sender<SwitchDriverMessage> {
    SWITCH_QUEUE.get_or_init(|| {
        let (tx, mut rx) = mpsc::channel::<SwitchDriverMessage>(SWITCH_QUEUE_CAPACITY);
        let driver_tx = tx.clone();
        tokio::spawn(async move {
            let manager = manager();
            let mut state = SwitchDriverState::default();
            manager.set_status(state.snapshot(manager));
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
            "Cleanup running for {}; queueing switch task {} -> {} to run afterwards",
            profile_key,
            request.task_id(),
            profile_key
        );
        if let Some(previous) = state
            .latest_tokens
            .insert(profile_key.clone(), request.cancel_token().clone())
        {
            previous.cancel();
        }
        state
            .queue
            .retain(|queued| queued.profile_id() != &profile_key);
        state.queue.push_back(request);
        if let Some(sender) = responder.take() {
            let _ = sender.send(accepted);
        }
        publish_status(state, manager);
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

    if let Some(active) = state.active.as_ref() {
        logging!(
            debug,
            Type::Cmd,
            "Cancelling active switch task {} (profile={}) in favour of task {} -> {}",
            active.task_id(),
            active.profile_id(),
            request.task_id(),
            profile_key
        );
        active.cancel_token().cancel();
    }

    state
        .queue
        .retain(|queued| queued.profile_id() != &profile_key);

    if !state.queue.is_empty() {
        logging!(
            debug,
            Type::Cmd,
            "Collapsing {} pending switch request(s) before enqueuing task {} -> {}",
            state.queue.len(),
            request.task_id(),
            profile_key
        );
        drop_pending_requests(state);
    }

    state.queue.push_back(request.clone());
    if let Some(sender) = responder.take() {
        let _ = sender.send(accepted);
    }

    start_next_job(state, driver_tx, manager);
    publish_status(state, manager);
}

fn handle_completion(
    state: &mut SwitchDriverState,
    request: SwitchRequest,
    outcome: SwitchJobOutcome,
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    manager: &'static SwitchManager,
) {
    let result_record = match &outcome {
        SwitchJobOutcome::Completed { success, .. } => {
            logging!(
                info,
                Type::Cmd,
                "Switch task {} completed (success={})",
                request.task_id(),
                success
            );
            if *success {
                SwitchResultStatus::success(request.task_id(), request.profile_id())
            } else {
                SwitchResultStatus::failed(request.task_id(), request.profile_id(), None, None)
            }
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
            SwitchResultStatus::failed(
                request.task_id(),
                request.profile_id(),
                Some(format!("{:?}", info.stage)),
                Some(info.detail.clone()),
            )
        }
    };

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

    let event_record = result_record.clone();
    state.last_result = Some(result_record);
    notify_completion_waiter(request.task_id(), event_record.clone());
    manager.push_event(event_record);
    start_next_job(state, driver_tx, manager);
    publish_status(state, manager);
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

    notify_completion_waiter(
        request.task_id(),
        SwitchResultStatus::failed(
            request.task_id(),
            request.profile_id(),
            Some("cancelled".to_string()),
            Some("request superseded".to_string()),
        ),
    );
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

        let request_for_error = completion_request.clone();

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
            notify_completion_waiter(
                request_for_error.task_id(),
                SwitchResultStatus::failed(
                    request_for_error.task_id(),
                    request_for_error.profile_id(),
                    Some("driver".to_string()),
                    Some(format!("completion dispatch failed: {}", err)),
                ),
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
    publish_status(state, manager);
}

fn start_next_job(
    state: &mut SwitchDriverState,
    driver_tx: mpsc::Sender<SwitchDriverMessage>,
    manager: &'static SwitchManager,
) {
    if state.active.is_some() || !state.cleanup_profiles.is_empty() {
        publish_status(state, manager);
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

    publish_status(state, manager);
}

fn publish_status(state: &SwitchDriverState, manager: &'static SwitchManager) {
    manager.set_status(state.snapshot(manager));
}

impl SwitchDriverState {
    fn snapshot(&self, manager: &SwitchManager) -> ProfileSwitchStatus {
        let active = self
            .active
            .as_ref()
            .map(|req| SwitchTaskStatus::from_request(req, false));
        let queue = self
            .queue
            .iter()
            .map(|req| SwitchTaskStatus::from_request(req, true))
            .collect::<Vec<_>>();
        let cleanup_profiles = self
            .cleanup_profiles
            .keys()
            .map(|key| key.to_string())
            .collect::<Vec<_>>();

        ProfileSwitchStatus {
            is_switching: manager.is_switching(),
            active,
            queue,
            cleanup_profiles,
            last_result: self.last_result.clone(),
            last_updated: current_millis(),
        }
    }
}
