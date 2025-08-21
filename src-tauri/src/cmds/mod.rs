use std::time::Duration;

use crate::{
    any_err,
    core::handle,
    error::{AppError, AppResult},
};

pub mod backup;
pub mod clash;
pub mod common;
pub mod profile;
pub mod service;
pub mod verge;

pub async fn check_service_and_clash() -> AppResult<()> {
    for i in 0..5 {
        if service::check_service().await.is_err() {
            if i == 4 {
                return Err(AppError::Service("service check failed".to_string()));
            } else {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        };
    }
    let mihomo = handle::Handle::mihomo().await;
    for i in 0..5 {
        if mihomo.get_version().await.is_err() {
            if i == 4 {
                return Err(any_err!("clash check failed"));
            } else {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    Ok(())
}
