use crate::core::clash_api;
use mihomo_api;
use once_cell::sync::{Lazy, OnceCell};
use std::sync::Mutex;

pub struct MihomoManager {
    mihomo: Mutex<OnceCell<mihomo_api::MihomoManager>>,
}

impl MihomoManager {
    fn __global() -> &'static MihomoManager {
        static INSTANCE: Lazy<MihomoManager> = Lazy::new(|| MihomoManager {
            mihomo: Mutex::new(OnceCell::new()),
        });
        &INSTANCE
    }

    pub fn global() -> mihomo_api::MihomoManager {
        let instance = MihomoManager::__global();
        let (current_server, headers) = clash_api::clash_client_info().unwrap();

        let lock = instance.mihomo.lock().unwrap();
        if let Some(mihomo) = lock.get() {
            if mihomo.get_mihomo_server() == current_server {
                return mihomo.clone();
            }
        }

        lock.set(mihomo_api::MihomoManager::new(current_server, headers))
            .ok();
        lock.get().unwrap().clone()
    }
}
