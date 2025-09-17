use crate::{logging, utils::logging::Type};
use anyhow::{Context, Result, bail};
use backoff::{Error as BackoffError, ExponentialBackoff};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;

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

fn create_backoff_strategy() -> ExponentialBackoff {
    ExponentialBackoff {
        initial_interval: Duration::from_millis(50),
        max_interval: Duration::from_secs(1),
        max_elapsed_time: Some(Duration::from_secs(3)),
        multiplier: 1.5,
        ..Default::default()
    }
}

pub async fn send_ipc_request(
    command: IpcCommand,
    payload: serde_json::Value,
) -> Result<IpcResponse> {
    let command_type = format!("{command:?}");

    let operation = || async {
        match send_ipc_request_internal(command.clone(), payload.clone()).await {
            Ok(response) => Ok(response),
            Err(e) => {
                logging!(
                    warn,
                    Type::Service,
                    true,
                    "IPC请求失败，准备重试: 命令={}, 错误={}",
                    command_type,
                    e
                );
                Err(BackoffError::transient(e))
            }
        }
    };

    match backoff::future::retry(create_backoff_strategy(), operation).await {
        Ok(response) => {
            // logging!(
            //     info,
            //     Type::Service,
            //     true,
            //     "IPC请求成功: 命令={}, 成功={}",
            //     command_type,
            //     response.success
            // );
            Ok(response)
        }
        Err(e) => {
            logging!(
                error,
                Type::Service,
                true,
                "IPC请求最终失败，重试已耗尽: 命令={}, 错误={}",
                command_type,
                e
            );
            Err(anyhow::anyhow!("IPC请求重试失败: {}", e))
        }
    }
}

// 内部IPC请求实现（不带重试）
async fn send_ipc_request_internal(
    command: IpcCommand,
    payload: serde_json::Value,
) -> Result<IpcResponse> {
    #[cfg(target_os = "windows")]
    {
        send_ipc_request_windows(command, payload).await
    }
    #[cfg(target_family = "unix")]
    {
        send_ipc_request_unix(command, payload).await
    }
}

// IPC连接管理-win
#[cfg(target_os = "windows")]
async fn send_ipc_request_windows(
    command: IpcCommand,
    payload: serde_json::Value,
) -> Result<IpcResponse> {
    let request = create_signed_request(command, payload)?;
    let request_json = serde_json::to_string(&request)?;
    let request_bytes = request_json.as_bytes();
    let len_bytes = (request_bytes.len() as u32).to_be_bytes();

    let mut pipe = match ClientOptions::new().open(IPC_SOCKET_NAME) {
        Ok(p) => p,
        Err(e) => {
            logging!(error, Type::Service, true, "连接到服务命名管道失败: {}", e);
            return Err(anyhow::anyhow!("无法连接到服务命名管道: {}", e));
        }
    };

    logging!(info, Type::Service, true, "服务连接成功 (Windows)");

    pipe.write_all(&len_bytes).await?;
    pipe.write_all(request_bytes).await?;
    pipe.flush().await?;

    let mut response_len_bytes = [0u8; 4];
    pipe.read_exact(&mut response_len_bytes).await?;
    let response_len = u32::from_be_bytes(response_len_bytes) as usize;

    let mut response_bytes = vec![0u8; response_len];
    pipe.read_exact(&mut response_bytes).await?;

    let response: IpcResponse = serde_json::from_slice(&response_bytes)
        .map_err(|e| anyhow::anyhow!("解析响应失败: {}", e))?;

    if !verify_response_signature(&response)? {
        logging!(error, Type::Service, true, "服务响应签名验证失败");
        bail!("服务响应签名验证失败");
    }

    Ok(response)
}

// IPC连接管理-unix
#[cfg(target_family = "unix")]
async fn send_ipc_request_unix(
    command: IpcCommand,
    payload: serde_json::Value,
) -> Result<IpcResponse> {
    let request = create_signed_request(command, payload)?;
    let request_json = serde_json::to_string(&request)?;

    let mut stream = match UnixStream::connect(IPC_SOCKET_NAME).await {
        Ok(s) => s,
        Err(e) => {
            logging!(error, Type::Service, true, "连接到Unix套接字失败: {}", e);
            return Err(anyhow::anyhow!("无法连接到服务Unix套接字: {}", e));
        }
    };

    let request_bytes = request_json.as_bytes();
    let len_bytes = (request_bytes.len() as u32).to_be_bytes();

    stream.write_all(&len_bytes).await?;
    stream.write_all(request_bytes).await?;
    stream.flush().await?;

    // 读取响应长度
    let mut response_len_bytes = [0u8; 4];
    stream.read_exact(&mut response_len_bytes).await?;
    let response_len = u32::from_be_bytes(response_len_bytes) as usize;

    let mut response_bytes = vec![0u8; response_len];
    stream.read_exact(&mut response_bytes).await?;

    let response: IpcResponse = serde_json::from_slice(&response_bytes)
        .map_err(|e| anyhow::anyhow!("解析响应失败: {}", e))?;

    if !verify_response_signature(&response)? {
        logging!(error, Type::Service, true, "服务响应签名验证失败");
        bail!("服务响应签名验证失败");
    }

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_signed_request() {
        let command = IpcCommand::GetVersion;
        let payload = serde_json::json!({"test": "data"});

        let result = create_signed_request(command, payload);
        assert!(result.is_ok());

        if let Ok(request) = result {
            assert!(!request.id.is_empty());
            assert!(!request.signature.is_empty());
            assert_eq!(request.command, IpcCommand::GetVersion);
        }
    }

    #[test]
    fn test_sign_and_verify_message() {
        let test_message = "test message for signing";

        let signature_result = sign_message(test_message);
        assert!(signature_result.is_ok());

        if let Ok(signature) = signature_result {
            assert!(!signature.is_empty());

            // 测试相同消息产生相同签名
            if let Ok(signature2) = sign_message(test_message) {
                assert_eq!(signature, signature2);
            }
        }
    }

    #[test]
    fn test_verify_response_signature() {
        let response = IpcResponse {
            id: "test-id".to_string(),
            success: true,
            data: Some(serde_json::json!({"result": "success"})),
            error: None,
            signature: String::new(),
        };

        // 创建正确的签名
        let verification_response = IpcResponse {
            id: response.id.clone(),
            success: response.success,
            data: response.data.clone(),
            error: response.error.clone(),
            signature: String::new(),
        };

        if let Ok(message) = serde_json::to_string(&verification_response)
            && let Ok(correct_signature) = sign_message(&message)
        {
            let signed_response = IpcResponse {
                signature: correct_signature,
                ..response
            };

            let verification_result = verify_response_signature(&signed_response);
            assert!(verification_result.is_ok());
            if let Ok(is_valid) = verification_result {
                assert!(is_valid);
            }
        }
    }
}
