use std::{collections::VecDeque, sync::Arc};

use compact_str::CompactString as String;
use once_cell::sync::OnceCell;
use parking_lot::{RwLock, RwLockReadGuard};

const LOGS_QUEUE_LEN: usize = 100;

pub struct ClashLogger {
    logs: Arc<RwLock<VecDeque<String>>>,
}

impl ClashLogger {
    pub fn global() -> &'static ClashLogger {
        static LOGGER: OnceCell<ClashLogger> = OnceCell::new();

        LOGGER.get_or_init(|| ClashLogger {
            logs: Arc::new(RwLock::new(VecDeque::with_capacity(LOGS_QUEUE_LEN + 10))),
        })
    }

    pub fn get_logs(&self) -> RwLockReadGuard<'_, VecDeque<String>> {
        self.logs.read()
    }

    pub fn append_log(&self, text: String) {
        let mut logs = self.logs.write();
        if logs.len() > LOGS_QUEUE_LEN {
            logs.pop_front();
        }
        logs.push_back(text);
    }

    pub fn clear_logs(&self) {
        let mut logs = self.logs.write();
        logs.clear();
    }
}
