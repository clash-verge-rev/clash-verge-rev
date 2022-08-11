use super::prfitem::PrfItem;
use super::ChainItem;
use crate::utils::{config, dirs, help};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::collections::HashMap;
use std::{fs, io::Write};

///
/// ## Profiles Config
///
/// Define the `profiles.yaml` schema
///
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct Profiles {
  /// same as PrfConfig.current
  current: Option<String>,

  /// same as PrfConfig.chain
  chain: Option<Vec<String>>,

  /// record valid fields for clash
  valid: Option<Vec<String>>,

  /// profile list
  items: Option<Vec<PrfItem>>,
}

macro_rules! patch {
  ($lv: expr, $rv: expr, $key: tt) => {
    if ($rv.$key).is_some() {
      $lv.$key = $rv.$key;
    }
  };
}

impl Profiles {
  pub fn new() -> Self {
    Profiles::read_file()
  }

  /// read the config from the file
  pub fn read_file() -> Self {
    let mut profiles = config::read_yaml::<Self>(dirs::profiles_path());

    if profiles.items.is_none() {
      profiles.items = Some(vec![]);
    }

    // compatiable with the old old old version
    profiles.items.as_mut().map(|items| {
      for mut item in items.iter_mut() {
        if item.uid.is_none() {
          item.uid = Some(help::get_uid("d"));
        }
      }
    });

    profiles
  }

  /// save the config to the file
  pub fn save_file(&self) -> Result<()> {
    config::save_yaml(
      dirs::profiles_path(),
      self,
      Some("# Profiles Config for Clash Verge\n\n"),
    )
  }

  /// get the current uid
  pub fn get_current(&self) -> Option<String> {
    self.current.clone()
  }

  /// only change the main to the target id
  pub fn put_current(&mut self, uid: String) -> Result<()> {
    if self.items.is_none() {
      self.items = Some(vec![]);
    }

    let items = self.items.as_ref().unwrap();
    let some_uid = Some(uid.clone());

    if items.iter().find(|&each| each.uid == some_uid).is_some() {
      self.current = some_uid;
      return self.save_file();
    }

    bail!("invalid uid \"{uid}\"");
  }

  /// just change the `chain`
  pub fn put_chain(&mut self, chain: Option<Vec<String>>) -> Result<()> {
    self.chain = chain;
    self.save_file()
  }

  /// just change the `field`
  pub fn put_valid(&mut self, valid: Option<Vec<String>>) -> Result<()> {
    self.valid = valid;
    self.save_file()
  }

  /// get items ref
  pub fn get_items(&self) -> Option<&Vec<PrfItem>> {
    self.items.as_ref()
  }

  /// find the item by the uid
  pub fn get_item(&self, uid: &String) -> Result<&PrfItem> {
    if self.items.is_some() {
      let items = self.items.as_ref().unwrap();
      let some_uid = Some(uid.clone());

      for each in items.iter() {
        if each.uid == some_uid {
          return Ok(each);
        }
      }
    }

    bail!("failed to get the item by \"{}\"", uid);
  }

  /// append new item
  /// if the file_data is some
  /// then should save the data to file
  pub fn append_item(&mut self, mut item: PrfItem) -> Result<()> {
    if item.uid.is_none() {
      bail!("the uid should not be null");
    }

    // save the file data
    // move the field value after save
    if let Some(file_data) = item.file_data.take() {
      if item.file.is_none() {
        bail!("the file should not be null");
      }

      let file = item.file.clone().unwrap();
      let path = dirs::app_profiles_dir().join(&file);

      fs::File::create(path)
        .context(format!("failed to create file \"{}\"", file))?
        .write(file_data.as_bytes())
        .context(format!("failed to write to file \"{}\"", file))?;
    }

    if self.items.is_none() {
      self.items = Some(vec![]);
    }

    self.items.as_mut().map(|items| items.push(item));
    self.save_file()
  }

  /// update the item value
  pub fn patch_item(&mut self, uid: String, item: PrfItem) -> Result<()> {
    let mut items = self.items.take().unwrap_or(vec![]);

    for mut each in items.iter_mut() {
      if each.uid == Some(uid.clone()) {
        patch!(each, item, itype);
        patch!(each, item, name);
        patch!(each, item, desc);
        patch!(each, item, file);
        patch!(each, item, url);
        patch!(each, item, selected);
        patch!(each, item, extra);
        patch!(each, item, updated);
        patch!(each, item, option);

        self.items = Some(items);
        return self.save_file();
      }
    }

    self.items = Some(items);
    bail!("failed to found the uid \"{uid}\"")
  }

  /// be used to update the remote item
  /// only patch `updated` `extra` `file_data`
  pub fn update_item(&mut self, uid: String, mut item: PrfItem) -> Result<()> {
    if self.items.is_none() {
      self.items = Some(vec![]);
    }

    // find the item
    let _ = self.get_item(&uid)?;

    if let Some(items) = self.items.as_mut() {
      let some_uid = Some(uid.clone());

      for mut each in items.iter_mut() {
        if each.uid == some_uid {
          each.extra = item.extra;
          each.updated = item.updated;

          // save the file data
          // move the field value after save
          if let Some(file_data) = item.file_data.take() {
            let file = each.file.take();
            let file = file.unwrap_or(item.file.take().unwrap_or(format!("{}.yaml", &uid)));

            // the file must exists
            each.file = Some(file.clone());

            let path = dirs::app_profiles_dir().join(&file);

            fs::File::create(path)
              .context(format!("failed to create file \"{}\"", file))?
              .write(file_data.as_bytes())
              .context(format!("failed to write to file \"{}\"", file))?;
          }

          break;
        }
      }
    }

    self.save_file()
  }

  /// delete item
  /// if delete the current then return true
  pub fn delete_item(&mut self, uid: String) -> Result<bool> {
    let current = self.current.as_ref().unwrap_or(&uid);
    let current = current.clone();

    let mut items = self.items.take().unwrap_or(vec![]);
    let mut index = None;

    // get the index
    for i in 0..items.len() {
      if items[i].uid == Some(uid.clone()) {
        index = Some(i);
        break;
      }
    }

    if let Some(index) = index {
      items.remove(index).file.map(|file| {
        let path = dirs::app_profiles_dir().join(file);
        if path.exists() {
          let _ = fs::remove_file(path);
        }
      });
    }

    // delete the original uid
    if current == uid {
      self.current = match items.len() > 0 {
        true => items[0].uid.clone(),
        false => None,
      };
    }

    self.items = Some(items);
    self.save_file()?;
    Ok(current == uid)
  }

  /// generate the current Mapping data
  fn gen_current(&self) -> Result<Mapping> {
    let config = Mapping::new();

    if self.current.is_none() || self.items.is_none() {
      return Ok(config);
    }

    let current = self.current.clone().unwrap();
    for item in self.items.as_ref().unwrap().iter() {
      if item.uid == Some(current.clone()) {
        let file_path = match item.file.clone() {
          Some(file) => dirs::app_profiles_dir().join(file),
          None => bail!("failed to get the file field"),
        };

        if !file_path.exists() {
          bail!("failed to read the file \"{}\"", file_path.display());
        }

        return Ok(config::read_yaml::<Mapping>(file_path.clone()));
      }
    }
    bail!("failed to found the uid \"{current}\"");
  }

  /// generate the data for activate clash config
  pub fn gen_activate(&self) -> Result<PrfActivate> {
    let current = self.gen_current()?;
    let chain = match self.chain.as_ref() {
      Some(chain) => chain
        .iter()
        .filter_map(|uid| self.get_item(uid).ok())
        .filter_map(|item| item.to_enhance())
        .collect::<Vec<ChainItem>>(),
      None => vec![],
    };
    let valid = self.valid.clone().unwrap_or(vec![]);

    Ok(PrfActivate {
      current,
      chain,
      valid,
    })
  }
}

#[derive(Default, Clone)]
pub struct PrfActivate {
  pub current: Mapping,
  pub chain: Vec<ChainItem>,
  pub valid: Vec<String>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct RuntimeResult {
  pub config: Option<Mapping>,
  pub config_yaml: Option<String>,
  // 记录在配置中（包括merge和script生成的）出现过的keys
  // 这些keys不一定都生效
  pub exists_keys: Vec<String>,
  pub chain_logs: HashMap<String, Vec<(String, String)>>,
}
