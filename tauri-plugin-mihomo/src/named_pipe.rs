#[cfg(test)]
mod test {
    use std::error::Error;
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::ClientOptions;
    use tokio::time;
    use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;

    use crate::{ws_utils, Connections, Rules};

    // 目前仅进行了 named pipe 连接测试
    #[tokio::test]
    #[allow(deprecated)] // for home_dir method
    async fn test_pipe_connection() -> Result<(), Box<dyn Error>> {
        const PIPE_NAME: &str = r"\\.\pipe\verge-mihomo";

        tokio::spawn(async move {
            println!("start connect to pipe");
            let mut retry = 0;
            let mut client = loop {
                match ClientOptions::new().open(PIPE_NAME) {
                    Ok(client) => break client,
                    Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => (),
                    Err(_) => panic!("Failed to connect to named pipe: {PIPE_NAME}"),
                }
                if retry > 40 {
                    panic!("Failed to connect to named pipe: {PIPE_NAME}");
                }
                retry += 1;
                time::sleep(Duration::from_millis(50)).await;
            };
            println!("connect to pipe success");

            loop {
                // write
                client.writable().await.unwrap();
                client
                    .write(b"GET /rules HTTP/1.1\r\nHost: clash-verge\r\n\r\n")
                    // .write(b"GET /group HTTP/1.1\r\nHost: clash-verge\r\n\r\n")
                    .await
                    .unwrap();
                // read
                client.readable().await.unwrap();
                let mut buf: Vec<u8> = Vec::new();
                let mut b = [0; 4096];
                loop {
                    // 循环拼接返回的数据
                    let n = client.read(&mut b).await.unwrap();
                    buf.extend_from_slice(&b[..n]);
                    if n < 4096 {
                        break;
                    }
                }
                let response = String::from_utf8_lossy(&buf);
                // println!("[thread-1]: buffer length: {}, Received response: {:?}", buf.len(), response);
                let response = response.split("\r\n\r\n").nth(1).unwrap();
                let json: Rules = serde_json::from_str(response).unwrap();
                println!("[thread-1]: Received response json: {:?}", json);

                std::thread::sleep(Duration::from_millis(500));
            }
        });

        tokio::spawn(async move {
            let mut client = loop {
                match ClientOptions::new().open(PIPE_NAME) {
                    Ok(client) => break client,
                    Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => (),
                    Err(_) => panic!("Failed to connect to named pipe: {PIPE_NAME}"),
                }

                time::sleep(Duration::from_millis(50)).await;
            };
            loop {
                client.writable().await.unwrap();
                // 生成随机的 Sec-WebSocket-Key
                let key = ws_utils::generate_websocket_key();
                // 构建 WebSocket 握手请求
                let request = format!("GET /connections HTTP/1.1\r\nHost: clash-verge\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n");
                println!("Sent handshake request");
                // 发送握手请求
                client.write(request.as_bytes()).await.unwrap();
                break;
            }

            loop {
                client.readable().await.unwrap();
                let mut buf = Vec::new();
                let mut b = [0; 4096];
                loop {
                    // 循环拼接返回的数据
                    let n = client.read(&mut b).await.unwrap();
                    buf.extend_from_slice(&b[..n]);

                    if n < 4096 {
                        // 判断是否为 websocket 帧
                        if n == 4 {
                            match ws_utils::parse_websocket_frame(&buf) {
                                Ok(_) => {
                                    break;
                                }
                                Err(e) => {
                                    if e.kind() == std::io::ErrorKind::UnexpectedEof {
                                        println!("require more payload data");
                                        continue;
                                    } else {
                                        break;
                                    }
                                }
                            }
                        } else {
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
                }
                // 解析 websocket 的数据
                let frame = ws_utils::parse_websocket_frame(&buf).unwrap();
                // println!("----> opcode: {}, fin: {}", frame.opcode, frame.fin);
                let response = String::from_utf8_lossy(&frame.payload.as_slice());
                // println!("[thread-2]: buffer length: {}, Received response: {:?}", buf.len(), response);
                let json: Connections = serde_json::from_str(&response).unwrap();
                println!("[thread-2]: Received response json: {:?}", json);
            }
        });

        tokio::time::sleep(Duration::from_secs(5)).await;

        Ok(())
    }
}
