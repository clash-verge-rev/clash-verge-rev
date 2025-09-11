use std::{collections::VecDeque, sync::Arc};

use once_cell::sync::OnceCell;
use parking_lot::{RwLock, RwLockReadGuard};

const LOGS_QUEUE_LEN: usize = 100;

pub struct Logger {
    logs: Arc<RwLock<VecDeque<String>>>,
}

impl Logger {
    pub fn global() -> &'static Logger {
        static LOGGER: OnceCell<Logger> = OnceCell::new();

        LOGGER.get_or_init(|| Logger {
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
