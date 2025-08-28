#![allow(dead_code)]
use core::str;
use std::io::{BufRead, BufReader, Cursor, Read};

use base64::{Engine, engine::general_purpose};
use http::{
    Version,
    header::{CONTENT_LENGTH, CONTENT_TYPE},
};
use httparse::EMPTY_HEADER;
use rand::Rng;

use crate::{Error, Result};

/// 生成 WebSocket 握手密钥
pub fn generate_websocket_key() -> String {
    // 生成 16 字节随机数
    let mut rng = rand::rng();
    let mut key = [0u8; 16];
    rng.fill(&mut key);
    // Base64 编码
    general_purpose::STANDARD.encode(key)
}

pub fn build_socket_request(req: reqwest::RequestBuilder) -> Result<String> {
    let req = req.build()?;
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

pub fn parse_socket_response(response_str: &str, is_chunked: bool) -> Result<reqwest::Response> {
    log::debug!("parsing socket response");
    log::trace!("chunked: {is_chunked}, response: {response_str}");
    let mut headers = [EMPTY_HEADER; 16];
    let mut res = httparse::Response::new(&mut headers);
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
            let mut body = response_str.split("\r\n\r\n").nth(1).unwrap_or_default().to_string();
            if is_chunked {
                body = decode_chunked(&body)?;
            }
            // {
            //     use std::io::Write;
            //     let mut file = std::fs::File::create("body.json")?;
            //     file.write_all(body.as_bytes())?;
            // }
            let response = res_builder.body(body)?;
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

/// 解析 chunked 数据, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Transfer-Encoding#examples
fn decode_chunked(data: &str) -> Result<String> {
    let mut reader = BufReader::new(Cursor::new(data.as_bytes()));
    let mut result = Vec::new();

    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        // 解析块大小（十六进制）
        if let Ok(chunk_size) = usize::from_str_radix(line.trim(), 16) {
            if chunk_size == 0 {
                break;
            }
            // 读取块数据
            let mut chunk = vec![0; chunk_size];
            reader.read_exact(&mut chunk)?;
            result.extend_from_slice(&chunk);
            // 跳过 \r\n 分隔符
            reader.read_line(&mut String::new())?;
        } else {
            log::error!("Failed to parse chunk size: {line}");
            return Err(Error::HttpParseError(format!("Failed to parse chunk size: {line}")));
        }
    }
    let body = String::from_utf8(result)?;
    Ok(body)
}
