//! WebSocket transport for the TunnelMesh binary frame protocol.
//!
//! The transport deliberately owns only the WebSocket concerns.  Frame
//! validation and the stream multiplexer live in [`super::protocol`] and
//! [`super::session`], which keeps authentication and wire framing separate.

use super::protocol::{Frame, HEADER_SIZE, MAX_PAYLOAD, ProtocolError, decode_frame, encode_frame};
use async_trait::async_trait;
use futures::{SinkExt as _, StreamExt as _};
use std::fmt;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async_with_config, tungstenite};
use tungstenite::{http::header, protocol::Message, protocol::WebSocketConfig};

/// Protocol names are ordered from newest to oldest.  A server may select any
/// one of these, while a missing selection remains compatible with legacy
/// TunnelMesh servers.
pub const SUBPROTOCOL_CLIENT_METADATA: &str = "tunnelmesh.v1.open-result.flow-control.metadata";
pub const SUBPROTOCOL_FLOW_CONTROL: &str = "tunnelmesh.v1.open-result.flow-control";
pub const SUBPROTOCOL_OPEN_RESULT: &str = "tunnelmesh.v1.open-result";
pub const SUBPROTOCOL_LEGACY: &str = "tunnelmesh.v1";
pub const CLIENT_SUBPROTOCOLS: [&str; 4] = [
    SUBPROTOCOL_CLIENT_METADATA,
    SUBPROTOCOL_FLOW_CONTROL,
    SUBPROTOCOL_OPEN_RESULT,
    SUBPROTOCOL_LEGACY,
];

const DEFAULT_MAX_MESSAGE_SIZE: usize = MAX_PAYLOAD + HEADER_SIZE;

/// A transport failure with no secret-bearing context.
#[derive(Debug)]
pub enum TransportError {
    InvalidEndpoint,
    TokenRequired,
    Handshake,
    Closed,
    WebSocket(tungstenite::Error),
    Protocol(ProtocolError),
    UnexpectedMessage,
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEndpoint => f.write_str("TunnelMesh endpoint must be an absolute ws:// or wss:// URL"),
            Self::TokenRequired => f.write_str("TunnelMesh bearer token is required"),
            Self::Handshake => f.write_str("TunnelMesh WebSocket handshake failed"),
            Self::Closed => f.write_str("TunnelMesh transport is closed"),
            Self::WebSocket(error) => write!(f, "TunnelMesh WebSocket error: {error}"),
            Self::Protocol(error) => write!(f, "TunnelMesh protocol error: {error}"),
            Self::UnexpectedMessage => f.write_str("unexpected TunnelMesh WebSocket message"),
        }
    }
}

impl std::error::Error for TransportError {}

impl From<ProtocolError> for TransportError {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error)
    }
}

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct TransportInner {
    writer: Mutex<futures::stream::SplitSink<WsStream, Message>>,
    reader: Mutex<futures::stream::SplitStream<WsStream>>,
    selected_subprotocol: String,
    closed: Mutex<bool>,
}

/// A cloneable, cancellation-safe WebSocket frame transport.
#[derive(Clone)]
pub struct TunnelMeshTransport {
    inner: Arc<TransportInner>,
}

impl fmt::Debug for TunnelMeshTransport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TunnelMeshTransport")
            .field("selected_subprotocol", &self.selected_subprotocol())
            .finish_non_exhaustive()
    }
}

impl TunnelMeshTransport {
    /// Connects with `Authorization: Bearer <token>` and the stable protocol
    /// offer.  The token is used only to construct the handshake header and is
    /// never retained by the transport or included in errors.
    pub async fn connect(endpoint: &str, token: &str) -> Result<Self, TransportError> {
        Self::connect_with_max_message_size(endpoint, token, DEFAULT_MAX_MESSAGE_SIZE).await
    }

    /// Same as [`Self::connect`] with an explicit bounded WebSocket message
    /// size, useful for deployments with a smaller memory budget.
    pub async fn connect_with_max_message_size(
        endpoint: &str,
        token: &str,
        max_message_size: usize,
    ) -> Result<Self, TransportError> {
        if endpoint
            .parse::<url::Url>()
            .ok()
            .is_none_or(|url| !matches!(url.scheme(), "ws" | "wss") || url.host_str().is_none() || url.username() != "")
        {
            return Err(TransportError::InvalidEndpoint);
        }
        let token = token.trim();
        if token.is_empty() {
            return Err(TransportError::TokenRequired);
        }
        if max_message_size < HEADER_SIZE {
            return Err(TransportError::Handshake);
        }

        let parsed_endpoint = endpoint
            .parse::<url::Url>()
            .map_err(|_| TransportError::InvalidEndpoint)?;
        let host = parsed_endpoint.host_str().ok_or(TransportError::InvalidEndpoint)?;
        let host_header = parsed_endpoint
            .port()
            .map_or_else(|| host.to_owned(), |port| format!("{host}:{port}"));
        let mut request = tungstenite::http::Request::builder()
            .uri(endpoint)
            .header(header::HOST, host_header)
            .header(header::CONNECTION, "Upgrade")
            .header(header::UPGRADE, "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key())
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::SEC_WEBSOCKET_PROTOCOL, CLIENT_SUBPROTOCOLS.join(", "))
            .body(())
            .map_err(|_| TransportError::Handshake)?;
        // The origin is intentionally omitted.  TunnelMesh authenticates with
        // the bearer header and does not require browser origin semantics.
        request.headers_mut().remove(header::ORIGIN);

        let mut config = WebSocketConfig::default();
        config.max_message_size = Some(max_message_size);
        config.max_frame_size = Some(max_message_size);
        let (stream, response) = connect_async_with_config(request, Some(config), true)
            .await
            .map_err(|error| match error {
                // Keep the endpoint and bearer token out of public errors.
                tungstenite::Error::Http(_) | tungstenite::Error::Url(_) => TransportError::Handshake,
                other => TransportError::WebSocket(other),
            })?;
        let selected_subprotocol = response
            .headers()
            .get(header::SEC_WEBSOCKET_PROTOCOL)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .unwrap_or_default();
        if !selected_subprotocol.is_empty() && !CLIENT_SUBPROTOCOLS.contains(&selected_subprotocol) {
            return Err(TransportError::Handshake);
        }
        let (writer, reader) = stream.split();
        Ok(Self {
            inner: Arc::new(TransportInner {
                writer: Mutex::new(writer),
                reader: Mutex::new(reader),
                selected_subprotocol: selected_subprotocol.to_owned(),
                closed: Mutex::new(false),
            }),
        })
    }

    #[must_use]
    pub fn selected_subprotocol(&self) -> &str {
        &self.inner.selected_subprotocol
    }

    /// Sends one validated binary TunnelMesh frame.
    pub async fn send_frame(&self, frame: &Frame) -> Result<(), TransportError> {
        let encoded = encode_frame(frame)?;
        let mut writer = self.inner.writer.lock().await;
        if *self.inner.closed.lock().await {
            return Err(TransportError::Closed);
        }
        writer.send(Message::Binary(encoded.into())).await.map_err(map_ws_error)
    }

    /// Receives and decodes one binary TunnelMesh frame.  WebSocket ping
    /// frames are answered here so the session only sees protocol frames.
    pub async fn receive_frame(&self) -> Result<Frame, TransportError> {
        loop {
            let message = {
                let mut reader = self.inner.reader.lock().await;
                reader.next().await
            };
            match message {
                Some(Ok(Message::Binary(payload))) => return decode_frame(&payload).map_err(Into::into),
                Some(Ok(Message::Ping(payload))) => {
                    self.send_control(Message::Pong(payload)).await?;
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => {
                    *self.inner.closed.lock().await = true;
                    return Err(TransportError::Closed);
                }
                Some(Ok(Message::Text(_))) => return Err(TransportError::UnexpectedMessage),
                Some(Ok(Message::Frame(_))) => return Err(TransportError::UnexpectedMessage),
                Some(Err(error)) => return Err(map_ws_error(error)),
            }
        }
    }

    async fn send_control(&self, message: Message) -> Result<(), TransportError> {
        let mut writer = self.inner.writer.lock().await;
        writer.send(message).await.map_err(map_ws_error)
    }

    pub async fn close(&self) -> Result<(), TransportError> {
        {
            let mut closed = self.inner.closed.lock().await;
            if *closed {
                return Ok(());
            }
            *closed = true;
        }
        self.inner
            .writer
            .lock()
            .await
            .send(Message::Close(None))
            .await
            .map_err(map_ws_error)
    }
}

fn map_ws_error(error: tungstenite::Error) -> TransportError {
    match error {
        tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed => TransportError::Closed,
        other => TransportError::WebSocket(other),
    }
}

/// Interface consumed by the session multiplexer.  It is intentionally
/// object-safe so protocol tests can use a bounded in-memory transport.
#[async_trait]
pub trait FrameTransport: Send + Sync {
    async fn send_frame(&self, frame: Frame) -> Result<(), TransportError>;
    async fn receive_frame(&self) -> Result<Frame, TransportError>;
    async fn close(&self) -> Result<(), TransportError>;
    fn selected_subprotocol(&self) -> &str;
}

#[async_trait]
impl FrameTransport for TunnelMeshTransport {
    async fn send_frame(&self, frame: Frame) -> Result<(), TransportError> {
        self.send_frame(&frame).await
    }

    async fn receive_frame(&self) -> Result<Frame, TransportError> {
        self.receive_frame().await
    }

    async fn close(&self) -> Result<(), TransportError> {
        self.close().await
    }

    fn selected_subprotocol(&self) -> &str {
        self.selected_subprotocol()
    }
}
