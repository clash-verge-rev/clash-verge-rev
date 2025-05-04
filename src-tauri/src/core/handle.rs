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
                                let is_emergency = system_guard
                                    .as_ref()
                                    .and_then(|sys| Some(*sys.emergency_mode.read()))
                                    .unwrap_or(false);

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
                                    match event {
                                        FrontendEvent::RefreshClash => {
                                            Self::emit_with_timeout(
                                                &window,
                                                "verge://refresh-clash-config",
                                                "yes",
                                                &handle,
                                            );
                                        }
                                        FrontendEvent::RefreshVerge => {
                                            Self::emit_with_timeout(
                                                &window,
                                                "verge://refresh-verge-config",
                                                "yes",
                                                &handle,
                                            );
                                        }
                                        FrontendEvent::NoticeMessage {
                                            ref status,
                                            ref message,
                                        } => {
                                            Self::emit_with_timeout(
                                                &window,
                                                "verge://notice-message",
                                                (status.clone(), message.clone()),
                                                &handle,
                                            );
                                        }
                                    }
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

    /// 使用超时控制发送事件，防止无限阻塞
    fn emit_with_timeout<P: serde::Serialize + Clone + Send + 'static>(
        window: &WebviewWindow,
        event: &str,
        payload: P,
        handle: &Handle,
    ) {
        let start = Instant::now();

        let system_guard = handle.notification_system.read();
        if let Some(system) = system_guard.as_ref() {
            *system.last_emit_time.write() = start;

            let window_label = window.label().to_string();
            let event_clone = event.to_string();
            let app_handle_clone = match handle.app_handle() {
                Some(h) => h,
                None => return,
            };

            let (tx, rx) = mpsc::channel();
            let _ = thread::Builder::new()
                .name("emit-timeout".into())
                .spawn(move || {
                    if let Some(win) = app_handle_clone.get_webview_window(&window_label) {
                        let result = win.emit(&event_clone, payload);
                        let _ = tx.send(result);
                    } else {
                        let _ = tx.send(Err(tauri::Error::WebviewNotFound));
                    }
                });

            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(result) => {
                    if let Err(e) = result {
                        log::warn!("Failed to emit event {}: {}", event, e);
                        system.stats.total_errors.fetch_add(1, Ordering::SeqCst);
                        *system.stats.last_error_time.write() = Some(Instant::now());
                    } else {
                        system.stats.total_sent.fetch_add(1, Ordering::SeqCst);
                    }
                }
                Err(_) => {
                    log::error!("Emit timed out for event: {}", event);
                    system.stats.total_errors.fetch_add(1, Ordering::SeqCst);
                    *system.stats.last_error_time.write() = Some(Instant::now());

                    let errors = system.stats.total_errors.load(Ordering::SeqCst);
                    if errors > 5 {
                        log::warn!("Too many emit errors, entering emergency mode");
                        *system.emergency_mode.write() = true;
                    }
                }
            }
        }
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
        self.is_running = false;
        self.sender = None;

        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
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
        HANDLE.get_or_init(|| Handle::default())
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
