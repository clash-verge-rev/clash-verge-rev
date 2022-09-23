use crate::{data::*, feat, log_if_err};
use anyhow::{bail, Result};
use std::collections::HashMap;
use tauri::{AppHandle, GlobalShortcutManager};

pub struct Hotkey {
  current: Vec<String>, // 保存当前的热键设置
  manager: Option<AppHandle>,
}

impl Hotkey {
  pub fn new() -> Hotkey {
    Hotkey {
      current: Vec::new(),
      manager: None,
    }
  }

  pub fn init(&mut self, app_handle: AppHandle) -> Result<()> {
    self.manager = Some(app_handle);
    let data = Data::global();
    let verge = data.verge.lock();

    if let Some(hotkeys) = verge.hotkeys.as_ref() {
      for hotkey in hotkeys.iter() {
        let mut iter = hotkey.split(',');
        let func = iter.next();
        let key = iter.next();

        if func.is_some() && key.is_some() {
          log_if_err!(self.register(key.unwrap(), func.unwrap()));
        } else {
          log::error!(target: "app", "invalid hotkey \"{}\":\"{}\"", key.unwrap_or("None"), func.unwrap_or("None"));
        }
      }
      self.current = hotkeys.clone();
    }

    Ok(())
  }

  fn get_manager(&self) -> Result<impl GlobalShortcutManager> {
    if self.manager.is_none() {
      bail!("failed to get hotkey manager");
    }
    Ok(self.manager.as_ref().unwrap().global_shortcut_manager())
  }

  fn register(&mut self, hotkey: &str, func: &str) -> Result<()> {
    let mut manager = self.get_manager()?;

    if manager.is_registered(hotkey)? {
      manager.unregister(hotkey)?;
    }

    let f = match func.trim() {
      "clash_mode_rule" => || feat::change_clash_mode("rule"),
      "clash_mode_global" => || feat::change_clash_mode("global"),
      "clash_mode_direct" => || feat::change_clash_mode("direct"),
      "clash_mode_script" => || feat::change_clash_mode("script"),
      "toggle_system_proxy" => || feat::toggle_system_proxy(),
      "enable_system_proxy" => || feat::enable_system_proxy(),
      "disable_system_proxy" => || feat::disable_system_proxy(),
      "toggle_tun_mode" => || feat::toggle_tun_mode(),
      "enable_tun_mode" => || feat::enable_tun_mode(),
      "disable_tun_mode" => || feat::disable_tun_mode(),

      _ => bail!("invalid function \"{func}\""),
    };

    manager.register(hotkey, f)?;
    log::info!(target: "app", "register hotkey {hotkey} {func}");
    Ok(())
  }

  fn unregister(&mut self, hotkey: &str) -> Result<()> {
    self.get_manager()?.unregister(&hotkey)?;
    log::info!(target: "app", "unregister hotkey {hotkey}");
    Ok(())
  }

  pub fn update(&mut self, new_hotkeys: Vec<String>) -> Result<()> {
    let current = self.current.to_owned();
    let old_map = Self::get_map_from_vec(&current);
    let new_map = Self::get_map_from_vec(&new_hotkeys);

    let (del, add) = Self::get_diff(old_map, new_map);

    del.iter().for_each(|key| {
      let _ = self.unregister(key);
    });

    add.iter().for_each(|(key, func)| {
      log_if_err!(self.register(key, func));
    });

    self.current = new_hotkeys;
    Ok(())
  }

  fn get_map_from_vec<'a>(hotkeys: &'a Vec<String>) -> HashMap<&'a str, &'a str> {
    let mut map = HashMap::new();

    hotkeys.iter().for_each(|hotkey| {
      let mut iter = hotkey.split(',');
      let func = iter.next();
      let key = iter.next();

      if func.is_some() && key.is_some() {
        let func = func.unwrap().trim();
        let key = key.unwrap().trim();
        map.insert(key, func);
      }
    });
    map
  }

  fn get_diff<'a>(
    old_map: HashMap<&'a str, &'a str>,
    new_map: HashMap<&'a str, &'a str>,
  ) -> (Vec<&'a str>, Vec<(&'a str, &'a str)>) {
    let mut del_list = vec![];
    let mut add_list = vec![];

    old_map.iter().for_each(|(&key, func)| {
      match new_map.get(key) {
        Some(new_func) => {
          if new_func != func {
            del_list.push(key);
            add_list.push((key, *new_func));
          }
        }
        None => del_list.push(key),
      };
    });

    new_map.iter().for_each(|(&key, &func)| {
      if old_map.get(key).is_none() {
        add_list.push((key, func));
      }
    });

    (del_list, add_list)
  }
}

impl Drop for Hotkey {
  fn drop(&mut self) {
    if let Ok(mut manager) = self.get_manager() {
      let _ = manager.unregister_all();
    }
  }
}
