use crate::utils::dirs::get_encryption_key;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

const NONCE_LENGTH: usize = 12;

/// Encrypt data
pub fn encrypt_data(data: &str) -> Result<String, Box<dyn std::error::Error>> {
    let encryption_key = get_encryption_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&encryption_key);
    let cipher = Aes256Gcm::new(key);

    // Generate random nonce
    let mut nonce = vec![0u8; NONCE_LENGTH];
    getrandom::getrandom(&mut nonce)?;

    // Encrypt data
    let ciphertext = cipher
        .encrypt(nonce.as_slice().into(), data.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Concatenate nonce and ciphertext and encode them in base64
    let mut combined = nonce;
    combined.extend(ciphertext);
    Ok(STANDARD.encode(combined))
}

/// Decrypt data
pub fn decrypt_data(encrypted: &str) -> Result<String, Box<dyn std::error::Error>> {
    let encryption_key = get_encryption_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&encryption_key);
    let cipher = Aes256Gcm::new(key);
    // Decode from base64
    let data = STANDARD.decode(encrypted)?;
    if data.len() < NONCE_LENGTH {
        return Err("Invalid encrypted data".into());
    }

    // Separate nonce and ciphertext
    let (nonce, ciphertext) = data.split_at(NONCE_LENGTH);

    // Decrypt data
    let plaintext = cipher
        .decrypt(nonce.into(), ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| e.into())
}

/// Serialize encrypted function
pub fn serialize_encrypted<T, S>(value: &T, serializer: S) -> Result<S::Ok, S::Error>
where
    T: Serialize,
    S: Serializer,
{
    // 如果序列化失败，返回 None
    let json = match serde_json::to_string(value) {
        Ok(j) => j,
        Err(_) => return serializer.serialize_none(),
    };

    // 如果加密失败，返回 None
    match encrypt_data(&json) {
        Ok(encrypted) => serializer.serialize_str(&encrypted),
        Err(_) => serializer.serialize_none(),
    }
}

/// Deserialize decrypted function
pub fn deserialize_encrypted<'a, T, D>(deserializer: D) -> Result<T, D::Error>
where
    T: for<'de> Deserialize<'de> + Default,
    D: Deserializer<'a>,
{
    // 如果反序列化字符串失败，返回默认值
    let encrypted = match String::deserialize(deserializer) {
        Ok(s) => s,
        Err(_) => return Ok(T::default()),
    };

    // 如果解密失败，返回默认值
    let decrypted_string = match decrypt_data(&encrypted) {
        Ok(data) => data,
        Err(_) => return Ok(T::default()),
    };
    // 如果 JSON 解析失败，返回默认值
    match serde_json::from_str(&decrypted_string) {
        Ok(value) => Ok(value),
        Err(_) => Ok(T::default()),
    }
}
