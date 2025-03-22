use crate::log_err;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_shell::process::CommandChild;
use std::fs::File;

#[derive(Debug, Default, Clone)]
pub struct Handle {
    pub app_handle: Arc<RwLock<Option<AppHandle>>>,
    pub is_exiting: Arc<RwLock<bool>>,
    pub core_process: Arc<RwLock<Option<CommandChild>>>,
    pub core_lock: Arc<RwLock<Option<File>>>,
}

impl Handle {
    pub fn global() -> &'static Handle {
        static HANDLE: OnceCell<Handle> = OnceCell::new();

        HANDLE.get_or_init(|| Handle {
            app_handle: Arc::new(RwLock::new(None)),
            is_exiting: Arc::new(RwLock::new(false)),
            core_process: Arc::new(RwLock::new(None)),
            core_lock: Arc::new(RwLock::new(None)),
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
            log_err!(window.emit("verge://refresh-clash-config", "yes"));
        }
    }

    pub fn refresh_verge() {
        if let Some(window) = Self::global().get_window() {
            log_err!(window.emit("verge://refresh-verge-config", "yes"));
        }
    }

    #[allow(unused)]
    pub fn refresh_profiles() {
        if let Some(window) = Self::global().get_window() {
            log_err!(window.emit("verge://refresh-profiles-config", "yes"));
        }
    }

    pub fn notice_message<S: Into<String>, M: Into<String>>(status: S, msg: M) {
        if let Some(window) = Self::global().get_window() {
            log_err!(window.emit("verge://notice-message", (status.into(), msg.into())));
        }
    }

    pub fn set_is_exiting(&self) {
        let mut is_exiting = self.is_exiting.write();
        *is_exiting = true;
    }

    pub fn set_core_process(&self, process: CommandChild) {
        let mut core_process = self.core_process.write();
        *core_process = Some(process);
    }

    pub fn take_core_process(&self) -> Option<CommandChild> {
        let mut core_process = self.core_process.write();
        core_process.take()
    }

    /// 检查是否有运行中的核心进程
    pub fn has_core_process(&self) -> bool {
        self.core_process.read().is_some()
    }

    pub fn is_exiting(&self) -> bool {
        *self.is_exiting.read()
    }
    
    /// 设置核心文件锁
    pub fn set_core_lock(&self, file: File) {
        let mut core_lock = self.core_lock.write();
        *core_lock = Some(file);
    }
    
    /// 释放核心文件锁
    pub fn release_core_lock(&self) -> Option<File> {
        let mut core_lock = self.core_lock.write();
        core_lock.take()
    }
    
    /// 检查是否持有核心文件锁
    pub fn has_core_lock(&self) -> bool {
        self.core_lock.read().is_some()
    }
}
