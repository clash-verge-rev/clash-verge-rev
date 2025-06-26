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
            notify(app, &t("DashboardToggledTitle"), &t("DashboardToggledBody"));
        }
        NotificationEvent::ClashModeChanged { mode } => {
            notify(
                app,
                &t("ClashModeChangedTitle"),
                &t_with_args("ClashModeChangedBody", mode),
            );
        }
        NotificationEvent::SystemProxyToggled => {
            notify(
                app,
                &t("SystemProxyToggledTitle"),
                &t("SystemProxyToggledBody"),
            );
        }
        NotificationEvent::TunModeToggled => {
            notify(app, &t("TunModeToggledTitle"), &t("TunModeToggledBody"));
        }
        NotificationEvent::LightweightModeEntered => {
            notify(
                app,
                &t("LightweightModeEnteredTitle"),
                &t("LightweightModeEnteredBody"),
            );
        }
        NotificationEvent::AppQuit => {
            notify(app, &t("AppQuitTitle"), &t("AppQuitBody"));
        }
        #[cfg(target_os = "macos")]
        NotificationEvent::AppHidden => {
            notify(app, &t("AppHiddenTitle"), &t("AppHiddenBody"));
        }
    }
}

// 辅助函数，带参数的i18n
fn t_with_args(key: &str, mode: &str) -> String {
    use crate::utils::i18n::t;
    t(key).replace("{mode}", mode)
}
