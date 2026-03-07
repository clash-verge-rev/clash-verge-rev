#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicUsize, Ordering};

fn main() {
    #[allow(clippy::unwrap_used)]
    let tokio_runtime = tokio::runtime::Builder::new_multi_thread()
        // TODO: limit the number of worker threads
        // .worker_threads(4)
        .max_blocking_threads(4)
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
