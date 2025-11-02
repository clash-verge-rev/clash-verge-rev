use crate::{core::handle, utils::i18n::t};

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

fn notify(title: &str, body: &str) {
    let app_handle = handle::Handle::app_handle();
    app_handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .ok();
}

pub async fn notify_event<'a>(event: NotificationEvent<'a>) {
    match event {
        NotificationEvent::DashboardToggled => {
            notify(
                &t("DashboardToggledTitle").await,
                &t("DashboardToggledBody").await,
            );
        }
        NotificationEvent::ClashModeChanged { mode } => {
            notify(
                &t("ClashModeChangedTitle").await,
                &t_with_args("ClashModeChangedBody", mode).await,
            );
        }
        NotificationEvent::SystemProxyToggled => {
            notify(
                &t("SystemProxyToggledTitle").await,
                &t("SystemProxyToggledBody").await,
            );
        }
        NotificationEvent::TunModeToggled => {
            notify(
                &t("TunModeToggledTitle").await,
                &t("TunModeToggledBody").await,
            );
        }
        NotificationEvent::LightweightModeEntered => {
            notify(
                &t("LightweightModeEnteredTitle").await,
                &t("LightweightModeEnteredBody").await,
            );
        }
        NotificationEvent::AppQuit => {
            notify(&t("AppQuitTitle").await, &t("AppQuitBody").await);
        }
        #[cfg(target_os = "macos")]
        NotificationEvent::AppHidden => {
            notify(&t("AppHiddenTitle").await, &t("AppHiddenBody").await);
        }
    }
}

// 辅助函数，带参数的i18n
async fn t_with_args(key: &str, mode: &str) -> String {
    t(key).await.replace("{mode}", mode)
}
