use crate::core::handle;
use crate::process::AsyncHandler;
use crate::utils::{connections_stream, tray_speed};
use crate::{Type, logging};
use parking_lot::Mutex;
use std::sync::Arc;
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri_plugin_mihomo::models::ConnectionId;

/// 托盘速率流异常后的重连间隔。
const TRAY_SPEED_RETRY_DELAY: Duration = Duration::from_secs(1);
/// 托盘速率流运行时的空闲轮询间隔。
const TRAY_SPEED_IDLE_POLL_INTERVAL: Duration = Duration::from_millis(200);
/// 托盘速率流在此时间内收不到有效数据时，触发重连并降级到 0/0。
const TRAY_SPEED_STALE_TIMEOUT: Duration = Duration::from_secs(5);

/// macOS 托盘速率任务控制器。
#[derive(Clone)]
pub struct TraySpeedController {
    speed_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    speed_connection_id: Arc<Mutex<Option<ConnectionId>>>,
}

impl Default for TraySpeedController {
    fn default() -> Self {
        Self {
            speed_task: Arc::new(Mutex::new(None)),
            speed_connection_id: Arc::new(Mutex::new(None)),
        }
    }
}

impl TraySpeedController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update_task(&self, enable_tray_speed: bool) {
        if enable_tray_speed {
            self.start_task();
        } else {
            self.stop_task();
        }
    }

    /// 启动托盘速率采集后台任务（基于 `/traffic` WebSocket 流）。
    fn start_task(&self) {
        if handle::Handle::global().is_exiting() {
            return;
        }

        // 关键步骤：托盘不可用时不启动速率任务，避免无效连接重试。
        if !Self::has_main_tray() {
            logging!(warn, Type::Tray, "托盘不可用，跳过启动托盘速率任务");
            return;
        }

        let mut guard = self.speed_task.lock();
        if guard.as_ref().is_some_and(|task| !task.inner().is_finished()) {
            return;
        }

        let speed_connection_id = Arc::clone(&self.speed_connection_id);
        let task = AsyncHandler::spawn(move || async move {
            loop {
                if handle::Handle::global().is_exiting() {
                    break;
                }

                if !Self::has_main_tray() {
                    logging!(warn, Type::Tray, "托盘已不可用，停止托盘速率任务");
                    break;
                }

                let stream_connect_result = connections_stream::connect_traffic_stream().await;
                let mut speed_stream = match stream_connect_result {
                    Ok(stream) => stream,
                    Err(err) => {
                        logging!(debug, Type::Tray, "托盘速率流连接失败，稍后重试: {err}");
                        Self::apply_tray_speed(0, 0);
                        tokio::time::sleep(TRAY_SPEED_RETRY_DELAY).await;
                        continue;
                    }
                };

                Self::set_speed_connection_id(&speed_connection_id, Some(speed_stream.connection_id));

                loop {
                    let next_state = speed_stream
                        .next_event(TRAY_SPEED_IDLE_POLL_INTERVAL, TRAY_SPEED_STALE_TIMEOUT, || {
                            handle::Handle::global().is_exiting()
                        })
                        .await;

                    match next_state {
                        connections_stream::StreamConsumeState::Event(speed_event) => {
                            Self::apply_tray_speed(speed_event.up, speed_event.down);
                        }
                        connections_stream::StreamConsumeState::Stale => {
                            logging!(debug, Type::Tray, "托盘速率流长时间未收到有效数据，触发重连");
                            Self::apply_tray_speed(0, 0);
                            break;
                        }
                        connections_stream::StreamConsumeState::Closed
                        | connections_stream::StreamConsumeState::ExitRequested => {
                            break;
                        }
                    }
                }

                Self::disconnect_speed_connection(&speed_connection_id).await;

                if handle::Handle::global().is_exiting() || !Self::has_main_tray() {
                    break;
                }

                // Stale 分支在内层 loop 中已重置为 0/0；此处兜底 Closed 分支（流被远端关闭）。
                Self::apply_tray_speed(0, 0);
                tokio::time::sleep(TRAY_SPEED_RETRY_DELAY).await;
            }

            Self::set_speed_connection_id(&speed_connection_id, None);
        });

        *guard = Some(task);
    }

    /// 停止托盘速率采集后台任务并清除速率显示。
    fn stop_task(&self) {
        // 取出任务句柄，与 speed_connection_id 一同传入清理任务。
        let task = self.speed_task.lock().take();
        let speed_connection_id = Arc::clone(&self.speed_connection_id);

        AsyncHandler::spawn(move || async move {
            // 关键步骤：先等待 abort 完成，再断开 WebSocket 连接。
            // 若直接 abort 后立即 disconnect，任务可能已通过 take 取走 connection_id
            // 但尚未完成断开，导致 connection_id 丢失、连接泄漏。
            // await task handle 可保证原任务已退出，connection_id 不再被占用。
            if let Some(task) = task {
                task.abort();
                let _ = task.await;
            }
            Self::disconnect_speed_connection(&speed_connection_id).await;
        });

        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
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
        handle::Handle::app_handle().tray_by_id("main").is_some()
    }

    fn set_speed_connection_id(
        speed_connection_id: &Arc<Mutex<Option<ConnectionId>>>,
        connection_id: Option<ConnectionId>,
    ) {
        *speed_connection_id.lock() = connection_id;
    }

    fn take_speed_connection_id(speed_connection_id: &Arc<Mutex<Option<ConnectionId>>>) -> Option<ConnectionId> {
        speed_connection_id.lock().take()
    }

    async fn disconnect_speed_connection(speed_connection_id: &Arc<Mutex<Option<ConnectionId>>>) {
        if let Some(connection_id) = Self::take_speed_connection_id(speed_connection_id) {
            connections_stream::disconnect_connection(connection_id).await;
        }
    }

    fn apply_tray_speed(up: u64, down: u64) {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id("main") {
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
