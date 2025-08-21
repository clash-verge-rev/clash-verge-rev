use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use parking_lot::RwLock;
use rsa::Pkcs1v15Encrypt;
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::{RsaPrivateKey, RsaPublicKey, pkcs1::DecodeRsaPublicKey};
use std::io::Read;
use std::sync::LazyLock;
use std::time::Duration;

use crate::any_err;
use crate::error::{AppError, AppResult};

const PRI_KEY_PEM_FILE: &str = ".private.pem";
const PUB_KEY_PEM_FILE: &str = ".public.pem";

static PRIVATE_KEY: LazyLock<RwLock<Option<RsaPrivateKey>>> = LazyLock::new(|| RwLock::new(None));
static PUBLIC_KEY: LazyLock<RwLock<Option<RsaPublicKey>>> = LazyLock::new(|| RwLock::new(None));

pub fn get_private_key() -> Option<RsaPrivateKey> {
    PRIVATE_KEY.read().clone()
}

pub fn get_public_key() -> Option<RsaPublicKey> {
    PUBLIC_KEY.read().clone()
}

pub fn load_keys() -> AppResult<()> {
    let private_key_path = crate::utils::dirs::app_resources_dir()?.join(PRI_KEY_PEM_FILE);
    let mut pri_key_file = std::fs::File::open(private_key_path)?;
    let mut private_key_content = String::new();
    pri_key_file.read_to_string(&mut private_key_content)?;
    let private_key = RsaPrivateKey::from_pkcs1_pem(&private_key_content)?;
    *PRIVATE_KEY.write() = Some(private_key);

    let public_key_path = crate::utils::dirs::app_resources_dir()?.join(PUB_KEY_PEM_FILE);
    let mut pub_key_file = std::fs::File::open(public_key_path)?;
    let mut public_key_content = String::new();
    pub_key_file.read_to_string(&mut public_key_content)?;
    let public_key = RsaPublicKey::from_pkcs1_pem(&public_key_content)?;
    *PUBLIC_KEY.write() = Some(public_key);

    Ok(())
}

pub fn reload_keys() -> AppResult<()> {
    for i in 0..=10 {
        if i == 10 {
            return Err(AppError::LoadKeys("max retries reached for reload keys".to_string()));
        }
        match load_keys() {
            Ok(_) => {
                if get_private_key().is_some() && get_public_key().is_some() {
                    tracing::info!("reload rsa keys successfully");
                    break;
                } else {
                    tracing::info!("retrying... attempt {}/{}", i, 10);
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
            Err(_) => {
                tracing::info!("retrying... attempt {}/{}", i, 10);
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    Ok(())
}

pub fn rsa_encrypt(public_key: &RsaPublicKey, data: &[u8]) -> AppResult<Vec<u8>> {
    Ok(public_key.encrypt(&mut rand::thread_rng(), Pkcs1v15Encrypt, data)?)
}

pub fn rsa_decrypt(private_key: &RsaPrivateKey, enc_data: &[u8]) -> AppResult<Vec<u8>> {
    Ok(private_key.decrypt(Pkcs1v15Encrypt, enc_data)?)
}

pub fn aes_encrypt(key: &[u8], nonce: &[u8], data: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(key.into());
    let res = cipher
        .encrypt(Nonce::from_slice(nonce), data)
        .map_err(|e| any_err!("aes encrypt failed, error {e}"))?;
    Ok(res)
}

pub fn aes_decrypt(key: &[u8], nonce: &[u8], data: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(key.into());
    let res = cipher
        .decrypt(Nonce::from_slice(nonce), data)
        .map_err(|e| any_err!("aes decrypt failed, error {e}"))?;
    Ok(res)
}

pub fn gen_aes_key_and_nonce() -> (Vec<u8>, Vec<u8>) {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    (key.to_vec(), nonce.to_vec())
}

pub fn encrypt_socket_data(public_key: &RsaPublicKey, data: &str) -> AppResult<String> {
    let (aes_key, nonce) = gen_aes_key_and_nonce();
    let ciphertext = aes_encrypt(&aes_key, &nonce, data.as_bytes())?;
    let enc_key = rsa_encrypt(public_key, &aes_key)?;

    let combined = format!(
        "{}|{}|{}\n",
        BASE64_STANDARD.encode(&enc_key),
        BASE64_STANDARD.encode(&nonce),
        BASE64_STANDARD.encode(&ciphertext)
    );

    Ok(combined)
}

pub fn decrypt_socket_data(private_key: &RsaPrivateKey, data: &str) -> AppResult<String> {
    let parts: Vec<&str> = data.trim().split('|').collect();
    if parts.len() != 3 {
        return Err(AppError::Service("invalid format".to_string()));
    }

    let enc_data = BASE64_STANDARD.decode(parts[0])?;
    let nonce = BASE64_STANDARD.decode(parts[1])?;
    let ciphertext = BASE64_STANDARD.decode(parts[2])?;

    let aes_key = rsa_decrypt(private_key, &enc_data)?;
    let plaintext = aes_decrypt(&aes_key, &nonce, &ciphertext).unwrap();
    let data = String::from_utf8_lossy(&plaintext);

    Ok(data.to_string())
}
