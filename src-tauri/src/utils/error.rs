use crate::log_err;
use anyhow;
use std::{
    backtrace::{Backtrace, BacktraceStatus},
    thread,
};

pub fn redirect_panic_to_log() {
    std::panic::set_hook(Box::new(move |panic_info| {
        let thread = thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>");
        let payload = panic_info.payload();

        let payload = if let Some(s) = payload.downcast_ref::<&str>() {
            &**s
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s
        } else {
            &format!("{:?}", payload)
        };

        let location = panic_info
            .location()
            .map(|l| l.to_string())
            .unwrap_or("unknown location".to_string());

        let backtrace = Backtrace::capture();
        let backtrace = if backtrace.status() == BacktraceStatus::Captured {
            &format!("stack backtrace:\n{}", backtrace)
        } else {
            "note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace"
        };

        let err: Result<(), anyhow::Error> = Err(anyhow::anyhow!(format!(
            "thread '{}' panicked at {}:\n{}\n{}",
            thread_name, location, payload, backtrace
        )));
        log_err!(err);
    }));
}
