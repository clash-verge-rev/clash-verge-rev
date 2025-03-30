use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::{logging, logging_error, utils::logging::Type};

/// 存储启动期间的错误消息
#[derive(Debug, Clone)]
struct ErrorMessage {
    status: String,
    message: String,
}

#[derive(Debug, Default, Clone)]
pub struct Handle {
    pub app_handle: Arc<RwLock<Option<AppHandle>>>,
    pub is_exiting: Arc<RwLock<bool>>,
    /// 存储启动过程中产生的错误消息队列
    startup_errors: Arc<RwLock<Vec<ErrorMessage>>>,
    startup_completed: Arc<RwLock<bool>>,
}

impl Handle {
    pub fn global() -> &'static Handle {
        static HANDLE: OnceCell<Handle> = OnceCell::new();

        HANDLE.get_or_init(|| Handle {
            app_handle: Arc::new(RwLock::new(None)),
            is_exiting: Arc::new(RwLock::new(false)),
            startup_errors: Arc::new(RwLock::new(Vec::new())),
            startup_completed: Arc::new(RwLock::new(false)),
        })
    }

    pub fn init(&self, app_handle: &AppHandle) {
        let mut handle = self.app_handle.write();
        *handle = Some(app_handle.clone());
    }

    pub fn app_handle(&self) -> Option<AppHandle> {
        self.app_handle.read().clone()
    }

    pub fn get_window(&self) -> Option<WebviewWindow> {
        let app_handle = self.app_handle().unwrap();
        let window: Option<WebviewWindow> = app_handle.get_webview_window("main");
        if window.is_none() {
            log::debug!(target:"app", "main window not found");
        }
        window
    }

    pub fn refresh_clash() {
        if let Some(window) = Self::global().get_window() {
            logging_error!(
                Type::Frontend,
                true,
                window.emit("verge://refresh-clash-config", "yes")
            );
        }
    }

    pub fn refresh_verge() {
        if let Some(window) = Self::global().get_window() {
            logging_error!(
                Type::Frontend,
                true,
                window.emit("verge://refresh-verge-config", "yes")
            );
        }
    }

    #[allow(unused)]
    pub fn refresh_profiles() {
        if let Some(window) = Self::global().get_window() {
            logging_error!(
                Type::Frontend,
                true,
                window.emit("verge://refresh-profiles-config", "yes")
            );
        }
    }

    /// 通知前端显示消息，如果在启动过程中，则将消息存入启动错误队列
    pub fn notice_message<S: Into<String>, M: Into<String>>(status: S, msg: M) {
        let handle = Self::global();
        let status_str = status.into();
        let msg_str = msg.into();

        // 检查是否正在启动过程中
        if !*handle.startup_completed.read() {
            logging!(
                info,
                Type::Frontend,
                true,
                "启动过程中发现错误，加入消息队列: {} - {}",
                status_str,
                msg_str
            );

            // 将消息添加到启动错误队列
            let mut errors = handle.startup_errors.write();
            errors.push(ErrorMessage {
                status: status_str,
                message: msg_str,
            });
            return;
        }

        // 已经完成启动，直接发送消息
        if let Some(window) = handle.get_window() {
            logging_error!(
                Type::Frontend,
                true,
                window.emit("verge://notice-message", (status_str, msg_str))
            );
        }
    }

    /// 标记启动已完成，并发送所有启动阶段累积的错误消息
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

        // 等待2秒以确保前端已完全加载，延迟发送错误通知
        if let Some(window) = self.get_window() {
            let window_clone = window.clone();
            let errors_clone = errors.clone();

            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;

                for error in errors_clone {
                    let _ =
                        window_clone.emit("verge://notice-message", (error.status, error.message));
                    // 每条消息之间间隔500ms，避免消息堆积
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            });
        }
    }

    pub fn set_is_exiting(&self) {
        let mut is_exiting = self.is_exiting.write();
        *is_exiting = true;
    }

    pub fn is_exiting(&self) -> bool {
        *self.is_exiting.read()
    }
}
