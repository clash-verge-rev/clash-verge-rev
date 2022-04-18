use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, Task, TaskBuilder};
use std::collections::HashMap;

pub struct Timer {
  delay_timer: DelayTimer,

  timer_map: HashMap<String, u64>,

  timer_count: u64,
}

impl Timer {
  pub fn new() -> Self {
    Timer {
      delay_timer: DelayTimerBuilder::default().build(),
      timer_map: HashMap::new(),
      timer_count: 1,
    }
  }
}
