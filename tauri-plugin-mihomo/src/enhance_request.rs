use reqwest::RequestBuilder;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::utils;

pub trait LocalSocket {
    async fn send_to_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response>;
}

impl LocalSocket for RequestBuilder {
    async fn send_to_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response> {
        let mut stream = {
            #[cfg(unix)]
            {
                use std::path::Path;
                use tokio::net::UnixStream;
                if !Path::new(socket_path).exists() {
                    use crate::MihomoError;

                    log::error!("socket path is not exists: {socket_path}");
                    return Err(MihomoError::Io(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        format!("socket path: {socket_path} not found"),
                    )));
                }
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
                            log::error!("failed to connect to named pipe: {socket_path}, {e}");
                            return Err(MihomoError::FailedResponse(format!(
                                "Failed to connect to named pipe: {socket_path}, {e}"
                            )));
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        };
        log::debug!("building socket request");
        let req_str = utils::build_socket_request(self)?;
        log::debug!("request string: {req_str:?}");
        stream.writable().await?;
        log::debug!("send request");
        stream.write_all(req_str.as_bytes()).await?;
        log::debug!("wait for response");
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
            if (!is_chunked && n < 4096 && buf.ends_with(b"\n")) || (is_chunked && buf.ends_with(b"\r\n\r\n")) {
                break;
            }
        }
        log::debug!("receive response success, shut down stream");
        stream.shutdown().await?;
        let response = String::from_utf8_lossy(&buf);
        utils::parse_socket_response(&response, is_chunked)
    }
}
