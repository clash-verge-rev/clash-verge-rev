//! 解析 websocket 的数据，包含解析 [websocket 数据帧](https://datatracker.ietf.org/doc/html/rfc6455#section-5.2)

#![allow(dead_code)]
use std::io::{self, Cursor, Read};

use base64::{engine::general_purpose, Engine};
use rand::Rng;

// WebSocket 帧解析结果
#[derive(Debug)]
pub struct WebSocketFrame {
    pub opcode: u8,       // 操作码（1=文本，2=二进制，8=关闭等）
    pub payload: Vec<u8>, // 解码后的有效载荷
    pub fin: bool,        // 是否是最后一帧
}

/// 从字节数组中解析帧
pub fn parse_websocket_frame(data: &[u8]) -> io::Result<WebSocketFrame> {
    let mut cursor = Cursor::new(data);

    // 读取帧头基本信息
    let (opcode, payload_len, fin, mask_flag, mask_key) = read_frame_header(&mut cursor)?;

    // 检查剩余数据是否足够
    let total_header_len = cursor.position() as usize;
    let required_len = total_header_len + payload_len as usize;
    if data.len() < required_len {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "Incomplete frame data",
        ));
    }

    // 提取有效载荷数据
    let payload_start = total_header_len;
    let payload_end = payload_start + payload_len as usize;
    let mut payload = data[payload_start..payload_end].to_vec();

    // 应用掩码解码（客户端发送的帧必须带掩码）
    if mask_flag {
        apply_mask(&mut payload, &mask_key);
    }

    // 返回解析结果及剩余未处理数据
    // let remaining_data = &data[payload_end..];
    Ok(WebSocketFrame {
        opcode,
        payload,
        fin,
    })
}

/// 读取帧头详细信息
fn read_frame_header(cursor: &mut Cursor<&[u8]>) -> io::Result<(u8, u64, bool, bool, [u8; 4])> {
    // 读取前2字节基本头
    let mut header = [0u8; 2];
    cursor.read_exact(&mut header)?;

    let fin = (header[0] & 0x80) != 0;
    let opcode = header[0] & 0x0F;
    let mask_flag = (header[1] & 0x80) != 0;

    // 解析负载长度
    let mut payload_len = (header[1] & 0x7F) as u64;
    match payload_len {
        126 => {
            let mut len_bytes = [0u8; 2];
            cursor.read_exact(&mut len_bytes)?;
            payload_len = u16::from_be_bytes(len_bytes) as u64;
        }
        127 => {
            let mut len_bytes = [0u8; 8];
            cursor.read_exact(&mut len_bytes)?;
            payload_len = u64::from_be_bytes(len_bytes);
        }
        _ => {}
    }

    // 读取掩码密钥（如果有）
    let mut mask_key = [0u8; 4];
    if mask_flag {
        cursor.read_exact(&mut mask_key)?;
    }

    Ok((opcode, payload_len, fin, mask_flag, mask_key))
}

/// 应用掩码解码
fn apply_mask(payload: &mut [u8], mask_key: &[u8; 4]) {
    for (i, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask_key[i % 4];
    }
}

/// 生成 WebSocket 握手密钥
pub fn generate_websocket_key() -> String {
    // 生成 16 字节随机数
    let mut rng = rand::rng();
    let mut key = [0u8; 16];
    rng.fill(&mut key);
    // Base64 编码
    general_purpose::STANDARD.encode(key)
}
