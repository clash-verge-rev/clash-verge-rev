use signal_hook::{
    consts::{SIGHUP, SIGINT, SIGTERM},
    iterator::Signals,
    low_level,
};

use crate::utils::resolve;

pub fn register() {
    let signals = &[SIGTERM, SIGINT, SIGHUP];
    let mut sigs = Signals::new(signals).unwrap();
    std::thread::spawn(move || {
        for signal in &mut sigs {
            let signal_to_str = |signal: i32| match signal {
                SIGTERM => "SIGTERM",
                SIGINT => "SIGINT",
                SIGHUP => "SIGHUP",
                _ => "UNKNOWN",
            };
            log::info!("Received signal {}", signal_to_str(signal));
            resolve::resolve_reset();
            // After printing it, do whatever the signal was supposed to do in the first place
            low_level::emulate_default_handler(signal).unwrap();
        }
    });
}
