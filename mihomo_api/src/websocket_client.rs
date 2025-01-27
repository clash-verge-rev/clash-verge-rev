use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::Result;
use futures_util::{
    stream::{SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use tokio::{net::TcpStream, sync::Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type WriteStream = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;
type ReadStream = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

#[derive(Clone)]
pub struct MihomoWebsocketClient {
    write: Arc<Mutex<WriteStream>>,
    read: Arc<Mutex<ReadStream>>,
    should_disconnect: Arc<AtomicBool>,
}

impl MihomoWebsocketClient {
    pub async fn connect(url: &str) -> Result<MihomoWebsocketClient> {
        let (ws_stream, _) = connect_async(url).await?;
        let (write, read) = ws_stream.split();
        Ok(Self {
            write: Arc::new(Mutex::new(write)),
            read: Arc::new(Mutex::new(read)),
            should_disconnect: Arc::new(AtomicBool::new(false)),
        })
    }

    pub async fn listent<F: FnMut(Message)>(&self, mut on_message: F) {
        let mut read = self.read.lock().await;
        while !self.should_disconnect.load(Ordering::Relaxed) {
            tokio::select! {
                Some(message) = read.next() => {
                    match message {
                       Ok(Message::Close(_)) => {
                           println!("Received close frame from server.");
                           self.should_disconnect.store(true, Ordering::Relaxed);
                           break;
                       },
                       Ok(msg) => {
                           on_message(msg);
                       }
                       Err(e) => {
                           eprintln!("Websocket error: {}", e);
                       }
                    }
                },
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {
                    if self.should_disconnect.load(Ordering::Relaxed) {
                        println!("Disconnect websocket...");
                        break;
                    }
                }
            }
        }
    }

    pub async fn send<M: Into<String>>(&self, message: M) -> Result<()> {
        let mut write = self.write.lock().await;
        write.send(Message::Text(message.into())).await?;
        Ok(())
    }

    pub async fn disconnect(&self) -> Result<()> {
        let mut write = self.write.lock().await;

        // 尝试发送关闭帧，设置超时时间
        tokio::select! {
            result = write.send(Message::Close(None)) => {
                result?;
                println!("Close frame sent to server.");
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(5)) => {
                println!("Timeout while sending close frame.");
                self.should_disconnect.store(true, Ordering::Relaxed);
            }
        }

        for i in 1..=5 {
            let should_disconnect = self.should_disconnect.load(Ordering::Relaxed);
            if should_disconnect {
                break;
            }
            if i == 5 {
                println!("force close.");
                self.should_disconnect.store(true, Ordering::Relaxed);
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }

        Ok(())
    }
}
