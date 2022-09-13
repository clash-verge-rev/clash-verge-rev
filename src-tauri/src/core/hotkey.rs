use crate::{data::*, feat, log_if_err};
use anyhow::{bail, Result};
use std::collections::HashMap;
use tauri_hotkey::{parse_hotkey, HotkeyManager};

pub struct Hotkey {
  manager: HotkeyManager,
}

impl Hotkey {
  pub fn new() -> Hotkey {
    Hotkey {
      manager: HotkeyManager::new(),
    }
  }

  pub fn init(&mut self) -> Result<()> {
    let data = Data::global();
    let verge = data.verge.lock();

    if let Some(hotkeys) = verge.hotkeys.as_ref() {
      for hotkey in hotkeys.iter() {
        let mut iter = hotkey.split(',');
        let func = iter.next();
        let key = iter.next();

        if func.is_some() && key.is_some() {
          log_if_err!(self.register(func.unwrap(), key.unwrap()));
        } else {
          log::error!(target: "app", "invalid hotkey \"{}\":\"{}\"", func.unwrap_or("None"), key.unwrap_or("None"));
        }
      }
    }

    Ok(())
  }

  fn register(&mut self, func: &str, key: &str) -> Result<()> {
    let hotkey = parse_hotkey(key.trim())?;

    if self.manager.is_registered(&hotkey) {
      self.manager.unregister(&hotkey)?;
    }

    let f = match func.trim() {
      "clash_mode_rule" => || feat::change_clash_mode("rule"),
      "clash_mode_direct" => || feat::change_clash_mode("direct"),
      "clash_mode_global" => || feat::change_clash_mode("global"),
      "clash_moda_script" => || feat::change_clash_mode("script"),
      "toggle_system_proxy" => || feat::toggle_system_proxy(),
      "enable_system_proxy" => || feat::enable_system_proxy(),
      "disable_system_proxy" => || feat::disable_system_proxy(),
      "toggle_tun_mode" => || feat::toggle_tun_mode(),
      "enable_tun_mode" => || feat::enable_tun_mode(),
      "disable_tun_mode" => || feat::disable_tun_mode(),

      _ => bail!("invalid function \"{func}\""),
    };

    self.manager.register(hotkey, f)?;
    Ok(())
  }

  fn unregister(&mut self, key: &str) -> Result<()> {
    let hotkey = parse_hotkey(key.trim())?;
    self.manager.unregister(&hotkey)?;
    Ok(())
  }

  pub fn update(&mut self, new_hotkeys: Vec<String>) -> Result<()> {
    let data = Data::global();
    let mut verge = data.verge.lock();

    let default = Vec::new();
    let old_hotkeys = verge.hotkeys.as_ref().unwrap_or(&default);

    let old_map = Self::get_map_from_vec(old_hotkeys);
    let new_map = Self::get_map_from_vec(&new_hotkeys);

    for diff in Self::get_diff(old_map, new_map).iter() {
      match diff {
        Diff::Del(key) => {
          let _ = self.unregister(key);
        }
        Diff::Mod(key, func) => {
          let _ = self.unregister(key);
          log_if_err!(self.register(func, key));
        }
        Diff::Add(key, func) => {
          log_if_err!(self.register(func, key));
        }
      }
    }

    verge.patch_config(Verge {
      hotkeys: Some(new_hotkeys),
      ..Verge::default()
    })?;

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
  ) -> Vec<Diff<'a>> {
    let mut list = vec![];

    old_map
      .iter()
      .for_each(|(key, func)| match new_map.get(key) {
        Some(new_func) => {
          if new_func != func {
            list.push(Diff::Mod(key, new_func));
          }
        }
        None => list.push(Diff::Del(key)),
      });

    new_map.iter().for_each(|(key, func)| {
      if old_map.get(key).is_none() {
        list.push(Diff::Add(key, func));
      }
    });

    list
  }
}

impl Drop for Hotkey {
  fn drop(&mut self) {
    let _ = self.manager.unregister_all();
  }
}

enum Diff<'a> {
  Del(&'a str),          // key
  Add(&'a str, &'a str), // key, func
  Mod(&'a str, &'a str), // key, func
}
