use reqwest::RequestBuilder;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::utils::{build_socket_request, parse_socket_response};

pub trait LocalSocket {
    async fn send_to_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response>;
}

impl LocalSocket for RequestBuilder {
    async fn send_to_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response> {
        let mut stream = {
            #[cfg(unix)]
            {
                use tokio::net::UnixStream;
                UnixStream::connect(socket_path).await?
            }
            #[cfg(windows)]
            {
                use crate::MihomoError;
                use std::time::Duration;
                use tokio::net::windows::named_pipe::ClientOptions;
                use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;
                loop {
                    match ClientOptions::new().open(socket_path) {
                        Ok(client) => break client,
                        Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => (),
                        Err(e) => {
                            return Err(MihomoError::FailedResponse(format!(
                                "Failed to connect to named pipe: {socket_path}, {e}"
                            )))
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        };
        let req_str = build_socket_request(self)?;
        // println!("generate request string: {:?} \n", req_str);
        stream.writable().await?;
        stream.write_all(req_str.as_bytes()).await?;
        stream.readable().await?;
        let mut buf: Vec<u8> = Vec::new();
        let mut b = [0; 4096];
        let mut header_judged = false;
        let mut is_chunked = false;
        loop {
            let n = stream.read(&mut b).await?;
            if n == 0 {
                // for named pipe
                break;
            }
            buf.extend_from_slice(&b[..n]);
            if !header_judged {
                let content = String::from_utf8_lossy(&buf);
                if content.contains("Transfer-Encoding: chunked") {
                    is_chunked = true;
                }
                header_judged = true;
            }
            // if response is chunked, wait to \r\n\r\n
            if (!is_chunked && n < 4096 && buf.ends_with(b"\n"))
                || (is_chunked && buf.ends_with(b"\r\n\r\n"))
            {
                break;
            }
        }
        let response = String::from_utf8_lossy(&buf);
        parse_socket_response(&response, is_chunked)
    }
}
