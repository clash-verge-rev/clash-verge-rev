use crate::{APP_HANDLE, singleton, utils::window_manager::WindowManager};
use parking_lot::RwLock;
use smartstring::alias::String;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::AppHandle;
use tauri_plugin_mihomo::{Mihomo, MihomoExt as _};
use tokio::sync::RwLockReadGuard;

use super::notification::{FrontendEvent, NotificationSystem};

#[derive(Debug)]
pub struct Handle {
    is_exiting: AtomicBool,
    pub(crate) notification_system: Arc<RwLock<Option<NotificationSystem>>>,
}

impl Default for Handle {
    fn default() -> Self {
        Self {
            is_exiting: AtomicBool::new(false),
            notification_system: Arc::new(RwLock::new(Some(NotificationSystem::new()))),
        }
    }
}

singleton!(Handle, HANDLE);

impl Handle {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn init(&self) {
        if self.is_exiting() {
            return;
        }

        let mut system_opt = self.notification_system.write();
        if let Some(system) = system_opt.as_mut()
            && !system.is_running()
        {
            system.start();
        }
    }

    pub fn app_handle() -> &'static AppHandle {
        #[allow(clippy::expect_used)]
        APP_HANDLE.get().expect("App handle not initialized")
    }

    pub async fn mihomo() -> RwLockReadGuard<'static, Mihomo> {
        Self::app_handle().mihomo().read().await
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
        Self::send_event(FrontendEvent::ProfileChanged {
            current_profile_id: profile_id,
        });
    }

    pub fn notify_timer_updated(profile_index: String) {
        Self::send_event(FrontendEvent::TimerUpdated { profile_index });
    }

    pub fn notify_profile_update_started(uid: String) {
        Self::send_event(FrontendEvent::ProfileUpdateStarted { uid });
    }

    pub fn notify_profile_update_completed(uid: String) {
        Self::send_event(FrontendEvent::ProfileUpdateCompleted { uid });
    }

    // TODO 利用 &str 等缩短 Clone
    pub fn notice_message<S: Into<String>, M: Into<String>>(status: S, msg: M) {
        let handle = Self::global();

        if handle.is_exiting() {
            return;
        }

        // We only send notice when main window exists
        if WindowManager::get_main_window().is_none() {
            return;
        }

        let status_str = status.into();
        let msg_str = msg.into();

        Self::send_event(FrontendEvent::NoticeMessage {
            status: status_str,
            message: msg_str,
        });
    }

    fn send_event(event: FrontendEvent) {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(event);
        }
    }

    pub fn set_is_exiting(&self) {
        self.is_exiting.store(true, Ordering::Release);

        let mut system_opt = self.notification_system.write();
        if let Some(system) = system_opt.as_mut() {
            system.shutdown();
        }
    }

    pub fn is_exiting(&self) -> bool {
        self.is_exiting.load(Ordering::Acquire)
    }
}

#[cfg(target_os = "macos")]
impl Handle {
    pub fn set_activation_policy(&self, policy: tauri::ActivationPolicy) -> Result<(), String> {
        Self::app_handle()
            .set_activation_policy(policy)
            .map_err(|e| e.to_string().into())
    }

    pub fn set_activation_policy_regular(&self) {
        let _ = self.set_activation_policy(tauri::ActivationPolicy::Regular);
    }

    pub fn set_activation_policy_accessory(&self) {
        let _ = self.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}
