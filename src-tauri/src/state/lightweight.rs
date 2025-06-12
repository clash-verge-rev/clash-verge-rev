use std::sync::{Arc, Once, OnceLock};

use crate::{logging, utils::logging::Type};

#[derive(Clone)]
pub struct LightWeightState {
    #[allow(unused)]
    once: Arc<Once>,
    pub is_lightweight: bool,
}

impl LightWeightState {
    pub fn new() -> Self {
        Self {
            once: Arc::new(Once::new()),
            is_lightweight: false,
        }
    }

    #[allow(unused)]
    pub fn run_once_time<F>(&self, f: F)
    where
        F: FnOnce() + Send + 'static,
    {
        self.once.call_once(f);
    }

    pub fn set_lightweight_mode(&mut self, value: bool) -> &Self {
        self.is_lightweight = value;
        if value {
            logging!(info, Type::Lightweight, true, "轻量模式已开启");
        } else {
            logging!(info, Type::Lightweight, true, "轻量模式已关闭");
        }
        self
    }
}

impl Default for LightWeightState {
    fn default() -> Self {
        static INSTANCE: OnceLock<LightWeightState> = OnceLock::new();
        INSTANCE.get_or_init(LightWeightState::new).clone()
    }
}
