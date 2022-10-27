use self::handle::Handle;
use self::hotkey::Hotkey;
use self::sysopt::Sysopt;
use self::timer::Timer;
use crate::config::enhance_config;
use crate::data::*;
use crate::log_if_err;
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde_yaml::{Mapping, Value};
use std::sync::Arc;

mod handle;
mod hotkey;
mod service;
mod sysopt;
mod timer;
pub mod tray;

pub use self::service::*;

#[derive(Clone)]
pub struct Core {
  pub service: Arc<Mutex<Service>>,
  pub sysopt: Arc<Mutex<Sysopt>>,
  pub timer: Arc<Mutex<Timer>>,
  pub hotkey: Arc<Mutex<Hotkey>>,
  pub runtime: Arc<Mutex<RuntimeResult>>,
  pub handle: Arc<Mutex<Handle>>,
}

impl Core {
  pub fn global() -> &'static Core {
    static CORE: OnceCell<Core> = OnceCell::new();

    CORE.get_or_init(|| Core {
      service: Arc::new(Mutex::new(Service::new())),
      sysopt: Arc::new(Mutex::new(Sysopt::new())),
      timer: Arc::new(Mutex::new(Timer::new())),
      hotkey: Arc::new(Mutex::new(Hotkey::new())),
      runtime: Arc::new(Mutex::new(RuntimeResult::default())),
      handle: Arc::new(Mutex::new(Handle::default())),
    })
  }

  /// initialize the core state
  pub fn init(&self, app_handle: tauri::AppHandle) {
    // kill old clash process
    Service::kill_old_clash();

    let mut handle = self.handle.lock();
    handle.set_inner(app_handle.clone());
    drop(handle);

    let mut service = self.service.lock();
    log_if_err!(service.start());
    drop(service);

    log_if_err!(self.activate());

    let mut sysopt = self.sysopt.lock();
    log_if_err!(sysopt.init_launch());
    log_if_err!(sysopt.init_sysproxy());
    drop(sysopt);

    let handle = self.handle.lock();
    log_if_err!(handle.update_systray_part());
    drop(handle);

    let mut hotkey = self.hotkey.lock();
    log_if_err!(hotkey.init(app_handle));
    drop(hotkey);

    // timer initialize
    let mut timer = self.timer.lock();
    log_if_err!(timer.restore());
  }

  /// restart the clash sidecar
  pub fn restart_clash(&self) -> Result<()> {
    let mut service = self.service.lock();
    service.restart()?;
    drop(service);
    self.activate()
  }

  /// change the clash core
  pub fn change_core(&self, clash_core: Option<String>) -> Result<()> {
    let clash_core = clash_core.unwrap_or("clash".into());

    if &clash_core != "clash" && &clash_core != "clash-meta" {
      bail!("invalid clash core name \"{clash_core}\"");
    }

    let global = Data::global();
    let mut verge = global.verge.lock();
    verge.patch_config(Verge {
      clash_core: Some(clash_core.clone()),
      ..Verge::default()
    })?;
    drop(verge);

    let mut service = self.service.lock();
    service.clear_logs();
    service.restart()?;
    drop(service);

    self.activate()
  }

  /// Patch Clash
  /// handle the clash config changed
  pub fn patch_clash(&self, patch: Mapping) -> Result<()> {
    let has_port = patch.contains_key(&Value::from("mixed-port"));
    let has_mode = patch.contains_key(&Value::from("mode"));

    let port = {
      let global = Data::global();
      let mut clash = global.clash.lock();
      clash.patch_config(patch)?;
      clash.info.port.clone()
    };

    // todo: port check
    if has_port && port.is_some() {
      let mut service = self.service.lock();
      service.restart()?;
      drop(service);

      self.activate()?;

      let mut sysopt = self.sysopt.lock();
      sysopt.init_sysproxy()?;
    }

    if has_mode {
      let handle = self.handle.lock();
      handle.update_systray_part()?;
    }

    Ok(())
  }

  /// Patch Verge
  pub fn patch_verge(&self, patch: Verge) -> Result<()> {
    // save the patch
    let global = Data::global();
    let mut verge = global.verge.lock();
    verge.patch_config(patch.clone())?;
    drop(verge);

    let tun_mode = patch.enable_tun_mode;
    let auto_launch = patch.enable_auto_launch;
    let system_proxy = patch.enable_system_proxy;
    let proxy_bypass = patch.system_proxy_bypass;
    let proxy_guard = patch.enable_proxy_guard;
    let language = patch.language;

    #[cfg(target_os = "windows")]
    {
      let service_mode = patch.enable_service_mode;

      // 重启服务
      if service_mode.is_some() {
        let mut service = self.service.lock();
        service.restart()?;
        drop(service);
      }

      if tun_mode.is_some() && *tun_mode.as_ref().unwrap_or(&false) {
        let wintun_dll = crate::utils::dirs::app_home_dir().join("wintun.dll");
        if !wintun_dll.exists() {
          bail!("failed to enable TUN for missing `wintun.dll`");
        }
      }

      if service_mode.is_some() || tun_mode.is_some() {
        self.activate()?;
      }
    }

    #[cfg(not(target_os = "windows"))]
    if tun_mode.is_some() {
      self.activate()?;
    }

    let mut sysopt = self.sysopt.lock();

    if auto_launch.is_some() {
      sysopt.update_launch()?;
    }
    if system_proxy.is_some() || proxy_bypass.is_some() {
      sysopt.update_sysproxy()?;
      sysopt.guard_proxy();
    }
    if proxy_guard.unwrap_or(false) {
      sysopt.guard_proxy();
    }

    // 更新tray
    if language.is_some() {
      let handle = self.handle.lock();
      handle.update_systray()?;
    } else if system_proxy.is_some() || tun_mode.is_some() {
      let handle = self.handle.lock();
      handle.update_systray_part()?;
    }

    if patch.hotkeys.is_some() {
      let mut hotkey = self.hotkey.lock();
      hotkey.update(patch.hotkeys.unwrap())?;
    }

    Ok(())
  }

  // update rule/global/direct/script mode
  pub fn update_mode(&self, mode: &str) -> Result<()> {
    // save config to file
    let info = {
      let global = Data::global();
      let mut clash = global.clash.lock();
      clash.config.insert(Value::from("mode"), Value::from(mode));
      clash.save_config()?;
      clash.info.clone()
    };

    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), Value::from(mode));

    let handle = self.handle.clone();

    tauri::async_runtime::spawn(async move {
      log_if_err!(Service::patch_config(info, mapping.to_owned()).await);

      // update tray
      let handle = handle.lock();
      handle.refresh_clash();
      log_if_err!(handle.update_systray_part());
    });

    Ok(())
  }

  /// activate the profile
  /// auto activate enhanced profile
  /// 触发clash配置更新
  pub fn activate(&self) -> Result<()> {
    let global = Data::global();

    let verge = global.verge.lock();
    let clash = global.clash.lock();
    let profiles = global.profiles.lock();

    let tun_mode = verge.enable_tun_mode.clone().unwrap_or(false);
    let profile_activate = profiles.gen_activate()?;

    let clash_config = clash.config.clone();
    let clash_info = clash.info.clone();

    drop(clash);
    drop(verge);
    drop(profiles);

    let (config, exists_keys, logs) = enhance_config(
      clash_config,
      profile_activate.current,
      profile_activate.chain,
      profile_activate.valid,
      tun_mode,
    );

    let mut runtime = self.runtime.lock();
    *runtime = RuntimeResult {
      config: Some(config.clone()),
      config_yaml: Some(serde_yaml::to_string(&config).unwrap_or("".into())),
      exists_keys,
      chain_logs: logs,
    };
    drop(runtime);

    let mut service = self.service.lock();
    service.check_start()?;
    drop(service);

    let handle = self.handle.clone();
    tauri::async_runtime::spawn(async move {
      match Service::set_config(clash_info, config).await {
        Ok(_) => {
          let handle = handle.lock();
          handle.refresh_clash();
          handle.notice_message("set_config::ok".into(), "ok".into());
        }
        Err(err) => {
          let handle = handle.lock();
          handle.notice_message("set_config::error".into(), format!("{err}"));
          log::error!(target: "app", "last {err}")
        }
      }
    });

    Ok(())
  }

  /// Static function
  /// update profile item
  pub async fn update_profile_item(&self, uid: String, option: Option<PrfOption>) -> Result<()> {
    let global = Data::global();

    let (url, opt) = {
      let profiles = global.profiles.lock();
      let item = profiles.get_item(&uid)?;

      if let Some(typ) = item.itype.as_ref() {
        // maybe only valid for `local` profile
        if *typ != "remote" {
          // reactivate the config
          if Some(uid) == profiles.get_current() {
            drop(profiles);
            self.activate()?;
          }
          return Ok(());
        }
      }
      if item.url.is_none() {
        bail!("failed to get the profile item url");
      }
      (item.url.clone().unwrap(), item.option.clone())
    };

    let merged_opt = PrfOption::merge(opt, option);
    let item = PrfItem::from_url(&url, None, None, merged_opt).await?;

    let mut profiles = global.profiles.lock();
    profiles.update_item(uid.clone(), item)?;

    // reactivate the profile
    if Some(uid) == profiles.get_current() {
      drop(profiles);
      self.activate()?;
    }

    Ok(())
  }
}
