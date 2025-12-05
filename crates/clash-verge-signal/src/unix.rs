use clash_verge_logging::{Type, logging};
use tokio::signal::unix::{SignalKind, signal};

use crate::RUNTIME;

pub fn register<F, Fut>(f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future + Send + 'static,
{
    if let Some(Some(rt)) = RUNTIME.get() {
        rt.spawn(async move {
            let mut sigterm = match signal(SignalKind::terminate()) {
                Ok(s) => s,
                Err(e) => {
                    logging!(
                        error,
                        Type::SystemSignal,
                        "Failed to register SIGTERM: {}",
                        e
                    );
                    return;
                }
            };
            let mut sigint = match signal(SignalKind::interrupt()) {
                Ok(s) => s,
                Err(e) => {
                    logging!(
                        error,
                        Type::SystemSignal,
                        "Failed to register SIGINT: {}",
                        e
                    );
                    return;
                }
            };
            let mut sighup = match signal(SignalKind::hangup()) {
                Ok(s) => s,
                Err(e) => {
                    logging!(
                        error,
                        Type::SystemSignal,
                        "Failed to register SIGHUP: {}",
                        e
                    );
                    return;
                }
            };

            loop {
                let signal_name;
                tokio::select! {
                    _ = sigterm.recv() => {
                        signal_name = "SIGTERM";
                    }
                    _ = sigint.recv() => {
                        signal_name = "SIGINT";
                    }
                    _ = sighup.recv() => {
                        signal_name = "SIGHUP";
                    }
                    else => {
                        break;
                    }
                }

                logging!(info, Type::SystemSignal, "Caught signal {}", signal_name);

                f().await;
            }
        });
    } else {
        logging!(
            error,
            Type::SystemSignal,
            "register shutdown signal failed, RUNTIME is not available"
        );
    }
}
