use crate::{utils, wrap_stream};
use reqwest::RequestBuilder;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub trait LocalSocket {
    async fn send_by_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response>;
}

impl LocalSocket for RequestBuilder {
    async fn send_by_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response> {
        let mut stream = wrap_stream::connect_to_socket(socket_path).await?;
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
