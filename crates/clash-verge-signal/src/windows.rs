use clash_verge_logging::{Type, logging};
use tokio::signal::windows;

use crate::RUNTIME;

pub fn register<F, Fut>(f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future + Send + 'static,
{
    if let Some(Some(rt)) = RUNTIME.get() {
        rt.spawn(async move {
            let mut ctrl_c = match windows::ctrl_c() {
                Ok(s) => s,
                Err(e) => {
                    logging!(
                        error,
                        Type::SystemSignal,
                        "Failed to register Ctrl+C: {}",
                        e
                    );
                    return;
                }
            };

            let mut ctrl_close = match windows::ctrl_close() {
                Ok(s) => s,
                Err(e) => {
                    logging!(
                        error,
                        Type::SystemSignal,
                        "Failed to register Ctrl+Close: {}",
                        e
                    );
                    return;
                }
            };

            let mut ctrl_shutdown = match windows::ctrl_shutdown() {
                Ok(s) => s,
                Err(e) => {
                    logging!(
                        error,
                        Type::SystemSignal,
                        "Failed to register Ctrl+Shutdown: {}",
                        e
                    );
                    return;
                }
            };

            let mut ctrl_logoff = match windows::ctrl_logoff() {
                Ok(s) => s,
                Err(e) => {
                    logging!(
                        error,
                        Type::SystemSignal,
                        "Failed to register Ctrl+Logoff: {}",
                        e
                    );
                    return;
                }
            };

            let signal_name;
            tokio::select! {
                _ = ctrl_c.recv() => {
                    signal_name = "Ctrl+C";
                }
                _ = ctrl_close.recv() => {
                    signal_name = "Ctrl+Close";
                }
                _ = ctrl_shutdown.recv() => {
                    signal_name = "Ctrl+Shutdown";
                }
                _ = ctrl_logoff.recv() => {
                    signal_name = "Ctrl+Logoff";
                }
            }

            logging!(
                info,
                Type::SystemSignal,
                "Caught Windows signal: {}",
                signal_name
            );

            f().await;
        });
    } else {
        logging!(
            error,
            Type::SystemSignal,
            "register shutdown signal failed, RUNTIME is not available"
        );
    }
}
