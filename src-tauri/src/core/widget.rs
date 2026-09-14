use crate::{cmd, config::IVerge, core::handle::Handle, feat, process::AsyncHandler};
use clash_verge_widget::{Action, Backend, Mode, Status};
use tauri_plugin_mihomo::models::ClashMode;

struct AppBackend;

impl Backend for AppBackend {
    async fn snapshot(&self) -> Status {
        let core = Handle::mihomo().get_base_config().await;
        let proxy = {
            let manual = cmd::network::get_sys_proxy()
                .await
                .ok()
                .and_then(|v| v.get("enable").and_then(|v| v.as_bool()));
            let pac = cmd::network::get_auto_proxy()
                .await
                .ok()
                .and_then(|v| v.get("enable").and_then(|v| v.as_bool()));
            match (manual, pac) {
                (Some(true), _) | (_, Some(true)) => Some(true),
                (Some(false), Some(false)) => Some(false),
                _ => None,
            }
        };
        let (mode, tun) = match core {
            Ok(config) => (
                Some(match config.mode {
                    ClashMode::Rule => Mode::Rule,
                    ClashMode::Global => Mode::Global,
                    ClashMode::Direct => Mode::Direct,
                }),
                Some(config.tun.enable),
            ),
            _ => (None, None),
        };
        Status {
            mode,
            tun,
            proxy,
            error: None,
            language: clash_verge_i18n::current_language(
                crate::config::Config::verge().await.data_arc().language.as_deref(),
            )
            .into_owned(),
        }
    }

    async fn language(&self) -> String {
        clash_verge_i18n::current_language(crate::config::Config::verge().await.data_arc().language.as_deref())
            .into_owned()
    }

    async fn apply(&self, action: Action) -> Result<(), String> {
        if Handle::global().is_exiting() {
            return Err("widget.unavailable".into());
        }
        match action {
            Action::Mode(mode) => feat::change_clash_mode(mode.as_str().into())
                .await
                .map_err(|_| "widget.failed".into()),
            Action::Tun(_) | Action::Proxy(_) => {
                let payload = IVerge {
                    enable_tun_mode: match action {
                        Action::Tun(value) => Some(value),
                        _ => None,
                    },
                    enable_system_proxy: match action {
                        Action::Proxy(value) => Some(value),
                        _ => None,
                    },
                    ..Default::default()
                };
                cmd::verge::patch_verge_config(payload)
                    .await
                    .map_err(|_| "widget.failed".into())
            }
        }
    }
}

pub fn start() {
    AsyncHandler::spawn(|| async { clash_verge_widget::start(AppBackend) });
}
