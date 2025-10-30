use crate::{constants::retry, logging, utils::logging::Type};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use smartstring::alias::String;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Instant,
};
use tauri::Emitter;
use tauri::async_runtime;

#[allow(dead_code)] // Temporarily suppress warnings while diagnostics disable certain events
#[derive(Debug, Clone)]
pub enum FrontendEvent {
    RefreshClash,
    RefreshVerge,
    RefreshProxy,
    ProxiesUpdated {
        payload: serde_json::Value,
    },
    NoticeMessage {
        status: String,
        message: String,
    },
    ProfileChanged {
        current_profile_id: String,
    },
    ProfileSwitchFinished {
        profile_id: String,
        success: bool,
        notify: bool,
        task_id: u64,
    },
    TimerUpdated {
        profile_index: String,
    },
    ProfileUpdateStarted {
        uid: String,
    },
    ProfileUpdateCompleted {
        uid: String,
    },
    RustPanic {
        message: String,
        location: String,
    },
}

static EMIT_SERIALIZER: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

#[derive(Debug, Default)]
struct EventStats {
    total_errors: AtomicU64,
    last_error_time: RwLock<Option<Instant>>,
}

#[derive(Debug, Default)]
#[allow(dead_code)]
struct BufferedProxies {
    pending: parking_lot::Mutex<Option<serde_json::Value>>,
    in_flight: AtomicBool,
}

#[derive(Debug, Clone)]
pub struct ErrorMessage {
    pub status: String,
    pub message: String,
}

#[derive(Debug)]
pub struct NotificationSystem {
    sender: Option<mpsc::Sender<FrontendEvent>>,
    #[allow(clippy::type_complexity)]
    worker_handle: Option<thread::JoinHandle<()>>,
    pub(super) is_running: bool,
    stats: EventStats,
    emergency_mode: RwLock<bool>,
    proxies_buffer: Arc<BufferedProxies>,
}

impl Default for NotificationSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationSystem {
    pub fn new() -> Self {
        Self {
            sender: None,
            worker_handle: None,
            is_running: false,
            stats: EventStats::default(),
            emergency_mode: RwLock::new(false),
            proxies_buffer: Arc::new(BufferedProxies::default()),
        }
    }

    pub fn start(&mut self) {
        if self.is_running {
            return;
        }

        let (tx, rx) = mpsc::channel();
        self.sender = Some(tx);
        self.is_running = true;

        let result = thread::Builder::new()
            .name("frontend-notifier".into())
            .spawn(move || Self::worker_loop(rx));

        match result {
            Ok(handle) => self.worker_handle = Some(handle),
            Err(e) => logging!(
                error,
                Type::System,
                "Failed to start notification worker: {}",
                e
            ),
        }
    }

    fn worker_loop(rx: mpsc::Receiver<FrontendEvent>) {
        use super::handle::Handle;

        let handle = Handle::global();

        while !handle.is_exiting() {
            match rx.recv() {
                Ok(event) => Self::process_event(handle, event),
                Err(e) => {
                    logging!(
                        error,
                        Type::System,
                        "receive event error, stop notification worker: {}",
                        e
                    );
                    break;
                }
            }
        }
    }

    fn process_event(handle: &super::handle::Handle, event: FrontendEvent) {
        let system_guard = handle.notification_system.read();
        let Some(system) = system_guard.as_ref() else {
            return;
        };

        let event_label = Self::describe_event(&event);

        match event {
            FrontendEvent::ProxiesUpdated { payload } => {
                logging!(
                    debug,
                    Type::Frontend,
                    "Queueing proxies-updated event for buffered emit: {}",
                    event_label
                );
                system.enqueue_proxies_updated(payload);
            }
            other => {
                logging!(
                    debug,
                    Type::Frontend,
                    "Queueing event for async emit: {}",
                    event_label
                );

                let (event_name, payload_result) = system.serialize_event(other);
                let payload = match payload_result {
                    Ok(value) => value,
                    Err(err) => {
                        logging!(
                            warn,
                            Type::Frontend,
                            "Failed to serialize event {}: {}",
                            event_name,
                            err
                        );
                        return;
                    }
                };

                logging!(
                    debug,
                    Type::Frontend,
                    "Dispatching async emit: {}",
                    event_name
                );
                let _ = Self::emit_via_app(event_name, payload);
            }
        }
    }

    fn enqueue_proxies_updated(&self, payload: serde_json::Value) {
        let replaced = {
            let mut slot = self.proxies_buffer.pending.lock();
            let had_pending = slot.is_some();
            *slot = Some(payload);
            had_pending
        };

        if replaced {
            logging!(
                debug,
                Type::Frontend,
                "Replaced pending proxies-updated payload with latest snapshot"
            );
        }

        if self
            .proxies_buffer
            .in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            let buffer = Arc::clone(&self.proxies_buffer);
            async_runtime::spawn(async move {
                Self::flush_proxies(buffer).await;
            });
        }
    }

    fn should_skip_event(&self, event: &FrontendEvent) -> bool {
        let is_emergency = *self.emergency_mode.read();
        matches!(
            (is_emergency, event),
            (true, FrontendEvent::NoticeMessage { status, .. }) if status == "info"
        )
    }

    fn emit_via_app(event_name: &'static str, payload: serde_json::Value) -> Result<(), String> {
        let app_handle = super::handle::Handle::app_handle().clone();
        let event_name = event_name.to_string();
        async_runtime::spawn(async move {
            if let Err(err) = app_handle.emit_to("main", event_name.as_str(), payload) {
                logging!(
                    warn,
                    Type::Frontend,
                    "emit_to failed for {}: {}",
                    event_name,
                    err
                );
            }
        });
        Ok(())
    }

    async fn flush_proxies(buffer: Arc<BufferedProxies>) {
        const EVENT_NAME: &str = "proxies-updated";

        loop {
            let payload_opt = {
                let mut guard = buffer.pending.lock();
                guard.take()
            };

            let Some(payload) = payload_opt else {
                buffer.in_flight.store(false, Ordering::Release);

                if buffer.pending.lock().is_some()
                    && buffer
                        .in_flight
                        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                        .is_ok()
                {
                    continue;
                }

                break;
            };

            logging!(debug, Type::Frontend, "Dispatching buffered proxies emit");
            let _guard = EMIT_SERIALIZER.lock().await;
            if let Err(err) = Self::emit_via_app(EVENT_NAME, payload) {
                logging!(
                    warn,
                    Type::Frontend,
                    "Buffered proxies emit failed: {}",
                    err
                );
            }
        }
    }

    fn describe_event(event: &FrontendEvent) -> String {
        match event {
            FrontendEvent::RefreshClash => "RefreshClash".into(),
            FrontendEvent::RefreshVerge => "RefreshVerge".into(),
            FrontendEvent::RefreshProxy => "RefreshProxy".into(),
            FrontendEvent::ProxiesUpdated { .. } => "ProxiesUpdated".into(),
            FrontendEvent::NoticeMessage { status, .. } => {
                format!("NoticeMessage({})", status).into()
            }
            FrontendEvent::ProfileChanged { current_profile_id } => {
                format!("ProfileChanged({})", current_profile_id).into()
            }
            FrontendEvent::ProfileSwitchFinished {
                profile_id,
                task_id,
                ..
            } => format!(
                "ProfileSwitchFinished(profile={}, task={})",
                profile_id, task_id
            )
            .into(),
            FrontendEvent::TimerUpdated { profile_index } => {
                format!("TimerUpdated({})", profile_index).into()
            }
            FrontendEvent::ProfileUpdateStarted { uid } => {
                format!("ProfileUpdateStarted({})", uid).into()
            }
            FrontendEvent::ProfileUpdateCompleted { uid } => {
                format!("ProfileUpdateCompleted({})", uid).into()
            }
            FrontendEvent::RustPanic { message, .. } => format!("RustPanic({})", message).into(),
        }
    }

    #[allow(dead_code)]
    fn serialize_event(
        &self,
        event: FrontendEvent,
    ) -> (&'static str, Result<serde_json::Value, serde_json::Error>) {
        use serde_json::json;

        match event {
            FrontendEvent::RefreshClash => ("verge://refresh-clash-config", Ok(json!("yes"))),
            FrontendEvent::RefreshVerge => ("verge://refresh-verge-config", Ok(json!("yes"))),
            FrontendEvent::NoticeMessage { status, message } => (
                "verge://notice-message",
                serde_json::to_value((status, message)),
            ),
            FrontendEvent::RefreshProxy => ("verge://refresh-proxy-config", Ok(json!("yes"))),
            FrontendEvent::ProxiesUpdated { payload } => ("proxies-updated", Ok(payload)),
            FrontendEvent::ProfileChanged { current_profile_id } => {
                ("profile-changed", Ok(json!(current_profile_id)))
            }
            FrontendEvent::ProfileSwitchFinished {
                profile_id,
                success,
                notify,
                task_id,
            } => (
                "profile-switch-finished",
                Ok(json!({
                    "profileId": profile_id,
                    "success": success,
                    "notify": notify,
                    "taskId": task_id
                })),
            ),
            FrontendEvent::TimerUpdated { profile_index } => {
                ("verge://timer-updated", Ok(json!(profile_index)))
            }
            FrontendEvent::ProfileUpdateStarted { uid } => {
                ("profile-update-started", Ok(json!({ "uid": uid })))
            }
            FrontendEvent::ProfileUpdateCompleted { uid } => {
                ("profile-update-completed", Ok(json!({ "uid": uid })))
            }
            FrontendEvent::RustPanic { message, location } => (
                "rust-panic",
                Ok(json!({ "message": message, "location": location })),
            ),
        }
    }

    fn handle_emit_error(&self) {
        self.stats.total_errors.fetch_add(1, Ordering::Relaxed);
        *self.stats.last_error_time.write() = Some(Instant::now());

        let errors = self.stats.total_errors.load(Ordering::Relaxed);
        if errors > retry::EVENT_EMIT_THRESHOLD && !*self.emergency_mode.read() {
            logging!(
                warn,
                Type::Frontend,
                "Entering emergency mode after {} errors",
                errors
            );
            *self.emergency_mode.write() = true;
        }
    }

    pub fn send_event(&self, event: FrontendEvent) -> bool {
        if self.should_skip_event(&event) {
            return false;
        }

        if let Some(sender) = &self.sender {
            if sender.send(event).is_err() {
                logging!(
                    warn,
                    Type::Frontend,
                    "Failed to send event to worker thread"
                );
                self.handle_emit_error();
                return false;
            }
            return true;
        }

        false
    }

    pub fn shutdown(&mut self) {
        self.is_running = false;

        if let Some(sender) = self.sender.take() {
            drop(sender);
        }

        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
    }
}
