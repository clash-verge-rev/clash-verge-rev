use signal_hook::{
    consts::{SIGHUP, SIGINT, SIGTERM},
    iterator::Signals,
    low_level,
};

use clash_verge_logging::{Type, logging, logging_error};

use crate::RUNTIME;

pub fn register<F, Fut>(f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future + Send + 'static,
{
    if let Some(Some(rt)) = RUNTIME.get() {
        rt.spawn(async move {
            let signals = [SIGTERM, SIGINT, SIGHUP];

            let mut sigs = match Signals::new(signals) {
                Ok(s) => s,
                Err(e) => {
                    logging!(error, Type::System, "注册信号处理器失败: {}", e);
                    return;
                }
            };

            for signal in &mut sigs {
                let signal_to_str = |signal| match signal {
                    SIGTERM => "SIGTERM",
                    SIGINT => "SIGINT",
                    SIGHUP => "SIGHUP",
                    _ => "UNKNOWN",
                };

                logging!(info, Type::System, "捕获到信号 {}", signal_to_str(signal));

                f().await;

                logging_error!(
                    Type::System,
                    "信号 {:?} 默认处理失败",
                    low_level::emulate_default_handler(signal)
                );
            }
        });
    } else {
        logging!(
            error,
            Type::System,
            "register shutdown signal failed, RUNTIME is not available"
        );
    }
}
