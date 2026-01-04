use std::future::Future;
use tauri::{async_runtime, async_runtime::JoinHandle};

pub struct AsyncHandler;

impl AsyncHandler {
    #[inline]
    #[track_caller]
    pub fn spawn<F, Fut>(f: F) -> JoinHandle<()>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        async_runtime::spawn(f())
    }

    #[inline]
    #[track_caller]
    pub fn spawn_blocking<T, F>(f: F) -> JoinHandle<T>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        async_runtime::spawn_blocking(f)
    }

    #[inline]
    #[track_caller]
    pub fn block_on<Fut>(fut: Fut) -> Fut::Output
    where
        Fut: Future + Send + 'static,
    {
        async_runtime::block_on(fut)
    }
}
