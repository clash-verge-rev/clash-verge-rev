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
}
