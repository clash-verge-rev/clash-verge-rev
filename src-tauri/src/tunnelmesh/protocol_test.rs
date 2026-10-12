use super::protocol::{
    AgentMetadataPayload, CURRENT_VERSION, ClientMetadataPayload, FLAG_FIN, Frame, FrameType, MAX_PAYLOAD,
    ProtocolError, StreamOpenPayload, decode_agent_metadata_payload, decode_client_metadata_payload, decode_frame,
    decode_stream_open_payload, decode_window_update, encode_agent_metadata_payload, encode_client_metadata_payload,
    encode_frame, encode_stream_open_payload, encode_window_update,
};
use chrono::{TimeZone, Utc};

#[test]
fn fixed_header_round_trip_matches_reference_wire_order() {
    let frame = Frame::new(FrameType::Data, 42)
        .with_flags(FLAG_FIN)
        .with_window(8192)
        .with_payload(b"hello".to_vec());
    let encoded = encode_frame(&frame).expect("frame encodes");
    assert_eq!(
        encoded,
        vec![
            1, 2, 0, 1, 0, 0, 0, 42, 0, 0, 0, 5, 0, 0, 32, 0, b'h', b'e', b'l', b'l', b'o'
        ]
    );
    assert_eq!(decode_frame(&encoded).expect("frame decodes"), frame);
}

#[test]
fn decoder_rejects_unsupported_versions_and_unknown_frame_types() {
    let mut unsupported = vec![0; 16];
    unsupported[0] = CURRENT_VERSION + 1;
    unsupported[1] = FrameType::Data as u8;
    assert!(matches!(
        decode_frame(&unsupported),
        Err(ProtocolError::UnsupportedVersion(_))
    ));

    unsupported[0] = CURRENT_VERSION;
    unsupported[1] = 0xfa;
    assert!(matches!(
        decode_frame(&unsupported),
        Err(ProtocolError::UnknownFrameType(_))
    ));
}

#[test]
fn decoder_rejects_truncated_payloads_before_returning_a_frame() {
    let frame = Frame::new(FrameType::Data, 1).with_payload(b"payload".to_vec());
    let mut encoded = encode_frame(&frame).expect("frame encodes");
    encoded.pop();
    assert!(matches!(decode_frame(&encoded), Err(ProtocolError::Truncated { .. })));
}

#[test]
fn decoder_enforces_maximum_payload_before_allocation() {
    let mut encoded = vec![0; 16];
    encoded[0] = CURRENT_VERSION;
    encoded[1] = FrameType::Data as u8;
    encoded[7] = 1;
    encoded[8..12].copy_from_slice(&((MAX_PAYLOAD as u32) + 1).to_be_bytes());
    assert!(matches!(
        decode_frame(&encoded),
        Err(ProtocolError::PayloadTooLarge { .. })
    ));
}

#[test]
fn stream_id_and_window_validation_are_enforced() {
    assert!(matches!(
        encode_frame(&Frame::new(FrameType::Data, 0)),
        Err(ProtocolError::InvalidFrame(_))
    ));
    assert!(matches!(
        encode_frame(&Frame::new(FrameType::WindowUpdate, 4)),
        Err(ProtocolError::InvalidFrame(_))
    ));
    assert!(matches!(
        encode_window_update(0, 1),
        Err(ProtocolError::InvalidFrame(_))
    ));
}

#[test]
fn stream_open_payload_matches_go_reference_vector() {
    let payload = StreamOpenPayload {
        agent_id: Some("agent-a".into()),
        protocol: "udp".into(),
        target_host: "10.0.0.8".into(),
        target_port: 5353,
        target_scheme: None,
        host_header: None,
        tls_server_name: None,
        metadata: Some(b"dns".to_vec()),
    };
    let encoded = encode_stream_open_payload(&payload).expect("stream open encodes");
    assert_eq!(
        encoded,
        br#"{"agent_id":"agent-a","protocol":"udp","target_host":"10.0.0.8","target_port":5353,"metadata":"ZG5z"}"#
    );
    assert_eq!(
        decode_stream_open_payload(&encoded).expect("stream open decodes"),
        payload
    );
}

#[test]
fn metadata_payloads_round_trip_with_bounded_json() {
    let payload = AgentMetadataPayload {
        agent_id: "agent-a".into(),
        instance_id: Some("instance-a".into()),
        connection_id: Some("connection-a".into()),
        node_id: Some("node-a".into()),
        epoch: 3,
        revision: 7,
        reported_at: Utc
            .timestamp_opt(1_700_000_000, 0)
            .single()
            .expect("timestamp")
            .to_rfc3339(),
        items: vec![],
        errors: vec![],
        capabilities: vec!["stream_open_result.v1".into()],
    };
    let encoded = encode_agent_metadata_payload(&payload).expect("metadata encodes");
    assert_eq!(
        decode_agent_metadata_payload(&encoded).expect("metadata decodes"),
        payload
    );

    let client = ClientMetadataPayload::default();
    let client_encoded = encode_client_metadata_payload(&client).expect("client metadata encodes");
    assert_eq!(
        decode_client_metadata_payload(&client_encoded).expect("client metadata decodes"),
        client
    );
}

#[test]
fn window_update_is_encoded_in_the_header_window_field() {
    let frame = encode_window_update(9, 128).expect("window update encodes");
    assert_eq!(frame.frame_type, FrameType::WindowUpdate);
    assert_eq!(frame.stream_id, 9);
    assert_eq!(frame.window, 128);
    assert_eq!(decode_window_update(&frame).expect("window update decodes"), 128);
}
