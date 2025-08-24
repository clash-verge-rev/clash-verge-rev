use crate::utils::i18n::t;

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

pub async fn notify_event<'a>(app: AppHandle, event: NotificationEvent<'a>) {
    match event {
        NotificationEvent::DashboardToggled => {
            notify(
                &app,
                &t("DashboardToggledTitle").await,
                &t("DashboardToggledBody").await,
            );
        }
        NotificationEvent::ClashModeChanged { mode } => {
            notify(
                &app,
                &t("ClashModeChangedTitle").await,
                &t_with_args("ClashModeChangedBody", mode).await,
            );
        }
        NotificationEvent::SystemProxyToggled => {
            notify(
                &app,
                &t("SystemProxyToggledTitle").await,
                &t("SystemProxyToggledBody").await,
            );
        }
        NotificationEvent::TunModeToggled => {
            notify(
                &app,
                &t("TunModeToggledTitle").await,
                &t("TunModeToggledBody").await,
            );
        }
        NotificationEvent::LightweightModeEntered => {
            notify(
                &app,
                &t("LightweightModeEnteredTitle").await,
                &t("LightweightModeEnteredBody").await,
            );
        }
        NotificationEvent::AppQuit => {
            notify(&app, &t("AppQuitTitle").await, &t("AppQuitBody").await);
        }
        #[cfg(target_os = "macos")]
        NotificationEvent::AppHidden => {
            notify(&app, &t("AppHiddenTitle").await, &t("AppHiddenBody").await);
        }
    }
}

// 辅助函数，带参数的i18n
async fn t_with_args(key: &str, mode: &str) -> String {
    t(key).await.replace("{mode}", mode)
}
