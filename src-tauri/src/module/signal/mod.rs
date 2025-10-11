#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

pub fn register() {
    #[cfg(windows)]
    windows::register();

    #[cfg(unix)]
    unix::register();
}
