use crate::{APP_HANDLE, singleton};
use smartstring::alias::String;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_mihomo::{Mihomo, MihomoExt as _};
use tokio::sync::RwLockReadGuard;

use super::notification::{FrontendEvent, NotificationSystem};

#[derive(Debug)]
pub struct Handle {
    is_exiting: AtomicBool,
}

impl Default for Handle {
    fn default() -> Self {
        Self {
            is_exiting: AtomicBool::new(false),
        }
    }
}

singleton!(Handle, HANDLE);

impl Handle {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn app_handle() -> &'static AppHandle {
        #[allow(clippy::expect_used)]
        APP_HANDLE.get().expect("App handle not initialized")
    }

    pub async fn mihomo() -> RwLockReadGuard<'static, Mihomo> {
        Self::app_handle().mihomo().read().await
    }

    pub fn refresh_clash() {
        Self::send_event(FrontendEvent::RefreshClash);
    }

    pub fn refresh_verge() {
        Self::send_event(FrontendEvent::RefreshVerge);
    }

    pub fn notify_profile_changed(profile_id: &String) {
        Self::send_event(FrontendEvent::ProfileChanged {
            current_profile_id: profile_id,
        });
    }

    pub fn notify_timer_updated(profile_index: &String) {
        Self::send_event(FrontendEvent::TimerUpdated { profile_index });
    }

    pub fn notify_profile_update_started(uid: &String) {
        Self::send_event(FrontendEvent::ProfileUpdateStarted { uid });
    }

    pub fn notify_profile_update_completed(uid: &String) {
        Self::send_event(FrontendEvent::ProfileUpdateCompleted { uid });
    }

    /// netmon 成功 PUT /network/context 之后调用；转发到前端事件
    /// `verge://network-context-updated`，payload 含 `matched` 字段（mihomo 决策
    /// 出的 network name 或 null）。
    pub fn notify_network_context_updated(matched: Option<&str>) {
        Self::send_event(FrontendEvent::NetworkContextUpdated { matched });
    }

    /// macOS 专属：CoreLocation `locationManagerDidChangeAuthorization:` 回调
    /// 调用，转发到前端事件 `verge://wifi-auth-changed`。Denied 场景下 sampler
    /// fingerprint 可能不变，`network-context-updated` 不触发，UI 需要本事件
    /// 独立感知授权变化。
    #[cfg(target_os = "macos")]
    pub fn notify_wifi_auth_changed() {
        Self::send_event(FrontendEvent::WifiAuthChanged);
    }

    pub fn notice_message<S: AsRef<str>, M: Into<String>>(status: S, msg: M) {
        let status_str = status.as_ref();
        let msg_str = msg.into();

        Self::send_event(FrontendEvent::NoticeMessage {
            status: status_str,
            message: msg_str,
        });
    }

    pub fn set_is_exiting(&self) {
        self.is_exiting.store(true, Ordering::Release);
    }

    pub fn is_exiting(&self) -> bool {
        self.is_exiting.load(Ordering::Acquire)
    }

    fn send_event(event: FrontendEvent) {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        NotificationSystem::send_event(event);
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
