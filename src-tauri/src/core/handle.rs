use crate::{
    APP_HANDLE, config::Config, constants::timing, logging, singleton, utils::logging::Type,
};
use parking_lot::RwLock;
use serde_json::{Value, json};
use smartstring::alias::String;
use std::{
    any::Any,
    env,
    sync::Arc,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_mihomo::{Mihomo, MihomoExt};
use tokio::sync::RwLockReadGuard;

use super::notification::{ErrorMessage, FrontendEvent, NotificationSystem};

const BYPASS_PROFILE_SWITCH_FINISHED_STATIC: bool = false;
const BYPASS_NOTICE_MESSAGE_STATIC: bool = false;

#[derive(Debug, Clone)]
pub struct Handle {
    is_exiting: Arc<RwLock<bool>>,
    startup_errors: Arc<RwLock<Vec<ErrorMessage>>>,
    startup_completed: Arc<RwLock<bool>>,
    pub(crate) notification_system: Arc<RwLock<Option<NotificationSystem>>>,
}

impl Default for Handle {
    fn default() -> Self {
        Self {
            is_exiting: Arc::new(RwLock::new(false)),
            startup_errors: Arc::new(RwLock::new(Vec::new())),
            startup_completed: Arc::new(RwLock::new(false)),
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
            && !system.is_running
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

    pub fn get_window() -> Option<WebviewWindow> {
        Self::app_handle().get_webview_window("main")
    }

    pub fn refresh_clash() {
        let handle = Self::global();
        if handle.is_exiting() {
            return;
        }

        let system_opt = handle.notification_system.read();
        if let Some(system) = system_opt.as_ref() {
            system.send_event(FrontendEvent::RefreshClash);
            system.send_event(FrontendEvent::RefreshProxy);
        }

        Self::spawn_proxy_snapshot();
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

    pub fn notify_profile_switch_finished(
        profile_id: String,
        success: bool,
        notify: bool,
        task_id: u64,
    ) {
        logging!(
            info,
            Type::Cmd,
            "Frontend notify start (profile_switch_finished, profile={}, success={}, notify={}, task={})",
            profile_id,
            success,
            notify,
            task_id
        );

        if BYPASS_PROFILE_SWITCH_FINISHED_STATIC || Self::should_bypass_profile_switch_finished() {
            logging!(
                warn,
                Type::Cmd,
                "Frontend notify bypassed (static={}, env={}, task={})",
                BYPASS_PROFILE_SWITCH_FINISHED_STATIC,
                env::var("CVR_BYPASS_PROFILE_SWITCH_FINISHED").unwrap_or_else(|_| "unset".into()),
                task_id
            );
            return;
        }

        let result = std::panic::catch_unwind(|| {
            Self::send_event(FrontendEvent::ProfileSwitchFinished {
                profile_id,
                success,
                notify,
                task_id,
            });
        });

        match result {
            Ok(_) => logging!(
                info,
                Type::Cmd,
                "Frontend notify completed (profile_switch_finished, task={})",
                task_id
            ),
            Err(payload) => logging!(
                error,
                Type::Cmd,
                "Frontend notify panicked (profile_switch_finished, task={}, payload={})",
                task_id,
                describe_panic(payload.as_ref())
            ),
        }
    }

    pub fn notify_rust_panic(message: String, location: String) {
        Self::send_event(FrontendEvent::RustPanic { message, location });
    }

    pub fn notify_timer_updated(profile_index: String) {
        Self::send_event(FrontendEvent::TimerUpdated { profile_index });
    }

    pub fn notify_profile_update_started(uid: String) {
        Self::send_event(FrontendEvent::ProfileUpdateStarted { uid });
    }

    pub fn notify_profile_update_completed(uid: String) {
        Self::send_event(FrontendEvent::ProfileUpdateCompleted { uid });
        Self::spawn_proxy_snapshot();
    }

    pub fn notify_proxies_updated(payload: Value) {
        Self::send_event(FrontendEvent::ProxiesUpdated { payload });
    }

    pub async fn build_proxy_snapshot() -> Option<Value> {
        let mihomo_guard = Self::mihomo().await;
        let proxies = match mihomo_guard.get_proxies().await {
            Ok(data) => match serde_json::to_value(&data) {
                Ok(value) => value,
                Err(error) => {
                    logging!(
                        warn,
                        Type::Frontend,
                        "Failed to serialize proxies snapshot: {error}"
                    );
                    return None;
                }
            },
            Err(error) => {
                logging!(
                    warn,
                    Type::Frontend,
                    "Failed to fetch proxies for snapshot: {error}"
                );
                return None;
            }
        };

        drop(mihomo_guard);

        let providers_guard = Self::mihomo().await;
        let providers_value = match providers_guard.get_proxy_providers().await {
            Ok(data) => serde_json::to_value(&data).unwrap_or_else(|error| {
                logging!(
                    warn,
                    Type::Frontend,
                    "Failed to serialize proxy providers for snapshot: {error}"
                );
                Value::Null
            }),
            Err(error) => {
                logging!(
                    warn,
                    Type::Frontend,
                    "Failed to fetch proxy providers for snapshot: {error}"
                );
                Value::Null
            }
        };

        drop(providers_guard);

        let profile_guard = Config::profiles().await;
        let profile_id = profile_guard.latest_ref().current.clone();
        drop(profile_guard);

        let emitted_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);

        let payload = json!({
            "proxies": proxies,
            "providers": providers_value,
            "profileId": profile_id,
            "emittedAt": emitted_at,
        });

        Some(payload)
    }

    fn spawn_proxy_snapshot() {
        tauri::async_runtime::spawn(async {
            if let Some(payload) = Handle::build_proxy_snapshot().await {
                Handle::notify_proxies_updated(payload);
            }
        });
    }

    pub fn notice_message<S: Into<String>, M: Into<String>>(status: S, msg: M) {
        let handle = Self::global();
        let status_str = status.into();
        let msg_str = msg.into();

        if !*handle.startup_completed.read() {
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

        logging!(
            info,
            Type::Frontend,
            "Frontend notice start (status={}, msg={})",
            status_str,
            msg_str
        );

        if BYPASS_NOTICE_MESSAGE_STATIC || Self::should_bypass_notice_message() {
            logging!(
                warn,
                Type::Frontend,
                "Frontend notice bypassed (static={}, env={}, status={})",
                BYPASS_NOTICE_MESSAGE_STATIC,
                env::var("CVR_BYPASS_NOTICE_MESSAGE").unwrap_or_else(|_| "unset".into()),
                status_str
            );
            return;
        }

        let event = FrontendEvent::NoticeMessage {
            status: status_str.clone(),
            message: msg_str.clone(),
        };

        let result = std::panic::catch_unwind(|| Self::send_event(event));
        match result {
            Ok(_) => logging!(
                info,
                Type::Frontend,
                "Frontend notice completed (status={})",
                status_str
            ),
            Err(payload) => logging!(
                error,
                Type::Frontend,
                "Frontend notice panicked (status={}, payload={})",
                status_str,
                describe_panic(payload.as_ref())
            ),
        }
    }

    fn should_bypass_profile_switch_finished() -> bool {
        match env::var("CVR_BYPASS_PROFILE_SWITCH_FINISHED") {
            Ok(value) => value != "0",
            Err(_) => false,
        }
    }

    fn should_bypass_notice_message() -> bool {
        match env::var("CVR_BYPASS_NOTICE_MESSAGE") {
            Ok(value) => value != "0",
            Err(_) => false,
        }
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

    pub fn mark_startup_completed(&self) {
        *self.startup_completed.write() = true;
        self.send_startup_errors();
    }

    fn send_startup_errors(&self) {
        let errors = {
            let mut errors = self.startup_errors.write();
            std::mem::take(&mut *errors)
        };

        if errors.is_empty() {
            return;
        }

        let _ = thread::Builder::new()
            .name("startup-errors-sender".into())
            .spawn(move || {
                thread::sleep(timing::STARTUP_ERROR_DELAY);

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

                        thread::sleep(timing::ERROR_BATCH_DELAY);
                    }
                }
            });
    }

    pub fn set_is_exiting(&self) {
        *self.is_exiting.write() = true;

        let mut system_opt = self.notification_system.write();
        if let Some(system) = system_opt.as_mut() {
            system.shutdown();
        }
    }

    pub fn is_exiting(&self) -> bool {
        *self.is_exiting.read()
    }
}

pub(crate) fn describe_panic(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string().into()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone().into()
    } else {
        "unknown panic".into()
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
