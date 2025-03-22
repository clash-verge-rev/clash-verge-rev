use crate::module::lightweight::entry_lightweight_mode;

pub fn lightweight_mode() {
    log::info!(target: "app","Lightweight mode enabled");
    entry_lightweight_mode();
}
