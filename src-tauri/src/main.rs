#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicUsize, Ordering};

fn main() {
    let default_parallelism = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let worker_limit = std::cmp::min(default_parallelism, 16);
    let blocking_limit = 4 * worker_limit;

    #[allow(clippy::unwrap_used)]
    let tokio_runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_limit)
        .max_blocking_threads(blocking_limit)
        .enable_all()
        .thread_name_fn(|| {
            static ATOMIC_ID: AtomicUsize = AtomicUsize::new(0);
            let id = ATOMIC_ID.fetch_add(1, Ordering::SeqCst);
            format!("clash-verge-runtime-{id}")
        })
        .build()
        .unwrap();
    let tokio_handle = tokio_runtime.handle();
    tauri::async_runtime::set(tokio_handle.clone());

    #[cfg(feature = "tokio-trace")]
    console_subscriber::init();

    app_lib::run();
}
