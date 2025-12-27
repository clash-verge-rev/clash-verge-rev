use crate::core::handle;
use clash_verge_i18n;
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
    // It cause to sync set-local everytime notify, so move it outside
    // i18n::sync_locale().await;

    match event {
        NotificationEvent::DashboardToggled => {
            let title = clash_verge_i18n::t!("notifications.dashboardToggled.title");
            let body = clash_verge_i18n::t!("notifications.dashboardToggled.body");
            notify(&title, &body);
        }
        NotificationEvent::ClashModeChanged { mode } => {
            let title = clash_verge_i18n::t!("notifications.clashModeChanged.title");
            let body = clash_verge_i18n::t!("notifications.clashModeChanged.body").replace("{mode}", mode);
            notify(&title, &body);
        }
        NotificationEvent::SystemProxyToggled => {
            let title = clash_verge_i18n::t!("notifications.systemProxyToggled.title");
            let body = clash_verge_i18n::t!("notifications.systemProxyToggled.body");
            notify(&title, &body);
        }
        NotificationEvent::TunModeToggled => {
            let title = clash_verge_i18n::t!("notifications.tunModeToggled.title");
            let body = clash_verge_i18n::t!("notifications.tunModeToggled.body");
            notify(&title, &body);
        }
        NotificationEvent::LightweightModeEntered => {
            let title = clash_verge_i18n::t!("notifications.lightweightModeEntered.title");
            let body = clash_verge_i18n::t!("notifications.lightweightModeEntered.body");
            notify(&title, &body);
        }
        NotificationEvent::ProfilesReactivated => {
            let title = clash_verge_i18n::t!("notifications.profilesReactivated.title");
            let body = clash_verge_i18n::t!("notifications.profilesReactivated.body");
            notify(&title, &body);
        }
        NotificationEvent::AppQuit => {
            let title = clash_verge_i18n::t!("notifications.appQuit.title");
            let body = clash_verge_i18n::t!("notifications.appQuit.body");
            notify(&title, &body);
        }
        #[cfg(target_os = "macos")]
        NotificationEvent::AppHidden => {
            let title = clash_verge_i18n::t!("notifications.appHidden.title");
            let body = clash_verge_i18n::t!("notifications.appHidden.body");
            notify(&title, &body);
        }
    }
}
