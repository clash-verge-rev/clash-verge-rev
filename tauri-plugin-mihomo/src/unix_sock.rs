use std::collections::HashMap;
use std::error::Error;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

use crate::Connections;

// 目前仅进行了 sock 套接字连接测试
#[tokio::main]
#[allow(deprecated)] // for home_dir method
async fn main() -> Result<(), Box<dyn Error>> {
    let home_dir = std::env::home_dir().expect("failed to get home dir");
    let socket_path =
        home_dir.join(".local/share/io.github.oomeow.clash-verge-self/verge-mihomo.sock");
    if !socket_path.exists() {
        panic!("socket not exists.");
    }

    // 连接到 Unix 域套接字
    let mut stream = UnixStream::connect(socket_path.clone()).await?;

    let mut count = 0;
    while count < 2 {
        // write
        stream.writable().await?;
        stream
            // .write(b"GET /connections HTTP/1.1\r\nHost: clash-verge\r\n\r\n")
            .write(b"GET /group/AI/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=1000 HTTP/1.1\r\nHost: clash-verge\r\n\r\n")
            .await?;
        // read
        stream.readable().await?;
        let mut buf: Vec<u8> = Vec::new();
        let mut b = [0; 1024];
        loop {
            // 循环拼接返回的数据
            let n = stream.read(&mut b).await?;
            buf.extend_from_slice(&b[..n]);
            if n < 1024 {
                break;
            }
        }
        let response = String::from_utf8_lossy(&buf);
        let response = response.split("\r\n\r\n").nth(1).unwrap();
        let json: HashMap<String, u32> = serde_json::from_str(response)?;
        println!("Received response json: {:?}", json);

        count += 1;
        std::thread::sleep(Duration::from_secs(1));
    }

    // websocket
    loop {
        stream.writable().await?;
        // 生成随机的 Sec-WebSocket-Key
        let key = "dGhlIHNhbXBsZSBub25jZQ==";
        // 构建 WebSocket 握手请求
        let request = format!("GET /connections HTTP/1.1\r\nHost: clash-verge\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n");
        println!("Sent handshake request");
        // 发送握手请求
        stream.write_all(request.as_bytes()).await?;
        break;
    }

    count = 0;
    while count < 2 {
        stream.readable().await?;
        let mut buf = Vec::new();
        let mut b = [0; 1024];
        loop {
            // 循环拼接返回的数据
            let n = stream.read(&mut b).await?;
            buf.extend_from_slice(&b[..n]);
            if n < 1024 {
                let receive_msg = String::from_utf8_lossy(&b);
                if receive_msg.starts_with("HTTP/1.1 101 Switching Protocols") {
                    println!("WebSocket handshake successful");
                    continue;
                } else {
                    break;
                }
            }
        }
        let response = String::from_utf8_lossy(&buf);
        println!("Received response json: {:?}", response);
        let response = response.find("{").map(|start| &response[start..]).unwrap();
        let json: Connections = serde_json::from_str(response)?;
        println!("Received response json: {:?}", json);

        count += 1;
    }

    Ok(())
}
