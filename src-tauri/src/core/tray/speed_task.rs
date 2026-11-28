use crate::core::handle;
use crate::process::AsyncHandler;
use crate::utils::{connections_stream, tray_speed};
use crate::{Type, logging};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::watch;

use connections_stream::{MihomoWsEventStream, StreamConsumeState, TrafficSpeedEvent};

const TRAY_SPEED_RETRY_DELAY: Duration = Duration::from_secs(1);
const TRAY_SPEED_STALE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct TraySpeedController {
    enabled: OnceLock<watch::Sender<bool>>,
}

impl TraySpeedController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update_task(&self, enable_tray_speed: bool) {
        let enabled = self.enabled.get_or_init(|| {
            let (enabled, receiver) = watch::channel(false);
            AsyncHandler::spawn(move || Self::run(receiver));
            enabled
        });
        enabled.send_replace(enable_tray_speed);
    }

    async fn run(mut enabled: watch::Receiver<bool>) {
        while enabled.changed().await.is_ok() {
            let should_run = *enabled.borrow_and_update();
            if should_run {
                Self::run_enabled(&mut enabled).await;
            } else {
                Self::clear_tray_speed();
            }
        }
    }

    async fn run_enabled(enabled: &mut watch::Receiver<bool>) {
        while !handle::Handle::global().is_exiting() {
            if !Self::has_main_tray() {
                logging!(warn, Type::Tray, "托盘不可用，停止托盘速率任务");
                return;
            }

            // Keep the registered stream outside the cancellable future until it is disconnected.
            let mut stream = None;
            let disabled = tokio::select! {
                biased;
                _ = Self::wait_until_disabled(enabled) => true,
                _ = Self::read_speed(&mut stream) => false,
            };
            if disabled {
                Self::clear_tray_speed();
            }
            if let Some(stream) = stream {
                let disconnect = connections_stream::disconnect_connection(stream.connection_id);
                tokio::pin!(disconnect);
                tokio::select! {
                    biased;
                    _ = Self::wait_until_disabled(enabled), if !disabled => {
                        Self::clear_tray_speed();
                        disconnect.await;
                        return;
                    }
                    _ = &mut disconnect => {}
                }
            }
            if disabled || handle::Handle::global().is_exiting() || !Self::has_main_tray() {
                return;
            }

            if *enabled.borrow() {
                Self::apply_tray_speed(0, 0);
            }
            if tokio::time::timeout(TRAY_SPEED_RETRY_DELAY, Self::wait_until_disabled(enabled))
                .await
                .is_ok()
            {
                Self::clear_tray_speed();
                return;
            }
        }
    }

    async fn wait_until_disabled(enabled: &mut watch::Receiver<bool>) {
        let _ = enabled.wait_for(|enabled| !enabled).await;
    }

    async fn read_speed(stream: &mut Option<MihomoWsEventStream<TrafficSpeedEvent>>) {
        let speed_stream = match connections_stream::connect_traffic_stream().await {
            Ok(connected) => stream.insert(connected),
            Err(err) => {
                logging!(debug, Type::Tray, "托盘速率流连接失败，稍后重试: {err}");
                return;
            }
        };

        loop {
            match speed_stream
                .next_event(TRAY_SPEED_STALE_TIMEOUT, || handle::Handle::global().is_exiting())
                .await
            {
                StreamConsumeState::Event(event) => Self::apply_tray_speed(event.up, event.down),
                StreamConsumeState::Stale => {
                    logging!(debug, Type::Tray, "托盘速率流长时间未收到有效数据，触发重连");
                    Self::apply_tray_speed(0, 0);
                    return;
                }
                StreamConsumeState::Closed | StreamConsumeState::ExitRequested => return,
            }
        }
    }

    fn clear_tray_speed() {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id(super::TRAY_ID) {
            let result = tray.with_inner_tray_icon(|inner| {
                if let Some(status_item) = inner.ns_status_item() {
                    tray_speed::clear_speed_attributed_title(&status_item);
                }
            });
            if let Err(err) = result {
                logging!(warn, Type::Tray, "清除富文本速率失败: {err}");
            }
        }
    }

    fn has_main_tray() -> bool {
        handle::Handle::app_handle().tray_by_id(super::TRAY_ID).is_some()
    }

    fn apply_tray_speed(up: u64, down: u64) {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id(super::TRAY_ID) {
            let result = tray.with_inner_tray_icon(move |inner| {
                if let Some(status_item) = inner.ns_status_item() {
                    tray_speed::set_speed_attributed_title(&status_item, up, down);
                }
            });
            if let Err(err) = result {
                logging!(warn, Type::Tray, "设置富文本速率失败: {err}");
            }
        }
    }
}
