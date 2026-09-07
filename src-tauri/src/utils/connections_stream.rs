use crate::{Type, core::handle, logging};
use anyhow::Result;
use serde::Deserialize;
use std::time::Duration;
use tauri_plugin_mihomo::models::WsConnectionId;
use tokio::sync::mpsc;
use tokio::time::Instant;

/// Bounds memory use if the consumer falls behind the WebSocket.
const MIHOMO_WS_STREAM_BUFFER_SIZE: usize = 8;
const MIHOMO_WS_STREAM_CLOSE_CODE: u64 = 1000;

#[derive(Debug, Clone, Copy)]
pub struct TrafficSpeedEvent {
    pub up: u64,
    pub down: u64,
}

pub enum StreamConsumeState<T> {
    Event(T),
    Closed,
    Stale,
    ExitRequested,
}

enum InternalWsEvent<T> {
    Data(T),
}

pub struct MihomoWsEventStream<T> {
    pub connection_id: WsConnectionId,
    receiver: mpsc::Receiver<InternalWsEvent<T>>,
    last_valid_event_at: Instant,
}

#[derive(Deserialize)]
struct TrafficPayload {
    up: u64,
    down: u64,
}

fn parse_traffic_event(data: &[u8]) -> Option<InternalWsEvent<TrafficSpeedEvent>> {
    let payload = serde_json::from_slice::<TrafficPayload>(data).ok()?;
    Some(InternalWsEvent::Data(TrafficSpeedEvent {
        up: payload.up,
        down: payload.down,
    }))
}

fn try_send_internal_event<T>(message_tx: &mpsc::Sender<InternalWsEvent<T>>, event: InternalWsEvent<T>) {
    if let Err(err) = message_tx.try_send(event) {
        match err {
            // A later real-time sample supersedes one dropped from a full queue.
            tokio::sync::mpsc::error::TrySendError::Full(_) => {}
            tokio::sync::mpsc::error::TrySendError::Closed(_) => {}
        }
    }
}

pub async fn connect_traffic_stream() -> Result<MihomoWsEventStream<TrafficSpeedEvent>> {
    let (message_tx, message_rx) = mpsc::channel::<InternalWsEvent<TrafficSpeedEvent>>(MIHOMO_WS_STREAM_BUFFER_SIZE);
    let connection_id = handle::Handle::mihomo()
        .ws_traffic({
            let message_tx = message_tx.clone();
            move |message| {
                if let Some(event) = parse_traffic_event(&message) {
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
    pub async fn next_event<F>(&mut self, stale_timeout: Duration, should_exit: F) -> StreamConsumeState<T>
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
                        None => return StreamConsumeState::Closed,
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

pub async fn disconnect_connection(connection_id: WsConnectionId) {
    if let Err(err) = handle::Handle::mihomo()
        .disconnect(connection_id, Some(MIHOMO_WS_STREAM_CLOSE_CODE))
        .await
    {
        logging!(debug, Type::Tray, "断开 Mihomo WebSocket 连接失败: {err}");
    }
}
