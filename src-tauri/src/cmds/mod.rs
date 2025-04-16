use std::time::Duration;

use crate::{core::handle, ret_err};

pub mod backup;
pub mod clash;
pub mod common;
pub mod profile;
pub mod service;
pub mod verge;

type CmdResult<T = ()> = Result<T, String>;

pub async fn check_service_and_clash() -> CmdResult<()> {
    for i in 0..5 {
        if service::check_service().await.is_err() {
            if i == 4 {
                ret_err!("service check failed");
            } else {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        };
    }
    let mihomo = handle::Handle::get_mihomo_read().await;
    for i in 0..5 {
        if mihomo.get_base_config().await.is_err() {
            if i == 4 {
                ret_err!("clash check failed");
            } else {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    Ok(())
}
