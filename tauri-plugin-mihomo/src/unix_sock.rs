#[cfg(test)]
mod test {
    use std::error::Error;
    use std::time::Duration;

    use futures_util::StreamExt;
    use http::Request;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;
    use tokio_tungstenite::client_async;
    use tokio_tungstenite::tungstenite::Message;

    use crate::ws_utils::{build_socket_request, parse_socket_response};
    use crate::{ws_utils, Log};

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
            let body = json!({
                "name": "US AUTO"
            });
            let req = reqwest::ClientBuilder::new()
                .build()
                .unwrap()
                // .get("http://127.0.0.1:9090/rules")
                .get("http://127.0.0.1:9090/proxies/PROXY/delay")
                .query(&[("url", "http://1.1.1.1"), ("timeout", "5000")])
                // .put("http://127.0.0.1:9090/proxies/PROXY")
                // .json(&body)
                ;
            let req_str = build_socket_request(req).unwrap();
            println!("build request: {:?}", req_str);
            loop {
                // write
                stream.writable().await.unwrap();
                stream.write(req_str.as_bytes()).await.unwrap();
                // read
                stream.readable().await.unwrap();
                let mut buf: Vec<u8> = Vec::new();
                let mut b = [0; 4096];
                loop {
                    // 循环拼接返回的数据
                    let n = stream.read(&mut b).await.unwrap();
                    buf.extend_from_slice(&b[..n]);
                    if n < 4096 {
                        break;
                    }
                }
                let response = String::from_utf8_lossy(&buf);
                // println!("[thread-1]: Received response: {:?}", response);
                let res = parse_socket_response(&response).unwrap();
                match res.text().await {
                    Ok(r) => {
                        println!("[thread-1]: {:?}", r);
                    }
                    Err(e) => {
                        println!("failed to parse to Rules, {:?}", e);
                    }
                }

                std::thread::sleep(Duration::from_millis(500));
            }
        });

        // tokio::spawn(async move {
        //     // 连接到 Unix 域套接字
        //     let mut stream = UnixStream::connect(socket_path.clone()).await.unwrap();
        //     loop {
        //         stream.writable().await.unwrap();
        //         // 生成随机的 Sec-WebSocket-Key
        //         let key = ws_utils::generate_websocket_key();
        //         // 构建 WebSocket 握手请求
        //         let request = format!("GET /logs?level=debug HTTP/1.1\r\nHost: clash-verge\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n");
        //         println!("Sent handshake request");
        //         // 发送握手请求
        //         stream.write_all(request.as_bytes()).await.unwrap();
        //         break;
        //     }

        //     loop {
        //         stream.readable().await.unwrap();
        //         let mut buf = Vec::new();
        //         let mut b = [0; 4096];
        //         loop {
        //             // 循环拼接返回的数据
        //             let n = stream.read(&mut b).await.unwrap();
        //             buf.extend_from_slice(&b[..n]);
        //             if n < 4096 {
        //                 let receive_msg = String::from_utf8_lossy(&b);
        //                 if receive_msg.starts_with("HTTP/1.1 101 Switching Protocols") {
        //                     println!("WebSocket handshake successful");
        //                     //  清空缓冲区，准备接收下一次数据
        //                     buf.clear();
        //                     continue;
        //                 } else {
        //                     break;
        //                 }
        //             }
        //         }
        //         // 解析 websocket 的数据
        //         println!("----------------------------------");
        //         println!("{}", String::from_utf8_lossy(&buf));
        //         // 存在一次性读取到多条 websocket 数据的情况，需要循环逐条解析数据
        //         let (frame, remaining) = ws_utils::parse_websocket_frame(&buf).unwrap();
        //         println!("Remaining data : {}", String::from_utf8_lossy(&remaining));
        //         // println!("----> opcode: {}, fin: {}", frame.opcode, frame.fin);
        //         let response = String::from_utf8_lossy(&frame.payload.as_slice());
        //         // println!("[thread-2]: buffer length: {}, Received response: {:?}", buf.len(), response);
        //         let json: Log = serde_json::from_str(&response).unwrap();
        //         println!("[thread-2]: Received response json: {:?}", json);
        //         println!("----------------------------------");
        //     }
        // });

        // tokio::time::sleep(Duration::from_secs(5)).await;

        tokio::spawn(async move {
            // 连接到 Unix 套接字
            let stream = UnixStream::connect(socket_path.clone()).await.unwrap();
            println!("已连接到 {}", socket_path.display());

            // 构造 WebSocket 握手请求
            let request = Request::builder()
                .uri("ws://localhost/logs") // 路径需与服务器端路由匹配
                .header("Host", "clash-verge")
                .header("Sec-WebSocket-Key", ws_utils::generate_websocket_key())
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .body(())
                .unwrap();

            // 发起 WebSocket 握手
            let (mut ws_stream, _) = client_async(request, stream).await.unwrap();
            println!("WebSocket 连接已建立");

            // 接收响应
            loop {
                if let Some(Ok(msg)) = ws_stream.next().await {
                    match msg {
                        Message::Text(message) => {
                            let json: Log = serde_json::from_str(&message).unwrap();
                            println!("[thread-2]: {:?}", json);
                        }
                        _ => {
                            println!("not text data");
                        }
                    }
                }
            }
        });

        tokio::time::sleep(Duration::from_secs(10)).await;

        Ok(())
    }
}
