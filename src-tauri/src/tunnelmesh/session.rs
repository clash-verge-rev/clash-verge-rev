//! One multiplexed TunnelMesh client session.
//!
//! A session has one receive dispatcher and an independent, serialized
//! transport writer.  Logical streams are represented by bounded channels so
//! a slow local proxy cannot allocate unbounded memory from peer DATA frames.

use super::protocol::{
    ClientMetadataPayload, FLAG_FIN, Frame, FrameType, MAX_PAYLOAD, ProtocolError, StreamOpenPayload,
    encode_client_metadata_payload, encode_stream_open_payload, encode_window_update,
};
use super::transport::{FrameTransport, TransportError};
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tokio::sync::{Mutex, Notify, OnceCell, RwLock, mpsc};
use tokio_util::sync::CancellationToken;

const DEFAULT_STREAM_WINDOW: u32 = 256 * 1024;
const DEFAULT_WINDOW_UPDATE_THRESHOLD: u32 = 128 * 1024;
const INBOUND_QUEUE: usize = 32;
const MAX_STREAM_CHUNK: usize = 16 * 1024;

/// Session-level failures are sanitized and never include connection secrets.
#[derive(Debug)]
pub enum SessionError {
    Closed,
    Cancelled,
    Transport(TransportError),
    Protocol(ProtocolError),
    FlowControl,
    StreamReset,
    OpenRejected,
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => f.write_str("TunnelMesh session is closed"),
            Self::Cancelled => f.write_str("TunnelMesh session was cancelled"),
            Self::Transport(error) => write!(f, "TunnelMesh transport failed: {error}"),
            Self::Protocol(error) => write!(f, "TunnelMesh protocol failed: {error}"),
            Self::FlowControl => f.write_str("TunnelMesh stream flow-control violation"),
            Self::StreamReset => f.write_str("TunnelMesh stream was reset"),
            Self::OpenRejected => f.write_str("TunnelMesh stream open was rejected"),
        }
    }
}

impl std::error::Error for SessionError {}

impl From<TransportError> for SessionError {
    fn from(error: TransportError) -> Self {
        Self::Transport(error)
    }
}

impl From<ProtocolError> for SessionError {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error)
    }
}

/// Request used to create one logical remote stream.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamRequest {
    pub stream_id: Option<u32>,
    pub agent_id: Option<String>,
    pub protocol: String,
    pub target_host: String,
    pub target_port: u16,
    pub target_scheme: Option<String>,
    pub host_header: Option<String>,
    pub tls_server_name: Option<String>,
    pub metadata: Option<Vec<u8>>,
    pub receive_window: u32,
}

impl StreamRequest {
    #[must_use]
    pub fn new(agent_id: impl Into<String>, protocol: impl Into<String>, host: impl Into<String>, port: u16) -> Self {
        Self {
            stream_id: None,
            agent_id: Some(agent_id.into()),
            protocol: protocol.into(),
            target_host: host.into(),
            target_port: port,
            target_scheme: None,
            host_header: None,
            tls_server_name: None,
            metadata: None,
            receive_window: DEFAULT_STREAM_WINDOW,
        }
    }

    #[must_use]
    pub fn tcp(agent_id: impl Into<String>, host: impl Into<String>, port: u16) -> Self {
        Self::new(agent_id, "tcp", host, port)
    }
}

enum StreamEvent {
    Data(Vec<u8>),
    HalfClose,
    Reset,
}

struct StreamState {
    id: u32,
    events: mpsc::Sender<StreamEvent>,
    send_window: Mutex<u32>,
    send_credit: Notify,
    receive_window: Mutex<u32>,
    consumed: Mutex<u32>,
    ended: AtomicBool,
    open_result: Mutex<Option<tokio::sync::oneshot::Sender<bool>>>,
}

struct SessionInner {
    transport: Arc<dyn FrameTransport>,
    cancel: CancellationToken,
    streams: RwLock<HashMap<u32, Arc<StreamState>>>,
    next_stream_id: AtomicU32,
    started: AtomicBool,
    done: OnceCell<SessionError>,
}

/// A cloneable session handle.  Calling [`Self::start`] exactly once launches
/// the receive dispatcher; all other methods are safe to use concurrently.
#[derive(Clone)]
pub struct TunnelMeshSession {
    inner: Arc<SessionInner>,
}

impl fmt::Debug for TunnelMeshSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TunnelMeshSession")
            .field("selected_subprotocol", &self.selected_subprotocol())
            .finish_non_exhaustive()
    }
}

impl TunnelMeshSession {
    /// Wraps a concrete transport in a session.  This is the ergonomic entry
    /// point for production WebSocket connections while [`Self::new`] remains
    /// available for dependency-injected test transports.
    #[must_use]
    pub fn from_transport<T>(transport: T) -> Self
    where
        T: FrameTransport + 'static,
    {
        Self::new(Arc::new(transport))
    }

    #[must_use]
    pub fn new(transport: Arc<dyn FrameTransport>) -> Self {
        Self {
            inner: Arc::new(SessionInner {
                transport,
                cancel: CancellationToken::new(),
                streams: RwLock::new(HashMap::new()),
                next_stream_id: AtomicU32::new(1),
                started: AtomicBool::new(false),
                done: OnceCell::new(),
            }),
        }
    }

    #[must_use]
    pub fn selected_subprotocol(&self) -> &str {
        self.inner.transport.selected_subprotocol()
    }

    /// Starts the receive loop.  It is harmless to call this more than once.
    pub fn start(&self) {
        if self.inner.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let session = self.clone();
        tokio::spawn(async move {
            if session.selected_subprotocol() == super::transport::SUBPROTOCOL_CLIENT_METADATA {
                let payload = ClientMetadataPayload {
                    instance_id: "clash-verge".into(),
                    version: env!("CARGO_PKG_VERSION").into(),
                    platform: std::env::consts::OS.into(),
                    reported_at: chrono::Utc::now().to_rfc3339(),
                    revision: 1,
                    ..Default::default()
                };
                if let Ok(encoded) = encode_client_metadata_payload(&payload) {
                    let _ = session
                        .inner
                        .transport
                        .send_frame(Frame::new(FrameType::ClientHello, 0).with_payload(encoded))
                        .await;
                }
            }
            session.receive_loop().await;
        });
    }

    /// Waits until the physical connection closes or is cancelled.
    pub async fn wait(&self) -> SessionError {
        if let Some(error) = self.inner.done.get() {
            return clone_session_error(error);
        }
        self.inner.cancel.cancelled().await;
        if let Some(error) = self.inner.done.get() {
            clone_session_error(error)
        } else {
            SessionError::Cancelled
        }
    }

    /// Cancels all streams and closes the underlying WebSocket.
    pub async fn close(&self) -> Result<(), SessionError> {
        self.inner.cancel.cancel();
        self.fail_streams(StreamEvent::Reset).await;
        self.inner.transport.close().await.map_err(Into::into)
    }

    /// Opens a logical stream and returns its bounded receive handle.
    pub async fn open_stream(
        &self,
        request: StreamRequest,
        cancel: &CancellationToken,
    ) -> Result<TunnelMeshStream, SessionError> {
        self.start();
        if self.inner.cancel.is_cancelled() {
            return Err(SessionError::Closed);
        }
        let id = request
            .stream_id
            .unwrap_or_else(|| self.inner.next_stream_id.fetch_add(2, Ordering::Relaxed));
        if id == 0 {
            return Err(SessionError::Protocol(ProtocolError::InvalidFrame(
                "stream ID zero is reserved",
            )));
        }
        let receive_window = if request.receive_window == 0 {
            DEFAULT_STREAM_WINDOW
        } else {
            request.receive_window
        };
        let (events, event_rx) = mpsc::channel(INBOUND_QUEUE);
        let (open_tx, open_rx) = tokio::sync::oneshot::channel();
        let strict = matches!(
            self.selected_subprotocol(),
            super::transport::SUBPROTOCOL_OPEN_RESULT
                | super::transport::SUBPROTOCOL_FLOW_CONTROL
                | super::transport::SUBPROTOCOL_CLIENT_METADATA
        );
        let state = Arc::new(StreamState {
            id,
            events,
            send_window: Mutex::new(DEFAULT_STREAM_WINDOW),
            send_credit: Notify::new(),
            receive_window: Mutex::new(receive_window),
            consumed: Mutex::new(0),
            ended: AtomicBool::new(false),
            open_result: Mutex::new(strict.then_some(open_tx)),
        });
        {
            let mut streams = self.inner.streams.write().await;
            if streams.contains_key(&id) {
                return Err(SessionError::Protocol(ProtocolError::InvalidFrame(
                    "stream ID already in use",
                )));
            }
            streams.insert(id, Arc::clone(&state));
        }
        let payload = encode_stream_open_payload(&StreamOpenPayload {
            agent_id: request.agent_id,
            protocol: request.protocol,
            target_host: request.target_host,
            target_port: request.target_port,
            target_scheme: request.target_scheme,
            host_header: request.host_header,
            tls_server_name: request.tls_server_name,
            metadata: request.metadata,
        })?;
        let frame = Frame::new(FrameType::OpenStream, id)
            .with_window(receive_window)
            .with_flags(if strict { super::protocol::FLAG_STRICT_OPEN } else { 0 })
            .with_payload(payload);
        if let Err(error) = self.inner.transport.send_frame(frame).await {
            self.inner.streams.write().await.remove(&id);
            return Err(error.into());
        }
        if strict {
            tokio::select! {
                result = open_rx => {
                    if !result.unwrap_or(false) {
                        self.inner.streams.write().await.remove(&id);
                        return Err(SessionError::OpenRejected);
                    }
                }
                _ = cancel.cancelled() => {
                    self.inner.streams.write().await.remove(&id);
                    let _ = self.send_reset(id).await;
                    return Err(SessionError::Cancelled);
                }
                _ = self.inner.cancel.cancelled() => {
                    self.inner.streams.write().await.remove(&id);
                    return Err(SessionError::Closed);
                }
            }
        }
        Ok(TunnelMeshStream {
            session: self.clone(),
            state,
            events: Mutex::new(event_rx),
        })
    }

    async fn send_reset(&self, id: u32) -> Result<(), SessionError> {
        self.inner
            .transport
            .send_frame(Frame::new(FrameType::Reset, id))
            .await
            .map_err(Into::into)
    }

    async fn receive_loop(&self) {
        loop {
            let frame = tokio::select! {
                _ = self.inner.cancel.cancelled() => {
                    self.finish(SessionError::Cancelled).await;
                    return;
                }
                result = self.inner.transport.receive_frame() => result,
            };
            let frame = match frame {
                Ok(frame) => frame,
                Err(error) => {
                    self.finish(error.into()).await;
                    return;
                }
            };
            if let Err(error) = self.dispatch(frame).await {
                self.finish(error).await;
                return;
            }
        }
    }

    async fn dispatch(&self, frame: Frame) -> Result<(), SessionError> {
        match frame.frame_type {
            FrameType::Ping => {
                self.inner
                    .transport
                    .send_frame(Frame::new(FrameType::Pong, 0).with_payload(frame.payload))
                    .await?;
            }
            FrameType::Pong => {}
            FrameType::GoAway => return Err(SessionError::Closed),
            FrameType::OpenResult => {
                let accepted = serde_json::from_slice::<OpenResult>(&frame.payload)
                    .map_err(|_| SessionError::Protocol(ProtocolError::InvalidPayload("invalid open result".into())))?
                    .accepted;
                let state = self.inner.streams.read().await.get(&frame.stream_id).cloned();
                if let Some(state) = state {
                    let sender = state.open_result.lock().await.take();
                    if let Some(sender) = sender {
                        let _ = sender.send(accepted);
                    }
                    if !accepted {
                        state.ended.store(true, Ordering::Release);
                        let _ = state.events.try_send(StreamEvent::Reset);
                    }
                }
            }
            FrameType::Data => {
                let stream_id = frame.stream_id;
                let closes = frame.flags & FLAG_FIN != 0;
                self.dispatch_data(stream_id, frame.payload).await?;
                if closes {
                    self.dispatch_half_close(stream_id).await;
                }
            }
            FrameType::HalfClose => self.dispatch_half_close(frame.stream_id).await,
            FrameType::Reset => self.dispatch_reset(frame.stream_id).await,
            FrameType::WindowUpdate => {
                if frame.window == 0 {
                    return Err(SessionError::Protocol(ProtocolError::InvalidFrame(
                        "window update must carry positive credit",
                    )));
                }
                let state = self.inner.streams.read().await.get(&frame.stream_id).cloned();
                if let Some(state) = state {
                    let mut window = state.send_window.lock().await;
                    *window = window.checked_add(frame.window).ok_or(SessionError::FlowControl)?;
                    drop(window);
                    state.send_credit.notify_waiters();
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn dispatch_data(&self, id: u32, payload: Vec<u8>) -> Result<(), SessionError> {
        if payload.len() > MAX_PAYLOAD {
            return Err(SessionError::Protocol(ProtocolError::PayloadTooLarge {
                length: payload.len(),
                maximum: MAX_PAYLOAD,
            }));
        }
        let state = self.inner.streams.read().await.get(&id).cloned();
        let Some(state) = state else {
            return Ok(());
        };
        let mut window = state.receive_window.lock().await;
        let size = u32::try_from(payload.len()).map_err(|_| SessionError::FlowControl)?;
        if size > *window {
            return Err(SessionError::FlowControl);
        }
        *window -= size;
        drop(window);
        tokio::select! {
            result = state.events.send(StreamEvent::Data(payload)) => result.map_err(|_| SessionError::Closed),
            _ = self.inner.cancel.cancelled() => Err(SessionError::Cancelled),
        }
    }

    async fn dispatch_half_close(&self, id: u32) {
        let state = self.inner.streams.read().await.get(&id).cloned();
        if let Some(state) = state {
            state.ended.store(true, Ordering::Release);
            let _ = state.events.try_send(StreamEvent::HalfClose);
        }
    }

    async fn dispatch_reset(&self, id: u32) {
        let state = self.inner.streams.write().await.remove(&id);
        if let Some(state) = state {
            state.ended.store(true, Ordering::Release);
            let _ = state.events.try_send(StreamEvent::Reset);
        }
    }

    async fn finish(&self, error: SessionError) {
        let _ = self.inner.done.set(error);
        self.inner.cancel.cancel();
        self.fail_streams(StreamEvent::Reset).await;
    }

    async fn fail_streams(&self, event: StreamEvent) {
        let streams = std::mem::take(&mut *self.inner.streams.write().await);
        for (_, state) in streams {
            state.ended.store(true, Ordering::Release);
            match event {
                StreamEvent::Reset => {
                    let _ = state.events.try_send(StreamEvent::Reset);
                }
                StreamEvent::HalfClose => {
                    let _ = state.events.try_send(StreamEvent::HalfClose);
                }
                StreamEvent::Data(_) => {}
            }
        }
    }
}

#[derive(Deserialize)]
struct OpenResult {
    accepted: bool,
}

const fn clone_session_error(error: &SessionError) -> SessionError {
    match error {
        SessionError::Closed => SessionError::Closed,
        SessionError::Cancelled => SessionError::Cancelled,
        SessionError::Transport(_) => SessionError::Closed,
        SessionError::Protocol(_) => SessionError::Closed,
        SessionError::FlowControl => SessionError::FlowControl,
        SessionError::StreamReset => SessionError::StreamReset,
        SessionError::OpenRejected => SessionError::OpenRejected,
    }
}

/// Handle for one logical stream in a multiplexed session.
pub struct TunnelMeshStream {
    session: TunnelMeshSession,
    state: Arc<StreamState>,
    events: Mutex<mpsc::Receiver<StreamEvent>>,
}

impl fmt::Debug for TunnelMeshStream {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TunnelMeshStream").field("id", &self.state.id).finish()
    }
}

impl TunnelMeshStream {
    #[must_use]
    pub fn id(&self) -> u32 {
        self.state.id
    }

    /// Sends DATA while honoring peer-advertised flow-control credit.
    pub async fn send_data(&self, data: &[u8], cancel: &CancellationToken) -> Result<(), SessionError> {
        let mut offset = 0;
        while offset < data.len() {
            let chunk_len = loop {
                if self.state.ended.load(Ordering::Acquire) {
                    return Err(SessionError::StreamReset);
                }
                let mut window = self.state.send_window.lock().await;
                if *window > 0 {
                    let amount = data
                        .len()
                        .saturating_sub(offset)
                        .min(*window as usize)
                        .min(MAX_STREAM_CHUNK);
                    *window -= amount as u32;
                    break amount;
                }
                drop(window);
                tokio::select! {
                    _ = self.state.send_credit.notified() => {}
                    _ = cancel.cancelled() => return Err(SessionError::Cancelled),
                    _ = self.session.inner.cancel.cancelled() => return Err(SessionError::Closed),
                }
            };
            let end = offset + chunk_len;
            let flags = if end == data.len() { FLAG_FIN } else { 0 };
            self.session
                .inner
                .transport
                .send_frame(
                    Frame::new(FrameType::Data, self.state.id)
                        .with_flags(flags)
                        .with_payload(data[offset..end].to_vec()),
                )
                .await?;
            offset = end;
        }
        Ok(())
    }

    /// Receives one DATA payload; `None` signals a remote half-close.
    pub async fn receive_data(&self, cancel: &CancellationToken) -> Result<Option<Vec<u8>>, SessionError> {
        let mut events = self.events.lock().await;
        let event = tokio::select! {
            event = events.recv() => event,
            _ = cancel.cancelled() => return Err(SessionError::Cancelled),
            _ = self.session.inner.cancel.cancelled() => return Err(SessionError::Closed),
        };
        drop(events);
        match event {
            Some(StreamEvent::Data(data)) => {
                let consumed = u32::try_from(data.len()).map_err(|_| SessionError::FlowControl)?;
                let update = {
                    let mut pending = self.state.consumed.lock().await;
                    *pending = pending.saturating_add(consumed);
                    if *pending >= DEFAULT_WINDOW_UPDATE_THRESHOLD {
                        let credit = *pending;
                        *pending = 0;
                        credit
                    } else {
                        0
                    }
                };
                if update > 0 {
                    let mut window = self.state.receive_window.lock().await;
                    *window = window.checked_add(update).ok_or(SessionError::FlowControl)?;
                    drop(window);
                    self.session
                        .inner
                        .transport
                        .send_frame(encode_window_update(self.state.id, update)?)
                        .await?;
                }
                Ok(Some(data))
            }
            Some(StreamEvent::HalfClose) => Ok(None),
            Some(StreamEvent::Reset) | None => Err(SessionError::StreamReset),
        }
    }

    pub async fn half_close(&self) -> Result<(), SessionError> {
        if self.state.ended.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        self.session
            .inner
            .transport
            .send_frame(Frame::new(FrameType::HalfClose, self.state.id))
            .await
            .map_err(Into::into)
    }

    pub async fn reset(&self) -> Result<(), SessionError> {
        self.state.ended.store(true, Ordering::Release);
        self.session.send_reset(self.state.id).await
    }
}

#[async_trait]
impl super::manager::TunnelMeshRuntime for TunnelMeshSession {
    async fn stop(self: Box<Self>) -> anyhow::Result<()> {
        self.close().await.map_err(|error| anyhow::anyhow!(error.to_string()))
    }
}
