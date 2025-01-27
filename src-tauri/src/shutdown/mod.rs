#[cfg(any(target_os = "linux", target_os = "macos"))]
mod unix;
#[cfg(target_os = "windows")]
mod windows;

pub fn register() {
    #[cfg(target_os = "windows")]
    windows::register();

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    unix::register();
}
