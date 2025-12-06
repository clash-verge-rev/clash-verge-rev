#[cfg(feature = "tokio-trace")]
use std::any::type_name;
use std::future::Future;
#[cfg(feature = "tokio-trace")]
use std::panic::Location;
use tauri::{async_runtime, async_runtime::JoinHandle};

pub struct AsyncHandler;

impl AsyncHandler {
    // pub fn handle() -> async_runtime::RuntimeHandle {
    //     async_runtime::handle()
    // }

    #[inline]
    #[track_caller]
    pub fn spawn<F, Fut>(f: F) -> JoinHandle<()>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        #[cfg(feature = "tokio-trace")]
        Self::log_task_info(&f);
        async_runtime::spawn(f())
    }

    #[inline]
    #[track_caller]
    pub fn spawn_blocking<T, F>(f: F) -> JoinHandle<T>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        #[cfg(feature = "tokio-trace")]
        Self::log_task_info(&f);
        async_runtime::spawn_blocking(f)
    }

    #[inline]
    #[track_caller]
    pub fn block_on<Fut>(fut: Fut) -> Fut::Output
    where
        Fut: Future + Send + 'static,
    {
        #[cfg(feature = "tokio-trace")]
        Self::log_task_info(&fut);
        async_runtime::block_on(fut)
    }

    #[cfg(feature = "tokio-trace")]
    #[track_caller]
    fn log_task_info<F>(f: &F)
    where
        F: ?Sized,
    {
        const TRACE_SPECIAL_SIZE: [usize; 3] = [0, 4, 24];
        let size = std::mem::size_of_val(f);
        if TRACE_SPECIAL_SIZE.contains(&size) {
            return;
        }

        let location = Location::caller();
        let type_str = type_name::<F>();
        let size_str = format!("{} bytes", size);
        let loc_str = format!("{}:{}:{}", location.file(), location.line(), location.column());

        println!(
            "┌────────────────────┬─────────────────────────────────────────────────────────────────────────────┐"
        );
        println!("│ {:<18} │ {:<80} │", "Field", "Value");
        println!(
            "├────────────────────┼─────────────────────────────────────────────────────────────────────────────┤"
        );
        println!("│ {:<18} │ {:<80} │", "Type of task", type_str);
        println!("│ {:<18} │ {:<80} │", "Size of task", size_str);
        println!("│ {:<18} │ {:<80} │", "Called from", loc_str);
        println!(
            "└────────────────────┴─────────────────────────────────────────────────────────────────────────────┘"
        );
    }
}
