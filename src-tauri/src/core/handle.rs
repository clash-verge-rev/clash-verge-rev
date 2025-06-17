use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::{logging, utils::logging::Type};

/// 不同类型的前端通知
#[derive(Debug, Clone)]
enum FrontendEvent {
    RefreshClash,
    RefreshVerge,
    NoticeMessage { status: String, message: String },
    ProfileChanged { current_profile_id: String },
    TimerUpdated { profile_index: String },
    StartupCompleted,
    ProfileUpdateStarted { uid: String },
    ProfileUpdateCompleted { uid: String },
}

/// 事件发送统计和监控
#[derive(Debug, Default)]
struct EventStats {
    total_sent: AtomicU64,
    total_errors: AtomicU64,
    last_error_time: RwLock<Option<Instant>>,
}

/// 存储启动期间的错误消息
#[derive(Debug, Clone)]
struct ErrorMessage {
    status: String,
    message: String,
}

/// 全局前端通知系统
#[derive(Debug)]
struct NotificationSystem {
    sender: Option<mpsc::Sender<FrontendEvent>>,
    worker_handle: Option<thread::JoinHandle<()>>,
    is_running: bool,
    stats: EventStats,
    last_emit_time: RwLock<Instant>,
    /// 当通知系统失败超过阈值时，进入紧急模式
    emergency_mode: RwLock<bool>,
}

impl Default for NotificationSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationSystem {
    fn new() -> Self {
        Self {
            sender: None,
            worker_handle: None,
            is_running: false,
            stats: EventStats::default(),
            last_emit_time: RwLock::new(Instant::now()),
            emergency_mode: RwLock::new(false),
        }
    }

    /// 启动通知处理线程
    fn start(&mut self) {
        if self.is_running {
            return;
        }

        let (tx, rx) = mpsc::channel();
        self.sender = Some(tx);
        self.is_running = true;

        *self.last_emit_time.write() = Instant::now();

        self.worker_handle = Some(
            thread::Builder::new()
                .name("frontend-notifier".into())
                .spawn(move || {
                    let handle = Handle::global();

                    while !handle.is_exiting() {
                        match rx.recv_timeout(Duration::from_millis(100)) {
                            Ok(event) => {
                                let system_guard = handle.notification_system.read();
                                if system_guard.as_ref().is_none() {
                                    log::warn!("NotificationSystem not found in handle while processing event.");
                                    continue;
                                }
                                let system = system_guard.as_ref().unwrap();

                                let is_emergency = *system.emergency_mode.read();

                                if is_emergency {
                                    if let FrontendEvent::NoticeMessage { ref status, .. } = event {
                                        if status == "info" {
                                            log::warn!(
                                                "Emergency mode active, skipping info message"
                                            );
                                            continue;
                                        }
                                    }
                                }

                                if let Some(window) = handle.get_window() {
                                    *system.last_emit_time.write() = Instant::now();

                                    let (event_name_str, payload_result) = match event {
                                        FrontendEvent::RefreshClash => {
                                            ("verge://refresh-clash-config", Ok(serde_json::json!("yes")))
                                        }
                                        FrontendEvent::RefreshVerge => {
                                            ("verge://refresh-verge-config", Ok(serde_json::json!("yes")))
                                        }
                                        FrontendEvent::NoticeMessage { status, message } => {
                                            match serde_json::to_value((status, message)) {
                                                Ok(p) => ("verge://notice-message", Ok(p)),
                                                Err(e) => {
                                                    log::error!("Failed to serialize NoticeMessage payload: {}", e);
                                                    ("verge://notice-message", Err(e))
                                                }
                                            }
                                        }
                                        FrontendEvent::ProfileChanged { current_profile_id } => {
                                            ("profile-changed", Ok(serde_json::json!(current_profile_id)))
                                        }
                                        FrontendEvent::TimerUpdated { profile_index } => {
                                            ("verge://timer-updated", Ok(serde_json::json!(profile_index)))
                                        }
                                        FrontendEvent::StartupCompleted => {
                                            ("verge://startup-completed", Ok(serde_json::json!(null)))
                                        }
                                        FrontendEvent::ProfileUpdateStarted { uid } => {
                                            ("profile-update-started", Ok(serde_json::json!({ "uid": uid })))
                                        }
                                        FrontendEvent::ProfileUpdateCompleted { uid } => {
                                            ("profile-update-completed", Ok(serde_json::json!({ "uid": uid })))
                                        }
                                    };

                                    if let Ok(payload) = payload_result {
                                        match window.emit(event_name_str, payload) {
                                            Ok(_) => {
                                                system.stats.total_sent.fetch_add(1, Ordering::SeqCst);
                                                // 记录成功发送的事件
                                                if log::log_enabled!(log::Level::Debug) {
                                                    log::debug!("Successfully emitted event: {}", event_name_str);
                                                }
                                            }
                                            Err(e) => {
                                                log::warn!("Failed to emit event {}: {}", event_name_str, e);
                                                system.stats.total_errors.fetch_add(1, Ordering::SeqCst);
                                                *system.stats.last_error_time.write() = Some(Instant::now());

                                                let errors = system.stats.total_errors.load(Ordering::SeqCst);
                                                const EMIT_ERROR_THRESHOLD: u64 = 10;
                                                if errors > EMIT_ERROR_THRESHOLD && !*system.emergency_mode.read() {
                                                    log::warn!(
                                                        "Reached {} emit errors, entering emergency mode",
                                                        EMIT_ERROR_THRESHOLD
                                                    );
                                                    *system.emergency_mode.write() = true;
                                                }
                                            }
                                        }
                                    } else {
                                        system.stats.total_errors.fetch_add(1, Ordering::SeqCst);
                                        *system.stats.last_error_time.write() = Some(Instant::now());
                                        log::warn!("Skipped emitting event due to payload serialization error for {}", event_name_str);
                                    }
                                } else {
                                    log::warn!("No window found, skipping event emit.");
                                }
                                thread::sleep(Duration::from_millis(20));
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                continue;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                log::info!(
                                    "Notification channel disconnected, exiting worker thread"
                                );
                                break;
                            }
                        }
                    }

                    log::info!("Notification worker thread exiting");
                })
                .expect("Failed to start notification worker thread"),
        );
    }

    /// 发送事件到队列
    fn send_event(&self, event: FrontendEvent) -> bool {
        if *self.emergency_mode.read() {
            if let FrontendEvent::NoticeMessage { ref status, .. } = event {
                if status == "info" {
                    log::info!("Skipping info message in emergency mode");
                    return false;
                }
            }
        }

        if let Some(sender) = &self.sender {
            match sender.send(event) {
                Ok(_) => true,
                Err(e) => {
                    log::warn!("Failed to send event to notification queue: {:?}", e);
                    self.stats.total_errors.fetch_add(1, Ordering::SeqCst);
                    *self.stats.last_error_time.write() = Some(Instant::now());
                    false
                }
            }
        } else {
            log::warn!("Notification system not started, can't send event");
            false
        }
    }

    fn shutdown(&mut self) {
        log::info!("NotificationSystem shutdown initiated");
        self.is_running = false;

        // 先关闭发送端，让接收端知道不会再有新消息
        if let Some(sender) = self.sender.take() {
            drop(sender);
        }

        // 设置超时避免无限等待
        if let Some(handle) = self.worker_handle.take() {
            match handle.join() {
                Ok(_) => {
                    log::info!("NotificationSystem worker thread joined successfully");
                }
                Err(e) => {
                    log::error!("NotificationSystem worker thread join failed: {:?}", e);
                }
            }
        }

        log::info!("NotificationSystem shutdown completed");
    }
}

#[derive(Debug, Clone)]
pub struct Handle {
    pub app_handle: Arc<RwLock<Option<AppHandle>>>,
    pub is_exiting: Arc<RwLock<bool>>,
    startup_errors: Arc<RwLock<Vec<ErrorMessage>>>,
    startup_completed: Arc<RwLock<bool>>,
    notification_system: Arc<RwLock<Option<NotificationSystem>>>,
}

impl Default for Handle {
    fn default() -> Self {
        Self {
            app_handle: Arc::new(RwLock::new(None)),
            is_exiting: Arc::new(RwLock::new(false)),
            startup_errors: Arc::new(RwLock::new(Vec::new())),
            startup_completed: Arc::new(RwLock::new(false)),
            notification_system: Arc::new(RwLock::new(Some(NotificationSystem::new()))),
        }
    }
}

impl Handle {
    pub fn global() -> &'static Handle {
        static HANDLE: OnceCell<Handle> = OnceCell::new();
        HANDLE.get_or_init(Handle::default)
    }

    pub fn init(&self, app_handle: &AppHandle) {
        {
            let mut handle = self.app_handle.write();
            *handle = Some(app_handle.clone());
        }

        let mut system_opt = self.notification_system.write();
        if let Some(system) = system_opt.as_mut() {
            system.start();
        }
    }

    pub fn app_handle(&self) -> Option<AppHandle> {
        self.app_handle.read().clone()
    }

    pub fn get_window(&self) -> Option<WebviewWindow> {
        let app_handle = self.app_handle()?;
        let window: Option<WebviewWindow> = app_handle.get_webview_window("main");
        if window.is_none() {
            log::debug!(target:"app", "main window not found");
        }
        window
    }

    pub fn refresh_clash() {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::RefreshClash);
        }
    }

    pub fn refresh_verge() {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::RefreshVerge);
        }
    }

    pub fn notify_profile_changed(profile_id: String) {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::ProfileChanged {
                current_profile_id: profile_id,
            });
        } else {
            log::warn!(
                "Notification system not initialized when trying to send ProfileChanged event."
            );
        }
    }

    pub fn notify_timer_updated(profile_index: String) {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::TimerUpdated { profile_index });
        } else {
            log::warn!(
                "Notification system not initialized when trying to send TimerUpdated event."
            );
        }
    }

    pub fn notify_startup_completed() {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::StartupCompleted);
        } else {
            log::warn!(
                "Notification system not initialized when trying to send StartupCompleted event."
            );
        }
    }

    pub fn notify_profile_update_started(uid: String) {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::ProfileUpdateStarted { uid });
        } else {
            log::warn!("Notification system not initialized when trying to send ProfileUpdateStarted event.");
        }
    }

    pub fn notify_profile_update_completed(uid: String) {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::ProfileUpdateCompleted { uid });
        } else {
            log::warn!("Notification system not initialized when trying to send ProfileUpdateCompleted event.");
        }
    }

    /// 通知前端显示消息队列
    pub fn notice_message<S: Into<String>, M: Into<String>>(status: S, msg: M) {
        let handle = Self::global();
        let status_str = status.into();
        let msg_str = msg.into();

        if !*handle.startup_completed.read() {
            logging!(
                info,
                Type::Frontend,
                true,
                "启动过程中发现错误，加入消息队列: {} - {}",
                status_str,
                msg_str
            );

            let mut errors = handle.startup_errors.write();
            errors.push(ErrorMessage {
                status: status_str,
                message: msg_str,
            });
            return;
        }

        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::NoticeMessage {
                status: status_str,
                message: msg_str,
            });
        }
    }

    pub fn mark_startup_completed(&self) {
        {
            let mut completed = self.startup_completed.write();
            *completed = true;
        }

        self.send_startup_errors();
    }

    /// 发送启动时累积的所有错误消息
    fn send_startup_errors(&self) {
        let errors = {
            let mut errors = self.startup_errors.write();
            std::mem::take(&mut *errors)
        };

        if errors.is_empty() {
            return;
        }

        logging!(
            info,
            Type::Frontend,
            true,
            "发送{}条启动时累积的错误消息",
            errors.len()
        );

        // 启动单独线程处理启动错误，避免阻塞主线程
        let thread_result = thread::Builder::new()
            .name("startup-errors-sender".into())
            .spawn(move || {
                thread::sleep(Duration::from_secs(2));

                let handle = Handle::global();
                if handle.is_exiting() {
                    return;
                }

                let system_opt = handle.notification_system.read();
                if let Some(system) = system_opt.as_ref() {
                    for error in errors {
                        if handle.is_exiting() {
                            break;
                        }

                        system.send_event(FrontendEvent::NoticeMessage {
                            status: error.status,
                            message: error.message,
                        });

                        thread::sleep(Duration::from_millis(300));
                    }
                }
            });

        if let Err(e) = thread_result {
            log::error!("Failed to spawn startup errors thread: {}", e);
        }
    }

    pub fn set_is_exiting(&self) {
        let mut is_exiting = self.is_exiting.write();
        *is_exiting = true;

        let mut system_opt = self.notification_system.write();
        if let Some(system) = system_opt.as_mut() {
            system.shutdown();
        }
    }

    pub fn is_exiting(&self) -> bool {
        *self.is_exiting.read()
    }
}
