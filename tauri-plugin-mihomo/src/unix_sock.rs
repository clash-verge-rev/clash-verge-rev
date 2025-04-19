#[cfg(test)]
mod test {
    use std::error::Error;
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;

    use crate::{Connections, Rules};

    // 目前仅进行了 sock 套接字连接测试
    #[tokio::test]
    #[allow(deprecated)] // for home_dir method
    async fn test_sock_connection() -> Result<(), Box<dyn Error>> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let socket_path =
            home_dir.join(".local/share/io.github.oomeow.clash-verge-self/verge-mihomo.sock");
        if !socket_path.exists() {
            panic!("socket not exists. {}", socket_path.display());
        }

        let socket_path_ = socket_path.clone();
        tokio::spawn(async move {
            // 连接到 Unix 域套接字
            let mut stream = UnixStream::connect(socket_path_).await.unwrap();
            loop {
                // write
                stream.writable().await.unwrap();
                stream
                    .write(b"GET /rules HTTP/1.1\r\nHost: clash-verge\r\n\r\n")
                    // .write(b"GET /group HTTP/1.1\r\nHost: clash-verge\r\n\r\n")
                    .await
                    .unwrap();
                // read
                stream.readable().await.unwrap();
                let mut buf: Vec<u8> = Vec::new();
                let mut b = [0; 1024];
                loop {
                    // 循环拼接返回的数据
                    let n = stream.read(&mut b).await.unwrap();
                    buf.extend_from_slice(&b[..n]);
                    if n < 1024 {
                        break;
                    }
                }
                let response = String::from_utf8_lossy(&buf);
                // println!("[thread-1]: Received response: {:?}", response);
                let response = response.split("\r\n\r\n").nth(1).unwrap();
                let json: Rules = serde_json::from_str(response).unwrap();
                println!("[thread-1]: Received response json: {:?}", json);

                std::thread::sleep(Duration::from_millis(500));
            }
        });

        tokio::spawn(async move {
            // 连接到 Unix 域套接字
            let mut stream = UnixStream::connect(socket_path.clone()).await.unwrap();
            loop {
                stream.writable().await.unwrap();
                // 生成随机的 Sec-WebSocket-Key
                let key = "dGhlIHNhbXBsZSBub25jZQ==";
                // 构建 WebSocket 握手请求
                let request = format!("GET /connections HTTP/1.1\r\nHost: clash-verge\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n");
                println!("Sent handshake request");
                // 发送握手请求
                stream.write_all(request.as_bytes()).await.unwrap();
                break;
            }

            loop {
                stream.readable().await.unwrap();
                let mut buf = Vec::new();
                let mut b = [0; 1024];
                loop {
                    // 循环拼接返回的数据
                    let n = stream.read(&mut b).await.unwrap();
                    buf.extend_from_slice(&b[..n]);
                    if n < 1024 {
                        let receive_msg = String::from_utf8_lossy(&b);
                        if receive_msg.starts_with("HTTP/1.1 101 Switching Protocols") {
                            println!("WebSocket handshake successful");
                            //  清空缓冲区，准备接收下一次数据
                            buf.clear();
                            continue;
                        } else {
                            break;
                        }
                    }
                }
              // 解析 websocket 的数据
              let (frame, _) = ws_frame::parse_websocket_frame(&buf).unwrap();
              // println!("----> opcode: {}, fin: {}", frame.opcode, frame.fin);
              let response = String::from_utf8_lossy(&frame.payload.as_slice());
              // println!("[thread-2]: buffer length: {}, Received response: {:?}", buf.len(), response);
              let json: Connections = serde_json::from_str(&response).unwrap();
              println!("[thread-2]: Received response json: {:?}", json);
            }
        });

        tokio::time::sleep(Duration::from_secs(10)).await;

        Ok(())
    }
}
