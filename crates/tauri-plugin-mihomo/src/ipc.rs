use std::{
    pin::Pin,
    task::{Context, Poll},
};

use pin_project::pin_project;
use reqwest::RequestBuilder;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(windows)]
use tokio::net::windows::named_pipe::NamedPipeClient;

use crate::utils;

#[pin_project(project = WrapStreamProj)]
pub enum WrapStream {
    #[cfg(unix)]
    Unix(#[pin] UnixStream),
    #[cfg(windows)]
    NamedPipe(#[pin] NamedPipeClient),
}

impl WrapStream {
    pub async fn readable(&self) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            WrapStream::Unix(s) => s.readable().await,
            #[cfg(windows)]
            WrapStream::NamedPipe(s) => s.readable().await,
        }
    }
    pub async fn writable(&self) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            WrapStream::Unix(s) => s.writable().await,
            #[cfg(windows)]
            WrapStream::NamedPipe(s) => s.writable().await,
        }
    }
}

impl AsyncRead for WrapStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.project() {
            #[cfg(unix)]
            WrapStreamProj::Unix(s) => s.poll_read(cx, buf),
            #[cfg(windows)]
            WrapStreamProj::NamedPipe(s) => s.poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for WrapStream {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<std::io::Result<usize>> {
        match self.project() {
            #[cfg(unix)]
            WrapStreamProj::Unix(s) => s.poll_write(cx, buf),
            #[cfg(windows)]
            WrapStreamProj::NamedPipe(s) => s.poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.project() {
            #[cfg(unix)]
            WrapStreamProj::Unix(s) => s.poll_flush(cx),
            #[cfg(windows)]
            WrapStreamProj::NamedPipe(s) => s.poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.project() {
            #[cfg(unix)]
            WrapStreamProj::Unix(s) => s.poll_shutdown(cx),
            #[cfg(windows)]
            WrapStreamProj::NamedPipe(s) => s.poll_shutdown(cx),
        }
    }
}

pub async fn connect_to_socket(socket_path: &str) -> crate::Result<WrapStream> {
    #[cfg(unix)]
    {
        use std::path::Path;

        use tokio::net::UnixStream;

        use crate::Error;

        if !Path::new(socket_path).exists() {
            log::error!("socket path is not exists: {socket_path}");
            return Err(Error::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("socket path: {socket_path} not found"),
            )));
        }
        Ok(WrapStream::Unix(UnixStream::connect(socket_path).await?))
    }

    #[cfg(windows)]
    {
        use std::time::Duration;

        use tokio::net::windows::named_pipe::ClientOptions;
        use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;

        use crate::Error;

        let client = loop {
            match ClientOptions::new().open(socket_path) {
                Ok(client) => break client,
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => (),
                Err(e) => {
                    log::error!("failed to connect to named pipe: {socket_path}, {e}");
                    return Err(Error::FailedResponse(format!(
                        "Failed to connect to named pipe: {socket_path}, {e}"
                    )));
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        Ok(WrapStream::NamedPipe(client))
    }
}

pub trait LocalSocket {
    async fn send_by_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response>;
}

impl LocalSocket for RequestBuilder {
    async fn send_by_local_socket(self, socket_path: &str) -> crate::Result<reqwest::Response> {
        let mut stream = connect_to_socket(socket_path).await?;
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
