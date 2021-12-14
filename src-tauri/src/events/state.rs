use std::sync::{Arc, Mutex};

use super::emit::ClashInfoPayload;

#[derive(Default)]
pub struct ClashInfoState(pub Arc<Mutex<ClashInfoPayload>>);
