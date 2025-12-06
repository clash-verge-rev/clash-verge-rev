use crate::{core::handle, utils::i18n};
use tauri_plugin_notification::NotificationExt as _;

pub enum NotificationEvent<'a> {
    DashboardToggled,
    ClashModeChanged {
        mode: &'a str,
    },
    SystemProxyToggled,
    TunModeToggled,
    LightweightModeEntered,
    ProfilesReactivated,
    AppQuit,
    #[cfg(target_os = "macos")]
    AppHidden,
}

fn notify(title: &str, body: &str) {
    let app_handle = handle::Handle::app_handle();
    app_handle.notification().builder().title(title).body(body).show().ok();
}

pub async fn notify_event<'a>(event: NotificationEvent<'a>) {
    i18n::sync_locale().await;

    match event {
        NotificationEvent::DashboardToggled => {
            let title = rust_i18n::t!("notifications.dashboardToggled.title").to_string();
            let body = rust_i18n::t!("notifications.dashboardToggled.body").to_string();
            notify(&title, &body);
        }
        NotificationEvent::ClashModeChanged { mode } => {
            let title = rust_i18n::t!("notifications.clashModeChanged.title").to_string();
            let body = rust_i18n::t!("notifications.clashModeChanged.body").replace("{mode}", mode);
            notify(&title, &body);
        }
        NotificationEvent::SystemProxyToggled => {
            let title = rust_i18n::t!("notifications.systemProxyToggled.title").to_string();
            let body = rust_i18n::t!("notifications.systemProxyToggled.body").to_string();
            notify(&title, &body);
        }
        NotificationEvent::TunModeToggled => {
            let title = rust_i18n::t!("notifications.tunModeToggled.title").to_string();
            let body = rust_i18n::t!("notifications.tunModeToggled.body").to_string();
            notify(&title, &body);
        }
        NotificationEvent::LightweightModeEntered => {
            let title = rust_i18n::t!("notifications.lightweightModeEntered.title").to_string();
            let body = rust_i18n::t!("notifications.lightweightModeEntered.body").to_string();
            notify(&title, &body);
        }
        NotificationEvent::ProfilesReactivated => {
            let title = rust_i18n::t!("notifications.profilesReactivated.title").to_string();
            let body = rust_i18n::t!("notifications.profilesReactivated.body").to_string();
            notify(&title, &body);
        }
        NotificationEvent::AppQuit => {
            let title = rust_i18n::t!("notifications.appQuit.title").to_string();
            let body = rust_i18n::t!("notifications.appQuit.body").to_string();
            notify(&title, &body);
        }
        #[cfg(target_os = "macos")]
        NotificationEvent::AppHidden => {
            let title = rust_i18n::t!("notifications.appHidden.title").to_string();
            let body = rust_i18n::t!("notifications.appHidden.body").to_string();
            notify(&title, &body);
        }
    }
}
