//! Bounded frame and payload codecs for the TunnelMesh wire protocol.

use super::protocol::{
    AgentMetadataPayload, CURRENT_VERSION, ClientMetadataPayload, Frame, FrameType, HEADER_SIZE, MAX_METADATA_PAYLOAD,
    MAX_OPEN_RESULT_PAYLOAD, MAX_PAYLOAD, ProtocolError, StreamOpenPayload,
};
use serde::{Serialize, de::DeserializeOwned};

pub fn encode_frame(frame: &Frame) -> Result<Vec<u8>, ProtocolError> {
    frame.validate()?;
    let payload_len = u32::try_from(frame.payload.len()).map_err(|_| ProtocolError::PayloadTooLarge {
        length: frame.payload.len(),
        maximum: MAX_PAYLOAD,
    })?;
    let mut encoded = Vec::with_capacity(HEADER_SIZE + frame.payload.len());
    encoded.push(frame.version);
    encoded.push(frame.frame_type as u8);
    encoded.extend_from_slice(&frame.flags.to_be_bytes());
    encoded.extend_from_slice(&frame.stream_id.to_be_bytes());
    encoded.extend_from_slice(&payload_len.to_be_bytes());
    encoded.extend_from_slice(&frame.window.to_be_bytes());
    encoded.extend_from_slice(&frame.payload);
    Ok(encoded)
}

pub fn decode_frame(encoded: &[u8]) -> Result<Frame, ProtocolError> {
    if encoded.len() < HEADER_SIZE {
        return Err(ProtocolError::Truncated {
            expected: HEADER_SIZE,
            actual: encoded.len(),
        });
    }
    let version = encoded[0];
    if version != CURRENT_VERSION {
        return Err(ProtocolError::UnsupportedVersion(version));
    }
    let frame_type = FrameType::try_from(encoded[1])?;
    let flags = u16::from_be_bytes([encoded[2], encoded[3]]);
    let stream_id = u32::from_be_bytes([encoded[4], encoded[5], encoded[6], encoded[7]]);
    let payload_len = u32::from_be_bytes([encoded[8], encoded[9], encoded[10], encoded[11]]) as usize;
    let window = u32::from_be_bytes([encoded[12], encoded[13], encoded[14], encoded[15]]);
    let maximum = if frame_type.is_metadata() {
        MAX_METADATA_PAYLOAD
    } else if frame_type == FrameType::OpenResult {
        MAX_OPEN_RESULT_PAYLOAD
    } else {
        MAX_PAYLOAD
    };
    // Check the peer-controlled length before allocating a payload buffer.
    if payload_len > maximum {
        return Err(ProtocolError::PayloadTooLarge {
            length: payload_len,
            maximum,
        });
    }
    let expected = HEADER_SIZE + payload_len;
    if encoded.len() < expected {
        return Err(ProtocolError::Truncated {
            expected,
            actual: encoded.len(),
        });
    }
    if encoded.len() != expected {
        return Err(ProtocolError::InvalidFrame("trailing bytes after frame"));
    }
    let frame = Frame {
        version,
        frame_type,
        flags,
        stream_id,
        window,
        payload: encoded[HEADER_SIZE..expected].to_vec(),
    };
    frame.validate()?;
    Ok(frame)
}

pub fn encode_window_update(stream_id: u32, window: u32) -> Result<Frame, ProtocolError> {
    let frame = Frame::new(FrameType::WindowUpdate, stream_id).with_window(window);
    frame.validate()?;
    Ok(frame)
}

pub fn decode_window_update(frame: &Frame) -> Result<u32, ProtocolError> {
    if frame.frame_type != FrameType::WindowUpdate {
        return Err(ProtocolError::InvalidFrame("expected a WINDOW_UPDATE frame"));
    }
    if !frame.payload.is_empty() {
        return Err(ProtocolError::InvalidFrame("window update must not carry a payload"));
    }
    frame.validate()?;
    Ok(frame.window)
}

pub fn encode_stream_open_payload(payload: &StreamOpenPayload) -> Result<Vec<u8>, ProtocolError> {
    encode_json(payload, MAX_PAYLOAD)
}

pub fn decode_stream_open_payload(encoded: &[u8]) -> Result<StreamOpenPayload, ProtocolError> {
    decode_json(encoded, MAX_PAYLOAD)
}

pub fn encode_agent_metadata_payload(payload: &AgentMetadataPayload) -> Result<Vec<u8>, ProtocolError> {
    encode_json(payload, MAX_METADATA_PAYLOAD)
}

pub fn decode_agent_metadata_payload(encoded: &[u8]) -> Result<AgentMetadataPayload, ProtocolError> {
    decode_json(encoded, MAX_METADATA_PAYLOAD)
}

pub fn encode_client_metadata_payload(payload: &ClientMetadataPayload) -> Result<Vec<u8>, ProtocolError> {
    encode_json(payload, MAX_METADATA_PAYLOAD)
}

pub fn decode_client_metadata_payload(encoded: &[u8]) -> Result<ClientMetadataPayload, ProtocolError> {
    decode_json(encoded, MAX_METADATA_PAYLOAD)
}

fn encode_json<T: Serialize>(value: &T, maximum: usize) -> Result<Vec<u8>, ProtocolError> {
    let encoded = serde_json::to_vec(value).map_err(|error| ProtocolError::InvalidPayload(error.to_string()))?;
    if encoded.len() > maximum {
        return Err(ProtocolError::PayloadTooLarge {
            length: encoded.len(),
            maximum,
        });
    }
    Ok(encoded)
}

fn decode_json<T: DeserializeOwned>(encoded: &[u8], maximum: usize) -> Result<T, ProtocolError> {
    if encoded.len() > maximum {
        return Err(ProtocolError::PayloadTooLarge {
            length: encoded.len(),
            maximum,
        });
    }
    serde_json::from_slice(encoded).map_err(|error| ProtocolError::InvalidPayload(error.to_string()))
}
