use super::protocol::{Frame, FrameType};
use super::transport::{SUBPROTOCOL_CLIENT_METADATA, TunnelMeshTransport};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_hdr_async, tungstenite};
use tungstenite::http::header;

#[tokio::test]
async fn handshake_sends_bearer_and_negotiates_protocol() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind fake server");
    let address = listener.local_addr().expect("server address");
    let seen = Arc::new(std::sync::Mutex::new(String::new()));
    let seen_server = seen.clone();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept client");
        let socket = accept_hdr_async(
            stream,
            move |request: &tungstenite::handshake::server::Request,
                  mut response: tungstenite::handshake::server::Response|
                  -> Result<
                tungstenite::handshake::server::Response,
                tungstenite::handshake::server::ErrorResponse,
            > {
                *seen_server.lock().expect("header lock") = request
                    .headers()
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .to_owned();
                response.headers_mut().insert(
                    header::SEC_WEBSOCKET_PROTOCOL,
                    tungstenite::http::HeaderValue::from_static(SUBPROTOCOL_CLIENT_METADATA),
                );
                Ok(response)
            },
        )
        .await
        .expect("websocket handshake");
        let (mut sink, mut stream) = socket.split();
        sink.send(tungstenite::Message::Binary(
            super::protocol::encode_frame(&Frame::new(FrameType::Ping, 0).with_payload(b"ping".to_vec()))
                .expect("ping frame")
                .into(),
        ))
        .await
        .expect("server sends ping");
        while let Some(Ok(message)) = stream.next().await {
            if matches!(message, tungstenite::Message::Pong(_)) {
                break;
            }
        }
    });
    let endpoint = format!("ws://{address}");
    let transport = TunnelMeshTransport::connect(&endpoint, "secret-token")
        .await
        .expect("client handshake");
    assert_eq!(transport.selected_subprotocol(), SUBPROTOCOL_CLIENT_METADATA);
    assert_eq!(
        transport.receive_frame().await.expect("protocol ping").frame_type,
        FrameType::Ping
    );
    transport.close().await.expect("close transport");
    server.await.expect("server joins");
    assert_eq!(&*seen.lock().expect("header lock"), "Bearer secret-token");
}

#[tokio::test]
async fn missing_token_and_invalid_endpoint_are_rejected_without_connecting() {
    assert!(matches!(
        TunnelMeshTransport::connect("ws://127.0.0.1:1", " ").await,
        Err(super::transport::TransportError::TokenRequired)
    ));
    assert!(matches!(
        TunnelMeshTransport::connect("https://example.invalid/ws", "token").await,
        Err(super::transport::TransportError::InvalidEndpoint)
    ));
}
