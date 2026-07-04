use crate::{
    cmd::{CmdResult, StringifyErr as _},
    config::{Config, IClashTemp},
};
use clash_verge_logging::{Type, logging};
use smartstring::alias::String;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWriteExt as _};

#[cfg(unix)]
use tokio::net::UnixStream;

#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const UPGRADE_LGBM_PATH: &str = "/upgrade/lgbm";
const FLUSH_SMART_CACHE_PATH: &str = "/cache/smart/flush";

pub async fn upgrade_lgbm() -> CmdResult {
    post(UPGRADE_LGBM_PATH).await
}

pub async fn flush_smart_cache() -> CmdResult {
    post(FLUSH_SMART_CACHE_PATH).await
}

async fn post(path: &str) -> CmdResult {
    match post_by_ipc(path).await {
        Ok(()) => Ok(()),
        Err(ipc_err) => {
            logging!(
                warn,
                Type::Config,
                "Mihomo API IPC request failed, fallback to HTTP: {ipc_err}"
            );
            post_by_http(path).await
        }
    }
}

fn parse_http_response(response: &[u8]) -> CmdResult {
    let response_text = std::str::from_utf8(response).stringify_err()?;
    let (head, body) = response_text
        .split_once("\r\n\r\n")
        .ok_or_else(|| String::from("invalid Mihomo API response"))?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| String::from("invalid Mihomo API response status"))?;

    if !(200..300).contains(&status) {
        let message = if body.trim().is_empty() {
            format!("Mihomo API request failed: {status}")
        } else {
            body.to_owned()
        };
        return Err(message.into());
    }

    Ok(())
}

fn find_http_header_end(response: &[u8]) -> Option<usize> {
    response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn parse_content_length(headers: &[u8]) -> Option<usize> {
    let headers = std::str::from_utf8(headers).ok()?;

    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse().ok()
        } else {
            None
        }
    })
}

async fn read_http_response<R>(stream: &mut R) -> CmdResult<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut response = Vec::new();
    let mut chunk = [0_u8; 4096];

    loop {
        let read = tokio::time::timeout(REQUEST_TIMEOUT, stream.read(&mut chunk))
            .await
            .stringify_err()?
            .stringify_err()?;
        if read == 0 {
            break;
        }

        response.extend_from_slice(&chunk[..read]);
        if let Some(header_end) = find_http_header_end(&response)
            && let Some(content_length) = parse_content_length(&response[..header_end])
            && response.len() >= header_end + content_length
        {
            break;
        }
    }

    Ok(response)
}

async fn post_by_ipc(path: &str) -> CmdResult {
    let clash_info = Config::clash().await.data_arc().get_client_info();
    let auth_header = clash_info
        .secret
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|secret| format!("Authorization: Bearer {secret}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: localhost\r\n{auth_header}Content-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let socket_path = IClashTemp::guard_external_controller_ipc();

    #[cfg(windows)]
    let response = {
        let mut stream = ClientOptions::new().open(socket_path.as_str()).stringify_err()?;
        stream.write_all(request.as_bytes()).await.stringify_err()?;
        read_http_response(&mut stream).await?
    };

    #[cfg(unix)]
    let response = {
        let mut stream = UnixStream::connect(socket_path.as_str()).await.stringify_err()?;
        stream.write_all(request.as_bytes()).await.stringify_err()?;
        read_http_response(&mut stream).await?
    };

    parse_http_response(response.as_slice())
}

async fn post_by_http(path: &str) -> CmdResult {
    let clash_info = Config::clash().await.data_arc().get_client_info();
    let server = clash_info.server.trim();
    if server.is_empty() {
        return Err("Clash external controller is not available".into());
    }

    let base = if server.starts_with("http://") || server.starts_with("https://") {
        server.to_owned()
    } else {
        format!("http://{server}")
    };
    let url = format!("{}{}", base.trim_end_matches('/'), path);

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .stringify_err()?;
    let mut request = client.post(url.as_str());

    if let Some(secret) = clash_info
        .secret
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        request = request.bearer_auth(secret);
    }

    let response = request.send().await.stringify_err()?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let message = if body.trim().is_empty() {
            format!("Mihomo API request failed: {status}")
        } else {
            body
        };
        return Err(message.into());
    }

    Ok(())
}
