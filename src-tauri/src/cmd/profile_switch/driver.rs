use super::{
    CmdResult,
    state::{SWITCH_MUTEX, SWITCH_TASK_SEQUENCE, SwitchRequest},
    workflow,
};
use crate::{logging, process::AsyncHandler, utils::logging::Type};
use once_cell::sync::OnceCell;
use smartstring::alias::String as SmartString;
use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use tokio::sync::{
    Mutex,
    mpsc::{self, error::TrySendError},
    oneshot,
};

const SWITCH_QUEUE_CAPACITY: usize = 32;
static SWITCH_QUEUE: OnceCell<mpsc::Sender<SwitchDriverMessage>> = OnceCell::new();

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

pub(super) async fn switch_profile(
    profile_index: impl Into<SmartString>,
    notify_success: bool,
) -> CmdResult<bool> {
    let profile_index: SmartString = profile_index.into();
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
        let success = workflow::run_switch_job(mutex, &request).await;
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
