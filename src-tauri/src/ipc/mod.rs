pub mod general;
pub mod logs;
pub mod memory;
pub mod monitor;
pub mod traffic;

pub use general::IpcManager;
pub use logs::{clear_logs, get_logs_json, start_logs_monitoring, stop_logs_monitoring};
pub use memory::{get_current_memory, get_formatted_memory};
pub use traffic::{get_current_traffic, get_formatted_traffic};

pub struct Rate {
    // pub up: usize,
    // pub down: usize,
}
