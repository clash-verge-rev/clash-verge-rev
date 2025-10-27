use signal_hook::{
    consts::{SIGHUP, SIGINT, SIGTERM},
    iterator::Signals,
    low_level,
};

use crate::{feat, logging, logging_error, utils::logging::Type};

pub fn register() {
    tauri::async_runtime::spawn(async {
        let signals = [SIGTERM, SIGINT, SIGHUP];
        match Signals::new(signals) {
            Ok(mut sigs) => {
                for signal in &mut sigs {
                    let signal_to_str = |signal: i32| match signal {
                        SIGTERM => "SIGTERM",
                        SIGINT => "SIGINT",
                        SIGHUP => "SIGHUP",
                        _ => "UNKNOWN",
                    };
                    logging!(info, Type::System, "捕获到信号 {}", signal_to_str(signal));
                    feat::clean_async().await;
                    // After printing it, do whatever the signal was supposed to do in the first place
                    logging_error!(
                        Type::System,
                        "信号 {:?} 默认处理失败",
                        low_level::emulate_default_handler(signal)
                    );
                }
            }
            Err(e) => {
                logging!(error, Type::System, "注册信号处理器失败: {}", e);
            }
        }
    });
}
