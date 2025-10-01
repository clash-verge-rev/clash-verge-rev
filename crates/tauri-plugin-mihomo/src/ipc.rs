use std::{
    pin::Pin,
    task::{Context, Poll},
};

use http::{
    Version,
    header::{CONTENT_LENGTH, CONTENT_TYPE},
};
use httparse::EMPTY_HEADER;
use pin_project::pin_project;
use reqwest::RequestBuilder;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(windows)]
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
#[cfg(windows)]
use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;

use crate::{Error, Result};

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

pub async fn connect_to_socket(socket_path: &str) -> Result<WrapStream> {
    #[cfg(unix)]
    {
        if !std::path::Path::new(socket_path).exists() {
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
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        };
        Ok(WrapStream::NamedPipe(client))
    }
}

fn generate_socket_request(req: reqwest::Request) -> Result<String> {
    let method = req.method().as_str();
    let mut path = req.url().path().to_string();
    if let Some(query) = req.url().query() {
        path.push_str(&format!("?{query}"));
    }
    let request_line = format!("{method} {path} HTTP/1.1\r\n");

    // 添加头部信息
    let mut headers = String::new();
    let missing_content_length =
        req.headers().contains_key(CONTENT_TYPE) && !req.headers().contains_key(CONTENT_LENGTH);
    let body = req
        .body()
        .and_then(|b| b.as_bytes())
        .map(|b| String::from_utf8_lossy(b).to_string())
        .unwrap_or_default();
    for (name, value) in req.headers() {
        if let Ok(value) = value.to_str() {
            headers.push_str(&format!("{name}: {value}\r\n"));
            if name == CONTENT_TYPE && missing_content_length {
                headers.push_str(&format!("{}: {}\r\n", CONTENT_LENGTH, body.len()));
            }
        }
    }

    // 拼接完整请求, 格式: 请求行 + 头部 + 空行 + Body
    let raw = format!("{request_line}{headers}\r\n{body}");

    Ok(raw)
}

fn generate_socket_response(header: String, body: String) -> Result<reqwest::Response> {
    log::debug!("parsing socket response");
    let mut headers = [EMPTY_HEADER; 16];
    let mut res = httparse::Response::new(&mut headers);
    let response_str = format!("{header}{body}");
    // println!("response str: {response_str:?}");
    let raw_response = response_str.as_bytes();
    match res.parse(raw_response) {
        Ok(httparse::Status::Complete(_)) => {
            let mut res_builder = http::Response::builder()
                .version(Version::HTTP_11)
                .status(res.code.unwrap_or(400));
            for header in res.headers.iter() {
                let header_name = header.name;
                let header_value = str::from_utf8(header.value).unwrap_or_default();
                res_builder = res_builder.header(header_name, header_value);
            }
            // {
            //     use std::io::Write;
            //     let mut file = std::fs::File::create("body.json")?;
            //     file.write_all(body.as_bytes())?;
            // }
            let response = res_builder.body(body.to_string())?;
            Ok(reqwest::Response::from(response))
        }
        Ok(httparse::Status::Partial) => {
            log::error!("Partial response, need more data");
            Err(Error::HttpParseError("Partial response, need more data".to_string()))
        }
        Err(e) => {
            log::error!("Failed to parse response: {e}");
            Err(Error::HttpParseError(format!("Failed to parse response: {e}")))
        }
    }
}

async fn read_header(reader: &mut BufReader<WrapStream>) -> Result<String> {
    let mut header = String::new();
    loop {
        let mut line = String::new();
        if let Ok(size) = reader.read_line(&mut line).await
            && size == 0
        {
            return Err(Error::HttpParseError("no response".to_string()));
        }
        header.push_str(&line);
        if line == "\r\n" {
            break;
        }
    }
    log::debug!("read header done: {header:?}");

    Ok(header)
}

async fn read_chunked_data(reader: &mut BufReader<WrapStream>) -> Result<String> {
    let mut body = Vec::new();
    loop {
        // 读 chunk size
        let mut size_line = String::new();
        reader.read_line(&mut size_line).await?;
        let size_line = size_line.trim();
        if size_line.is_empty() {
            continue;
        }
        let chunk_size = usize::from_str_radix(size_line, 16)
            .map_err(|e| Error::HttpParseError(format!("Failed to parse chunk size: {e}")))?;

        if chunk_size == 0 {
            // 读掉最后的 CRLF
            let mut end = String::new();
            reader.read_line(&mut end).await?;
            break;
        }

        // 读 chunk data
        let mut chunk_data = vec![0u8; chunk_size];
        reader.read_exact(&mut chunk_data).await?;
        body.extend_from_slice(&chunk_data);

        // 读掉结尾 CRLF
        let mut crlf = String::new();
        reader.read_line(&mut crlf).await?;
    }
    log::debug!("read chunked data done");
    Ok(String::from_utf8(body)?)
}

pub trait LocalSocket {
    async fn send_by_local_socket(self, socket_path: &str) -> Result<reqwest::Response>;
}

impl LocalSocket for RequestBuilder {
    async fn send_by_local_socket(self, socket_path: &str) -> Result<reqwest::Response> {
        let request = self.build()?;
        let timeout = request.timeout().cloned();

        let process = async move {
            let mut stream = connect_to_socket(socket_path).await?;
            log::debug!("building socket request");
            let req_str = generate_socket_request(request)?;
            log::debug!("request string: {req_str:?}");
            stream.writable().await?;
            log::debug!("send request");
            stream.write_all(req_str.as_bytes()).await?;
            log::debug!("wait for response");
            stream.readable().await?;

            let mut reader = BufReader::new(stream);

            // 读取解析 header
            let header = read_header(&mut reader).await?;
            // 解析 Content-Length, 判断是否是 chunked 响应
            let mut content_length: Option<usize> = None;
            let mut is_chunked = false;
            for line in header.lines() {
                if let Some(v) = line.to_lowercase().strip_prefix("content-length: ") {
                    content_length = Some(v.trim().parse()?);
                }
                if line.to_lowercase().contains("transfer-encoding: chunked") {
                    is_chunked = true;
                }
            }

            // 读取 body
            let body = if is_chunked {
                read_chunked_data(&mut reader).await?
            } else if let Some(content_length) = content_length {
                log::debug!("content length: {content_length}");
                let mut body_buf = vec![0u8; content_length];
                reader.read_exact(&mut body_buf).await?;
                String::from_utf8_lossy(&body_buf).to_string()
            } else {
                // 使用空的 body
                String::new()
            };
            log::debug!("receive response success, shut down stream");
            reader.shutdown().await?;
            generate_socket_response(header, body)
        };

        match timeout {
            Some(duration) => {
                log::debug!("Timeout duration: {:?}", duration);
                tokio::time::timeout(duration, process).await?
            }
            None => {
                log::debug!("No timeout specified");
                process.await
            }
        }
    }
}
