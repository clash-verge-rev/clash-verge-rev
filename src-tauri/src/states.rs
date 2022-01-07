use crate::config::{Clash, ProfilesConfig, Verge};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct ProfilesState(pub Arc<Mutex<ProfilesConfig>>);

#[derive(Default)]
pub struct ClashState(pub Arc<Mutex<Clash>>);

#[derive(Default)]
pub struct VergeState(pub Arc<Mutex<Verge>>);
