use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub enum NotificationEvent<'a> {
    DashboardToggled,
    ClashModeChanged {
        mode: &'a str,
    },
    SystemProxyToggled,
    TunModeToggled,
    LightweightModeEntered,
    AppQuit,
    #[cfg(target_os = "macos")]
    AppHidden,
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .ok();
}

pub fn notify_event(app: &AppHandle, event: NotificationEvent) {
    use crate::utils::i18n::t;
    match event {
        NotificationEvent::DashboardToggled => {
            notify(
                app,
                &t("notification.dashboardToggled.title"),
                &t("notification.dashboardToggled.body"),
            );
        }
        NotificationEvent::ClashModeChanged { mode } => {
            notify(
                app,
                &t("notification.clashModeChanged.title"),
                &t_with_args("notification.clashModeChanged.body", mode),
            );
        }
        NotificationEvent::SystemProxyToggled => {
            notify(
                app,
                &t("notification.systemProxyToggled.title"),
                &t("notification.systemProxyToggled.body"),
            );
        }
        NotificationEvent::TunModeToggled => {
            notify(
                app,
                &t("notification.tunModeToggled.title"),
                &t("notification.tunModeToggled.body"),
            );
        }
        NotificationEvent::LightweightModeEntered => {
            notify(
                app,
                &t("notification.lightweightModeEntered.title"),
                &t("notification.lightweightModeEntered.body"),
            );
        }
        NotificationEvent::AppQuit => {
            notify(
                app,
                &t("notification.appQuit.title"),
                &t("notification.appQuit.body"),
            );
        }
        #[cfg(target_os = "macos")]
        NotificationEvent::AppHidden => {
            notify(
                app,
                &t("notification.appHidden.title"),
                &t("notification.appHidden.body"),
            );
        }
    }
}

// 辅助函数，带参数的i18n
fn t_with_args(key: &str, mode: &str) -> String {
    use crate::utils::i18n::t;
    t(key).replace("{mode}", mode)
}
