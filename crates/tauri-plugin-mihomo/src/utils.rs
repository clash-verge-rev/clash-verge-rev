#![allow(dead_code)]

use base64::{Engine, engine::general_purpose};
use rand::Rng;

/// 生成 WebSocket 握手密钥
pub fn generate_websocket_key() -> String {
    // 生成 16 字节随机数
    let mut rng = rand::rng();
    let mut key = [0u8; 16];
    rng.fill(&mut key);
    // Base64 编码
    general_purpose::STANDARD.encode(key)
}

// 解析 chunked 数据, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Transfer-Encoding#examples
// fn decode_chunked(data: &str) -> Result<String> {
//     let mut reader = BufReader::new(Cursor::new(data.as_bytes()));
//     let mut result = Vec::new();

//     loop {
//         let mut line = String::new();
//         reader.read_line(&mut line)?;
//         // 解析块大小（十六进制）
//         if let Ok(chunk_size) = usize::from_str_radix(line.trim(), 16) {
//             if chunk_size == 0 {
//                 break;
//             }
//             // 读取块数据
//             let mut chunk = vec![0; chunk_size];
//             reader.read_exact(&mut chunk)?;
//             result.extend_from_slice(&chunk);
//             // 跳过 \r\n 分隔符
//             reader.read_line(&mut String::new())?;
//         } else {
//             log::error!("Failed to parse chunk size: {line}");
//             return Err(Error::HttpParseError(format!("Failed to parse chunk size: {line}")));
//         }
//     }
//     let body = String::from_utf8(result)?;
//     Ok(body)
// }
