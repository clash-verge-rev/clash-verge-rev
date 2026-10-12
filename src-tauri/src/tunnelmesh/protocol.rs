//! Wire-level TunnelMesh protocol models.
//!
//! The reference client uses a fixed 16-byte, network-order frame header. The
//! models here keep protocol validation independent of any transport so later
//! session code cannot bypass size or stream-ID checks.

use serde::{Deserialize, Serialize};
use std::{error::Error, fmt};

// Keep the codec functions available from the protocol namespace for callers
// that treat wire models and their serialization as one compatibility API.
pub use super::protocol_codec::{
    decode_agent_metadata_payload, decode_client_metadata_payload, decode_frame, decode_stream_open_payload,
    decode_window_update, encode_agent_metadata_payload, encode_client_metadata_payload, encode_frame,
    encode_stream_open_payload, encode_window_update,
};

pub const CURRENT_VERSION: u8 = 1;
pub const MAX_PAYLOAD: usize = 1 << 20;
pub const MAX_METADATA_PAYLOAD: usize = 32 << 10;
pub const MAX_OPEN_RESULT_PAYLOAD: usize = 1 << 10;
pub const HEADER_SIZE: usize = 16;

pub const FLAG_FIN: u16 = 1;
pub const FLAG_ACK: u16 = 1 << 1;
pub const FLAG_STRICT_OPEN: u16 = 1 << 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum FrameType {
    OpenStream = 1,
    Data = 2,
    HalfClose = 3,
    Reset = 4,
    WindowUpdate = 5,
    GoAway = 6,
    Ping = 7,
    Pong = 8,
    AgentHello = 9,
    AgentMetadataUpdate = 10,
    AgentMetadataAck = 11,
    TraceStart = 12,
    TraceHop = 13,
    TraceEnd = 14,
    OpenResult = 15,
    ClientHello = 16,
    ClientMetadataUpdate = 17,
    ClientMetadataAck = 18,
}

impl TryFrom<u8> for FrameType {
    type Error = ProtocolError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::OpenStream),
            2 => Ok(Self::Data),
            3 => Ok(Self::HalfClose),
            4 => Ok(Self::Reset),
            5 => Ok(Self::WindowUpdate),
            6 => Ok(Self::GoAway),
            7 => Ok(Self::Ping),
            8 => Ok(Self::Pong),
            9 => Ok(Self::AgentHello),
            10 => Ok(Self::AgentMetadataUpdate),
            11 => Ok(Self::AgentMetadataAck),
            12 => Ok(Self::TraceStart),
            13 => Ok(Self::TraceHop),
            14 => Ok(Self::TraceEnd),
            15 => Ok(Self::OpenResult),
            16 => Ok(Self::ClientHello),
            17 => Ok(Self::ClientMetadataUpdate),
            18 => Ok(Self::ClientMetadataAck),
            _ => Err(ProtocolError::UnknownFrameType(value)),
        }
    }
}

impl FrameType {
    /// Compatibility alias used by the reference implementation for a
    /// half-close control frame.
    #[allow(non_upper_case_globals)]
    pub const Close: Self = Self::HalfClose;

    pub const fn is_metadata(self) -> bool {
        matches!(
            self,
            Self::AgentHello
                | Self::AgentMetadataUpdate
                | Self::AgentMetadataAck
                | Self::ClientHello
                | Self::ClientMetadataUpdate
                | Self::ClientMetadataAck
        )
    }

    pub const fn is_trace(self) -> bool {
        matches!(self, Self::TraceStart | Self::TraceHop | Self::TraceEnd)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Frame {
    pub version: u8,
    pub frame_type: FrameType,
    pub flags: u16,
    pub stream_id: u32,
    pub window: u32,
    pub payload: Vec<u8>,
}

impl Frame {
    pub const fn new(frame_type: FrameType, stream_id: u32) -> Self {
        Self {
            version: CURRENT_VERSION,
            frame_type,
            flags: 0,
            stream_id,
            window: 0,
            payload: Vec::new(),
        }
    }

    #[must_use]
    pub const fn with_flags(mut self, flags: u16) -> Self {
        self.flags = flags;
        self
    }

    #[must_use]
    pub const fn with_window(mut self, window: u32) -> Self {
        self.window = window;
        self
    }

    #[must_use]
    pub fn with_payload(mut self, payload: Vec<u8>) -> Self {
        self.payload = payload;
        self
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.version != CURRENT_VERSION {
            return Err(ProtocolError::UnsupportedVersion(self.version));
        }
        if self.payload.len() > MAX_PAYLOAD {
            return Err(ProtocolError::PayloadTooLarge {
                length: self.payload.len(),
                maximum: MAX_PAYLOAD,
            });
        }
        if self.frame_type.is_metadata() && self.payload.len() > MAX_METADATA_PAYLOAD {
            return Err(ProtocolError::PayloadTooLarge {
                length: self.payload.len(),
                maximum: MAX_METADATA_PAYLOAD,
            });
        }
        if self.frame_type == FrameType::OpenResult && self.payload.len() > MAX_OPEN_RESULT_PAYLOAD {
            return Err(ProtocolError::PayloadTooLarge {
                length: self.payload.len(),
                maximum: MAX_OPEN_RESULT_PAYLOAD,
            });
        }
        if self.stream_id == 0
            && !matches!(
                self.frame_type,
                FrameType::GoAway
                    | FrameType::Ping
                    | FrameType::Pong
                    | FrameType::AgentHello
                    | FrameType::AgentMetadataUpdate
                    | FrameType::AgentMetadataAck
                    | FrameType::ClientHello
                    | FrameType::ClientMetadataUpdate
                    | FrameType::ClientMetadataAck
                    | FrameType::TraceStart
                    | FrameType::TraceHop
                    | FrameType::TraceEnd
            )
        {
            return Err(ProtocolError::InvalidFrame(
                "stream ID zero is reserved for control frames",
            ));
        }
        if self.frame_type == FrameType::WindowUpdate && self.window == 0 {
            return Err(ProtocolError::InvalidFrame("window update must carry positive credit"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    UnsupportedVersion(u8),
    UnknownFrameType(u8),
    PayloadTooLarge { length: usize, maximum: usize },
    Truncated { expected: usize, actual: usize },
    InvalidFrame(&'static str),
    InvalidPayload(String),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedVersion(version) => write!(f, "unsupported protocol version {version}"),
            Self::UnknownFrameType(frame_type) => write!(f, "unknown frame type {frame_type}"),
            Self::PayloadTooLarge { length, maximum } => {
                write!(f, "payload length {length} exceeds maximum {maximum}")
            }
            Self::Truncated { expected, actual } => {
                write!(f, "truncated frame: expected {expected} bytes, got {actual}")
            }
            Self::InvalidFrame(message) => f.write_str(message),
            Self::InvalidPayload(message) => write!(f, "invalid payload: {message}"),
        }
    }
}

impl Error for ProtocolError {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StreamOpenPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub protocol: String,
    pub target_host: String,
    pub target_port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_scheme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls_server_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", with = "base64_bytes")]
    pub metadata: Option<Vec<u8>>,
}

mod base64_bytes {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use serde::{Deserialize as _, Deserializer, Serializer};

    pub fn serialize<S>(value: &Option<Vec<u8>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(value) => serializer.serialize_some(&BASE64.encode(value)),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Vec<u8>>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Option::<String>::deserialize(deserializer)?;
        value
            .map(|value| BASE64.decode(value).map_err(serde::de::Error::custom))
            .transpose()
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct AgentMetadataPayload {
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub epoch: i64,
    pub revision: u64,
    pub reported_at: String,
    #[serde(default)]
    pub items: Vec<AgentMetadataItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<AgentMetadataError>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentMetadataItem {
    pub name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentMetadataError {
    pub name: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct ClientMetadataPayload {
    pub instance_id: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub connection_slot: i32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub version: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub commit: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub platform: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub hostname: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub process_start_at: String,
    pub reported_at: String,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub listeners: Vec<ClientListener>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<ClientMetadataItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ClientMetadataError>,
}

const fn is_zero(value: &i32) -> bool {
    *value == 0
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientListener {
    pub protocol: String,
    #[serde(rename = "listenAddress")]
    pub listen_address: String,
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientMetadataItem {
    pub name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub redacted: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientMetadataError {
    pub name: String,
    pub code: String,
    pub message: String,
}
