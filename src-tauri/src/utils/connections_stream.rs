use crate::{Type, core::handle, logging};
use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;
use tauri_plugin_mihomo::models::{ConnectionId, WebSocketMessage};
use tokio::sync::mpsc;
use tokio::time::Instant;

/// Mihomo WebSocket 流的有界队列容量，避免异常场景下内存无限增长。
const MIHOMO_WS_STREAM_BUFFER_SIZE: usize = 8;
/// 断开 Mihomo WebSocket 连接时使用的关闭码（RFC 6455 标准正常关闭）。
const MIHOMO_WS_STREAM_CLOSE_CODE: u64 = 1000;

/// `/traffic` 即时速率事件（字节/秒）。
#[derive(Debug, Clone, Copy)]
pub struct TrafficSpeedEvent {
    pub up: u64,
    pub down: u64,
}

/// Mihomo WebSocket 流消费状态。
pub enum StreamConsumeState<T> {
    /// 收到一条业务事件。
    Event(T),
    /// 连接关闭或消息流结束。
    Closed,
    /// 在超时时间内未收到有效事件，需要重连。
    Stale,
    /// 上层请求退出消费循环。
    ExitRequested,
}

enum InternalWsEvent<T> {
    Data(T),
    Closed,
}

/// Mihomo WebSocket 订阅句柄（通用事件流）。
pub struct MihomoWsEventStream<T> {
    /// 当前订阅连接 ID，用于主动断开。
    pub connection_id: ConnectionId,
    /// 当前订阅消息接收器。
    receiver: mpsc::Receiver<InternalWsEvent<T>>,
    /// 最近一次收到有效事件的时间戳。
    last_valid_event_at: Instant,
}

#[derive(Deserialize)]
struct TrafficPayload {
    up: u64,
    down: u64,
}

fn parse_traffic_event(data: Value) -> Option<InternalWsEvent<TrafficSpeedEvent>> {
    if let Ok(payload) = serde_json::from_value::<TrafficPayload>(data.clone()) {
        return Some(InternalWsEvent::Data(TrafficSpeedEvent {
            up: payload.up,
            down: payload.down,
        }));
    }

    if let Ok(ws_message) = WebSocketMessage::deserialize(&data) {
        match ws_message {
            WebSocketMessage::Text(text) => {
                let payload = serde_json::from_str::<TrafficPayload>(&text).ok()?;
                Some(InternalWsEvent::Data(TrafficSpeedEvent {
                    up: payload.up,
                    down: payload.down,
                }))
            }
            WebSocketMessage::Close(_) => Some(InternalWsEvent::Closed),
            _ => None,
        }
    } else {
        None
    }
}

fn try_send_internal_event<T>(message_tx: &mpsc::Sender<InternalWsEvent<T>>, event: InternalWsEvent<T>) {
    if let Err(err) = message_tx.try_send(event) {
        match err {
            // 队列满时丢弃本次事件，下一次事件会继续覆盖更新。
            tokio::sync::mpsc::error::TrySendError::Full(_) => {}
            // 任务已结束时通道可能关闭，忽略即可。
            tokio::sync::mpsc::error::TrySendError::Closed(_) => {}
        }
    }
}

/// 建立 `/traffic` WebSocket 订阅（通用流）。
pub async fn connect_traffic_stream() -> Result<MihomoWsEventStream<TrafficSpeedEvent>> {
    // 使用有界 mpsc 通道承接回调事件，限制消息积压上限。
    let (message_tx, message_rx) = mpsc::channel::<InternalWsEvent<TrafficSpeedEvent>>(MIHOMO_WS_STREAM_BUFFER_SIZE);
    // 建立 Mihomo `/traffic` WebSocket 订阅。
    let connection_id = handle::Handle::mihomo()
        .await
        .ws_traffic({
            let message_tx = message_tx.clone();
            move |message| {
                if let Some(event) = parse_traffic_event(message) {
                    try_send_internal_event(&message_tx, event);
                }
            }
        })
        .await?;
    drop(message_tx);
    Ok(MihomoWsEventStream {
        connection_id,
        receiver: message_rx,
        last_valid_event_at: Instant::now(),
    })
}

impl<T> MihomoWsEventStream<T> {
    /// 等待下一次可用事件或结束状态。
    ///
    /// # Arguments
    /// * `idle_poll_interval` - 空闲检查间隔
    /// * `stale_timeout` - 无有效事件超时时间
    /// * `should_exit` - 上层退出判定函数
    pub async fn next_event<F>(
        &mut self,
        _idle_poll_interval: Duration, // 签名保留，但内部逻辑已进化为更高效的驱动方式
        stale_timeout: Duration,
        should_exit: F,
    ) -> StreamConsumeState<T>
    where
        F: Fn() -> bool,
    {
        let sleep = tokio::time::sleep(stale_timeout);
        tokio::pin!(sleep);

        loop {
            if should_exit() {
                return StreamConsumeState::ExitRequested;
            }

            tokio::select! {
                maybe_event = self.receiver.recv() => {
                    match maybe_event {
                        Some(InternalWsEvent::Data(event)) => {
                            self.last_valid_event_at = Instant::now();
                            sleep.as_mut().reset(self.last_valid_event_at + stale_timeout);
                            return StreamConsumeState::Event(event);
                        }
                        Some(InternalWsEvent::Closed) | None => return StreamConsumeState::Closed,
                    }
                }
                _ = &mut sleep => {
                    if self.last_valid_event_at.elapsed() >= stale_timeout {
                        return StreamConsumeState::Stale;
                    }
                    sleep.as_mut().reset(self.last_valid_event_at + stale_timeout);
                }
            }
        }
    }
}

/// 断开指定 Mihomo WebSocket 连接。
///
/// # Arguments
/// * `connection_id` - 目标连接 ID
pub async fn disconnect_connection(connection_id: ConnectionId) {
    if let Err(err) = handle::Handle::mihomo()
        .await
        .disconnect(connection_id, Some(MIHOMO_WS_STREAM_CLOSE_CODE))
        .await
    {
        logging!(debug, Type::Tray, "断开 Mihomo WebSocket 连接失败: {err}");
    }
}
