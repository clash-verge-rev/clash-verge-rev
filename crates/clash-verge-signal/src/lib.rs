#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

pub fn register<F, Fut>(#[cfg(windows)] app_handle: &tauri::AppHandle, f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future + Send + 'static,
{
    #[cfg(unix)]
    unix::register(f);

    #[cfg(windows)]
    windows::register(app_handle, f);
}
