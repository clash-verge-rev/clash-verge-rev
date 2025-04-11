use std::future::Future;
use tauri::{async_runtime, async_runtime::JoinHandle};

pub struct AsyncHandler;

impl AsyncHandler {
    pub fn spawn<F, Fut>(f: F) -> JoinHandle<()>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        async_runtime::spawn(f())
    }

    pub fn spawn_blocking<F, R>(f: F) -> JoinHandle<R>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        async_runtime::spawn_blocking(f)
    }

    pub fn block_on<F, Fut, R>(f: F) -> R
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = R>,
    {
        async_runtime::block_on(f())
    }
}
