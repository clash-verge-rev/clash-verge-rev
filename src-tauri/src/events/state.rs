use super::emit::ClashInfoPayload;
use crate::{
  config::{ProfilesConfig, VergeConfig},
  utils::sysopt::SysProxyConfig,
};
use std::sync::{Arc, Mutex};
use tauri::api::process::CommandChild;

#[derive(Default)]
pub struct ClashInfoState(pub Arc<Mutex<ClashInfoPayload>>);

#[derive(Default)]
pub struct ProfilesState(pub Arc<Mutex<ProfilesConfig>>);

#[derive(Default)]
pub struct VergeConfLock(pub Arc<Mutex<VergeConfig>>);

#[derive(Default)]
pub struct SomthingState(pub Arc<Mutex<Option<SysProxyConfig>>>);

#[derive(Default)]
pub struct ClashSidecarState(pub Arc<Mutex<Option<CommandChild>>>);
