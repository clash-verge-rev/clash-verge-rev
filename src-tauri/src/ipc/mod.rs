pub mod general;
pub mod memory;
pub mod traffic;

pub use general::IpcManager;
pub use memory::{get_current_memory, get_formatted_memory};
pub use traffic::{get_current_traffic, get_formatted_traffic};

pub struct Rate {
    // pub up: usize,
    // pub down: usize,
}
