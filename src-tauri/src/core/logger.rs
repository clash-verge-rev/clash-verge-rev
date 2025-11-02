use std::sync::Arc;

use clash_verge_logger::AsyncLogger;
use once_cell::sync::Lazy;

pub static CLASH_LOGGER: Lazy<Arc<AsyncLogger>> = Lazy::new(|| Arc::new(AsyncLogger::new()));
