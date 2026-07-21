use std::sync::OnceLock;

use clash_verge_logging::{Type, logging};

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

pub(crate) static RUNTIME: OnceLock<Option<tokio::runtime::Runtime>> = OnceLock::new();

pub fn register<F, Fut>(f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future + Send + 'static,
{
    RUNTIME.get_or_init(|| match tokio::runtime::Runtime::new() {
        Ok(rt) => Some(rt),
        Err(e) => {
            logging!(
                info,
                Type::SystemSignal,
                "register shutdown signal failed, create tokio runtime error: {}",
                e
            );
            None
        }
    });

    #[cfg(unix)]
    unix::register(f);

    #[cfg(windows)]
    windows::register(f);
}
