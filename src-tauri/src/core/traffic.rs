use crate::core::traffic_manager::{MemoryData, TrafficData, TrafficManager};
use std::sync::OnceLock;

pub struct TrafficService {
    manager: TrafficManager,
}

static INSTANCE: OnceLock<TrafficService> = OnceLock::new();

impl TrafficService {
    pub fn global() -> &'static TrafficService {
        INSTANCE.get_or_init(|| TrafficService {
            manager: TrafficManager::new(),
        })
    }

    pub fn start(&self) -> Result<(), String> {
        self.manager.start()
    }

    pub fn stop(&self) {
        self.manager.stop();
    }

    pub fn get_traffic_data(&self) -> TrafficData {
        self.manager.get_traffic_data()
    }

    pub fn get_memory_data(&self) -> MemoryData {
        self.manager.get_memory_data()
    }

    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        self.manager.is_running()
    }
}
