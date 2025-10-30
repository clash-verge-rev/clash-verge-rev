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

// Single shared queue so profile switches are executed sequentially and can
// collapse redundant requests for the same profile.
const SWITCH_QUEUE_CAPACITY: usize = 32;
static SWITCH_QUEUE: OnceCell<mpsc::Sender<SwitchDriverMessage>> = OnceCell::new();

type CompletionRegistry = AsyncMutex<HashMap<u64, oneshot::Sender<SwitchResultStatus>>>;

static SWITCH_COMPLETION_WAITERS: OnceCell<CompletionRegistry> = OnceCell::new();

/// Global map of task id -> completion channel sender used when callers await the result.
fn completion_waiters() -> &'static CompletionRegistry {
    SWITCH_COMPLETION_WAITERS.get_or_init(|| AsyncMutex::new(HashMap::new()))
}

/// Register a oneshot sender so `switch_profile_and_wait` can be notified when its task finishes.
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

/// Remove an outstanding completion waiter; used when enqueue fails or succeeds immediately.
async fn remove_completion_waiter(task_id: u64) -> Option<oneshot::Sender<SwitchResultStatus>> {
    completion_waiters().lock().await.remove(&task_id)
}

/// Fire-and-forget notify helper so we do not block the driver loop.
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

// Mutable snapshot of the driver's world; all mutations happen on the driver task.
#[derive(Debug, Default)]
struct SwitchDriverState {
    active: Option<SwitchRequest>,
    queue: VecDeque<SwitchRequest>,
    latest_tokens: HashMap<SmartString, SwitchCancellation>,
    cleanup_profiles: HashMap<SmartString, tokio::task::JoinHandle<()>>,
    last_result: Option<SwitchResultStatus>,
}

// Messages passed through SWITCH_QUEUE so the driver can react to events in order.
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
    // wait_for_completion is used by CLI flows that must block until the switch finishes.
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
        let (tx, rx) = mpsc::channel::<SwitchDriverMessage>(SWITCH_QUEUE_CAPACITY);
        let driver_tx = tx.clone();
        tokio::spawn(async move {
            let manager = manager();
            let driver = SwitchDriver::new(manager, driver_tx);
            driver.run(rx).await;
        });
        tx
    })
}

struct SwitchDriver {
    manager: &'static SwitchManager,
    sender: mpsc::Sender<SwitchDriverMessage>,
    state: SwitchDriverState,
}

impl SwitchDriver {
    fn new(manager: &'static SwitchManager, sender: mpsc::Sender<SwitchDriverMessage>) -> Self {
        let state = SwitchDriverState::default();
        manager.set_status(state.snapshot(manager));
        Self {
            manager,
            sender,
            state,
        }
    }

    async fn run(mut self, mut rx: mpsc::Receiver<SwitchDriverMessage>) {
        while let Some(message) = rx.recv().await {
            match message {
                SwitchDriverMessage::Request {
                    request,
                    respond_to,
                } => {
                    self.handle_enqueue(request, respond_to);
                }
                SwitchDriverMessage::Completion { request, outcome } => {
                    self.handle_completion(request, outcome);
                }
                SwitchDriverMessage::CleanupDone { profile } => {
                    self.handle_cleanup_done(profile);
                }
            }
        }
    }

    fn handle_enqueue(&mut self, request: SwitchRequest, respond_to: oneshot::Sender<bool>) {
        // Each new request supersedes older ones for the same profile to avoid thrashing the core.
        let mut responder = Some(respond_to);
        let accepted = true;
        let profile_key = request.profile_id().clone();
        let cleanup_pending =
            self.state.active.is_none() && !self.state.cleanup_profiles.is_empty();

        if cleanup_pending && self.state.cleanup_profiles.contains_key(&profile_key) {
            logging!(
                debug,
                Type::Cmd,
                "Cleanup running for {}; queueing switch task {} -> {} to run afterwards",
                profile_key,
                request.task_id(),
                profile_key
            );
            if let Some(previous) = self
                .state
                .latest_tokens
                .insert(profile_key.clone(), request.cancel_token().clone())
            {
                previous.cancel();
            }
            self.state
                .queue
                .retain(|queued| queued.profile_id() != &profile_key);
            self.state.queue.push_back(request);
            if let Some(sender) = responder.take() {
                let _ = sender.send(accepted);
            }
            self.publish_status();
            return;
        }

        if cleanup_pending {
            logging!(
                debug,
                Type::Cmd,
                "Cleanup running for {} profile(s); queueing task {} -> {} to run after cleanup without clearing existing requests",
                self.state.cleanup_profiles.len(),
                request.task_id(),
                profile_key
            );
        }

        if let Some(previous) = self
            .state
            .latest_tokens
            .insert(profile_key.clone(), request.cancel_token().clone())
        {
            previous.cancel();
        }

        if let Some(active) = self.state.active.as_mut()
            && active.profile_id() == &profile_key
        {
            active.cancel_token().cancel();
            active.merge_notify(request.notify());
            self.state
                .queue
                .retain(|queued| queued.profile_id() != &profile_key);
            self.state.queue.push_front(request.clone());
            if let Some(sender) = responder.take() {
                let _ = sender.send(accepted);
            }
            self.publish_status();
            return;
        }

        if let Some(active) = self.state.active.as_ref() {
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

        self.state
            .queue
            .retain(|queued| queued.profile_id() != &profile_key);

        self.state.queue.push_back(request.clone());
        if let Some(sender) = responder.take() {
            let _ = sender.send(accepted);
        }

        self.start_next_job();
        self.publish_status();
    }

    fn handle_completion(&mut self, request: SwitchRequest, outcome: SwitchJobOutcome) {
        // Translate the workflow result into an event the frontend can understand.
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

        if let Some(active) = self.state.active.as_ref()
            && active.task_id() == request.task_id()
        {
            self.state.active = None;
        }

        if let Some(latest) = self.state.latest_tokens.get(request.profile_id())
            && latest.same_token(request.cancel_token())
        {
            self.state.latest_tokens.remove(request.profile_id());
        }

        let cleanup = match outcome {
            SwitchJobOutcome::Completed { cleanup, .. } => cleanup,
            SwitchJobOutcome::Panicked { cleanup, .. } => cleanup,
        };

        self.track_cleanup(request.profile_id().clone(), cleanup);

        let event_record = result_record.clone();
        self.state.last_result = Some(result_record);
        notify_completion_waiter(request.task_id(), event_record.clone());
        self.manager.push_event(event_record);
        self.start_next_job();
        self.publish_status();
    }

    fn handle_cleanup_done(&mut self, profile: SmartString) {
        if let Some(handle) = self.state.cleanup_profiles.remove(&profile) {
            handle.abort();
        }
        self.start_next_job();
        self.publish_status();
    }

    fn start_next_job(&mut self) {
        if self.state.active.is_some() || !self.state.cleanup_profiles.is_empty() {
            self.publish_status();
            return;
        }

        while let Some(request) = self.state.queue.pop_front() {
            if request.cancel_token().is_cancelled() {
                self.discard_request(request);
                continue;
            }

            self.state.active = Some(request.clone());
            self.start_switch_job(request);
            break;
        }

        self.publish_status();
    }

    fn track_cleanup(&mut self, profile: SmartString, cleanup: workflow::CleanupHandle) {
        if let Some(existing) = self.state.cleanup_profiles.remove(&profile) {
            existing.abort();
        }

        let driver_tx = self.sender.clone();
        let profile_clone = profile.clone();
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
            if let Err(err) = driver_tx
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
        self.state.cleanup_profiles.insert(profile, handle);
    }

    fn start_switch_job(&self, request: SwitchRequest) {
        // Run the workflow in a background task while the driver keeps processing messages.
        let driver_tx = self.sender.clone();
        let manager = self.manager;

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

    /// Mark a request as failed because a newer request superseded it.
    fn discard_request(&mut self, request: SwitchRequest) {
        let key = request.profile_id().clone();
        let should_remove = self
            .state
            .latest_tokens
            .get(&key)
            .map(|latest| latest.same_token(request.cancel_token()))
            .unwrap_or(false);

        if should_remove {
            self.state.latest_tokens.remove(&key);
        }

        if !request.cancel_token().is_cancelled() {
            request.cancel_token().cancel();
        }

        let event = SwitchResultStatus::cancelled(
            request.task_id(),
            request.profile_id(),
            Some("request superseded".to_string()),
        );

        self.state.last_result = Some(event.clone());
        notify_completion_waiter(request.task_id(), event.clone());
        self.manager.push_event(event);
    }

    fn publish_status(&self) {
        self.manager.set_status(self.state.snapshot(self.manager));
    }
}

impl SwitchDriverState {
    /// Lightweight struct suitable for sharing across the command boundary.
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
