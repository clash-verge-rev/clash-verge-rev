use super::protocol::{Frame, FrameType};
use super::session::{StreamRequest, TunnelMeshSession};
use super::transport::{FrameTransport, SUBPROTOCOL_LEGACY, SUBPROTOCOL_OPEN_RESULT, TransportError};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;

struct FakeTransport {
    inbound: Mutex<mpsc::Receiver<Result<Frame, TransportError>>>,
    outbound: mpsc::Sender<Frame>,
    protocol: &'static str,
}

#[async_trait]
impl FrameTransport for FakeTransport {
    async fn send_frame(&self, frame: Frame) -> Result<(), TransportError> {
        self.outbound.send(frame).await.map_err(|_| TransportError::Closed)
    }

    async fn receive_frame(&self) -> Result<Frame, TransportError> {
        self.inbound
            .lock()
            .await
            .recv()
            .await
            .unwrap_or(Err(TransportError::Closed))
    }

    async fn close(&self) -> Result<(), TransportError> {
        Ok(())
    }

    fn selected_subprotocol(&self) -> &str {
        self.protocol
    }
}

fn fake(
    protocol: &'static str,
) -> (
    Arc<FakeTransport>,
    mpsc::Sender<Result<Frame, TransportError>>,
    mpsc::Receiver<Frame>,
) {
    let (inbound_tx, inbound_rx) = mpsc::channel(16);
    let (outbound_tx, outbound_rx) = mpsc::channel(16);
    (
        Arc::new(FakeTransport {
            inbound: Mutex::new(inbound_rx),
            outbound: outbound_tx,
            protocol,
        }),
        inbound_tx,
        outbound_rx,
    )
}

#[test]
fn stream_request_keeps_http_proxy_protocol_semantics() {
    let request = StreamRequest::new("agent-a", "http", "example.com", 80);
    assert_eq!(request.protocol, "http");
    assert_eq!(request.target_host, "example.com");
    assert_eq!(request.target_port, 80);
}

#[tokio::test]
async fn receive_ping_is_answered_without_blocking_stream_dispatch() {
    let (transport, inbound, mut outbound) = fake(SUBPROTOCOL_LEGACY);
    let session = TunnelMeshSession::new(transport);
    session.start();
    inbound
        .send(Ok(Frame::new(FrameType::Ping, 0).with_payload(b"heartbeat".to_vec())))
        .await
        .expect("fake transport accepts ping");
    let pong = tokio::time::timeout(std::time::Duration::from_secs(1), outbound.recv())
        .await
        .expect("pong deadline")
        .expect("pong frame");
    assert_eq!(pong.frame_type, FrameType::Pong);
    assert_eq!(pong.payload, b"heartbeat");
    session.close().await.expect("session closes");
}

#[tokio::test]
async fn one_stream_round_trips_data_and_honors_open_window() {
    let (transport, inbound, mut outbound) = fake(SUBPROTOCOL_LEGACY);
    let session = TunnelMeshSession::new(transport);
    let cancel = CancellationToken::new();
    let stream = session
        .open_stream(StreamRequest::tcp("agent-a", "internal.example", 443), &cancel)
        .await
        .expect("stream opens");
    let open = outbound.recv().await.expect("open frame");
    assert_eq!(open.frame_type, FrameType::OpenStream);
    assert_eq!(open.stream_id, stream.id());
    assert!(open.window > 0);

    inbound
        .send(Ok(
            Frame::new(FrameType::Data, stream.id()).with_payload(b"reply".to_vec())
        ))
        .await
        .expect("fake transport accepts data");
    let reply = stream
        .receive_data(&cancel)
        .await
        .expect("data receives")
        .expect("data payload");
    assert_eq!(reply, b"reply");

    stream.send_data(b"request", &cancel).await.expect("data sends");
    let data = outbound.recv().await.expect("data frame");
    assert_eq!(data.frame_type, FrameType::Data);
    assert_eq!(data.payload, b"request");
    stream.half_close().await.expect("half close sends");
    assert_eq!(
        outbound.recv().await.expect("close frame").frame_type,
        FrameType::HalfClose
    );
    session.close().await.expect("session closes");
}

#[tokio::test]
async fn strict_open_can_be_cancelled_without_leaking_a_stream() {
    let (transport, _inbound, mut outbound) = fake(SUBPROTOCOL_OPEN_RESULT);
    let session = TunnelMeshSession::new(transport);
    let cancel = CancellationToken::new();
    let task = tokio::spawn({
        let session = session.clone();
        let cancel = cancel.clone();
        async move {
            session
                .open_stream(StreamRequest::tcp("agent-a", "internal.example", 443), &cancel)
                .await
        }
    });
    let open = outbound.recv().await.expect("strict open frame");
    assert_eq!(open.frame_type, FrameType::OpenStream);
    cancel.cancel();
    let result = tokio::time::timeout(std::time::Duration::from_secs(1), task)
        .await
        .expect("cancel deadline")
        .expect("open task joins");
    assert!(matches!(result, Err(super::session::SessionError::Cancelled)));
    session.close().await.expect("session closes");
}
