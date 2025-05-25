use crate::{logging, utils::logging::Type};
use anyhow::{bail, Context, Result};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const IPC_SOCKET_NAME: &str = if cfg!(windows) {
    r"\\.\pipe\clash-verge-service"
} else {
    "/tmp/clash-verge-service.sock"
};

// 定义命令类型
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum IpcCommand {
    GetClash,
    GetVersion,
    StartClash,
    StopClash,
}

// IPC消息格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: String,
    pub timestamp: u64,
    pub command: IpcCommand,
    pub payload: serde_json::Value,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: String,
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub signature: String,
}

// 密钥派生函数
fn derive_secret_key() -> Vec<u8> {
    // to do
    // 从系统安全存储中获取或从程序安装时生成的密钥文件中读取
    let unique_app_id = "clash-verge-app-secret-fuck-me-until-daylight";
    let mut hasher = Sha256::new();
    hasher.update(unique_app_id.as_bytes());
    hasher.finalize().to_vec()
}

// 创建带签名的请求
pub fn create_signed_request(
    command: IpcCommand,
    payload: serde_json::Value,
) -> Result<IpcRequest> {
    let id = nanoid::nanoid!(32);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let unsigned_request = IpcRequest {
        id: id.clone(),
        timestamp,
        command: command.clone(),
        payload: payload.clone(),
        signature: String::new(),
    };

    let unsigned_json = serde_json::to_string(&unsigned_request)?;
    let signature = sign_message(&unsigned_json)?;

    Ok(IpcRequest {
        id,
        timestamp,
        command,
        payload,
        signature,
    })
}

// 签名消息
fn sign_message(message: &str) -> Result<String> {
    type HmacSha256 = Hmac<Sha256>;

    let secret_key = derive_secret_key();
    let mut mac = HmacSha256::new_from_slice(&secret_key).context("HMAC初始化失败")?;

    mac.update(message.as_bytes());
    let result = mac.finalize();
    let signature = hex::encode(result.into_bytes());

    Ok(signature)
}

// 验证响应签名
pub fn verify_response_signature(response: &IpcResponse) -> Result<bool> {
    let verification_response = IpcResponse {
        id: response.id.clone(),
        success: response.success,
        data: response.data.clone(),
        error: response.error.clone(),
        signature: String::new(),
    };

    let message = serde_json::to_string(&verification_response)?;
    let expected_signature = sign_message(&message)?;

    Ok(expected_signature == response.signature)
}

// IPC连接管理-win
#[cfg(target_os = "windows")]
pub async fn send_ipc_request(
    command: IpcCommand,
    payload: serde_json::Value,
) -> Result<IpcResponse> {
    use std::{
        ffi::CString,
        fs::File,
        io::{Read, Write},
        os::windows::io::{FromRawHandle, RawHandle},
        ptr,
    };
    use winapi::um::{
        fileapi::{CreateFileA, OPEN_EXISTING},
        handleapi::INVALID_HANDLE_VALUE,
        winnt::{FILE_SHARE_READ, FILE_SHARE_WRITE, GENERIC_READ, GENERIC_WRITE},
    };

    logging!(info, Type::Service, true, "正在连接服务 (Windows)...");

    let command_type = format!("{:?}", command);

    let request = match create_signed_request(command, payload) {
        Ok(req) => req,
        Err(e) => {
            logging!(error, Type::Service, true, "创建签名请求失败: {}", e);
            return Err(e);
        }
    };

    let request_json = serde_json::to_string(&request)?;

    let result = tokio::task::spawn_blocking(move || -> Result<IpcResponse> {
        let c_pipe_name = match CString::new(IPC_SOCKET_NAME) {
            Ok(name) => name,
            Err(e) => {
                logging!(error, Type::Service, true, "创建CString失败: {}", e);
                return Err(anyhow::anyhow!("创建CString失败: {}", e));
            }
        };

        let handle = unsafe {
            CreateFileA(
                c_pipe_name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };

        if handle == INVALID_HANDLE_VALUE {
            let error = std::io::Error::last_os_error();
            logging!(
                error,
                Type::Service,
                true,
                "连接到服务命名管道失败: {}",
                error
            );
            return Err(anyhow::anyhow!("无法连接到服务命名管道: {}", error));
        }

        let mut pipe = unsafe { File::from_raw_handle(handle as RawHandle) };
        logging!(info, Type::Service, true, "服务连接成功 (Windows)");

        let request_bytes = request_json.as_bytes();
        let len_bytes = (request_bytes.len() as u32).to_be_bytes();

        if let Err(e) = pipe.write_all(&len_bytes) {
            logging!(error, Type::Service, true, "写入请求长度失败: {}", e);
            return Err(anyhow::anyhow!("写入请求长度失败: {}", e));
        }

        if let Err(e) = pipe.write_all(request_bytes) {
            logging!(error, Type::Service, true, "写入请求内容失败: {}", e);
            return Err(anyhow::anyhow!("写入请求内容失败: {}", e));
        }

        if let Err(e) = pipe.flush() {
            logging!(error, Type::Service, true, "刷新管道失败: {}", e);
            return Err(anyhow::anyhow!("刷新管道失败: {}", e));
        }

        let mut response_len_bytes = [0u8; 4];
        if let Err(e) = pipe.read_exact(&mut response_len_bytes) {
            logging!(error, Type::Service, true, "读取响应长度失败: {}", e);
            return Err(anyhow::anyhow!("读取响应长度失败: {}", e));
        }

        let response_len = u32::from_be_bytes(response_len_bytes) as usize;

        let mut response_bytes = vec![0u8; response_len];
        if let Err(e) = pipe.read_exact(&mut response_bytes) {
            logging!(error, Type::Service, true, "读取响应内容失败: {}", e);
            return Err(anyhow::anyhow!("读取响应内容失败: {}", e));
        }

        let response: IpcResponse = match serde_json::from_slice::<IpcResponse>(&response_bytes) {
            Ok(r) => r,
            Err(e) => {
                logging!(error, Type::Service, true, "服务响应解析失败: {}", e);
                return Err(anyhow::anyhow!("解析响应失败: {}", e));
            }
        };

        match verify_response_signature(&response) {
            Ok(valid) => {
                if !valid {
                    logging!(error, Type::Service, true, "服务响应签名验证失败");
                    bail!("服务响应签名验证失败");
                }
            }
            Err(e) => {
                logging!(error, Type::Service, true, "验证响应签名时出错: {}", e);
                return Err(e);
            }
        }

        logging!(
            info,
            Type::Service,
            true,
            "IPC请求完成: 命令={}, 成功={}",
            command_type,
            response.success
        );
        Ok(response)
    })
    .await??;

    Ok(result)
}

// IPC连接管理-unix
#[cfg(target_family = "unix")]
pub async fn send_ipc_request(
    command: IpcCommand,
    payload: serde_json::Value,
) -> Result<IpcResponse> {
    use std::os::unix::net::UnixStream;

    logging!(info, Type::Service, true, "正在连接服务 (Unix)...");

    let command_type = format!("{:?}", command);

    let request = match create_signed_request(command, payload) {
        Ok(req) => req,
        Err(e) => {
            logging!(error, Type::Service, true, "创建签名请求失败: {}", e);
            return Err(e);
        }
    };

    let request_json = serde_json::to_string(&request)?;

    let mut stream = match UnixStream::connect(IPC_SOCKET_NAME) {
        Ok(s) => {
            logging!(info, Type::Service, true, "服务连接成功 (Unix)");
            s
        }
        Err(e) => {
            logging!(error, Type::Service, true, "连接到Unix套接字失败: {}", e);
            return Err(anyhow::anyhow!("无法连接到服务Unix套接字: {}", e));
        }
    };

    let request_bytes = request_json.as_bytes();
    let len_bytes = (request_bytes.len() as u32).to_be_bytes();

    if let Err(e) = std::io::Write::write_all(&mut stream, &len_bytes) {
        logging!(error, Type::Service, true, "写入请求长度失败: {}", e);
        return Err(anyhow::anyhow!("写入请求长度失败: {}", e));
    }

    if let Err(e) = std::io::Write::write_all(&mut stream, request_bytes) {
        logging!(error, Type::Service, true, "写入请求内容失败: {}", e);
        return Err(anyhow::anyhow!("写入请求内容失败: {}", e));
    }

    let mut response_len_bytes = [0u8; 4];
    if let Err(e) = std::io::Read::read_exact(&mut stream, &mut response_len_bytes) {
        logging!(error, Type::Service, true, "读取响应长度失败: {}", e);
        return Err(anyhow::anyhow!("读取响应长度失败: {}", e));
    }

    let response_len = u32::from_be_bytes(response_len_bytes) as usize;

    let mut response_bytes = vec![0u8; response_len];
    if let Err(e) = std::io::Read::read_exact(&mut stream, &mut response_bytes) {
        logging!(error, Type::Service, true, "读取响应内容失败: {}", e);
        return Err(anyhow::anyhow!("读取响应内容失败: {}", e));
    }

    let response: IpcResponse = match serde_json::from_slice::<IpcResponse>(&response_bytes) {
        Ok(r) => r,
        Err(e) => {
            logging!(error, Type::Service, true, "服务响应解析失败: {}", e,);
            return Err(anyhow::anyhow!("解析响应失败: {}", e));
        }
    };

    match verify_response_signature(&response) {
        Ok(valid) => {
            if !valid {
                logging!(error, Type::Service, true, "服务响应签名验证失败");
                bail!("服务响应签名验证失败");
            }
        }
        Err(e) => {
            logging!(error, Type::Service, true, "验证响应签名时出错: {}", e);
            return Err(e);
        }
    }

    logging!(
        info,
        Type::Service,
        true,
        "IPC请求完成: 命令={}, 成功={}",
        command_type,
        response.success
    );
    Ok(response)
}
