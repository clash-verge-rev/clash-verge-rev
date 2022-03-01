use crate::utils::{config, dirs, help, tmpl};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::{fs, io::Write};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrfItem {
  pub uid: Option<String>,

  /// profile item type
  /// enum value: remote | local | script | merge
  #[serde(rename = "type")]
  pub itype: Option<String>,

  /// profile name
  pub name: Option<String>,

  /// profile description
  #[serde(skip_serializing_if = "Option::is_none")]
  pub desc: Option<String>,

  /// profile file
  pub file: Option<String>,

  /// source url
  #[serde(skip_serializing_if = "Option::is_none")]
  pub url: Option<String>,

  /// selected infomation
  #[serde(skip_serializing_if = "Option::is_none")]
  pub selected: Option<Vec<PrfSelected>>,

  /// user info
  #[serde(skip_serializing_if = "Option::is_none")]
  pub extra: Option<PrfExtra>,

  /// updated time
  pub updated: Option<usize>,

  /// the file data
  #[serde(skip)]
  pub file_data: Option<String>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct PrfSelected {
  pub name: Option<String>,
  pub now: Option<String>,
}

#[derive(Default, Debug, Clone, Copy, Deserialize, Serialize)]
pub struct PrfExtra {
  pub upload: usize,
  pub download: usize,
  pub total: usize,
  pub expire: usize,
}

impl Default for PrfItem {
  fn default() -> Self {
    PrfItem {
      uid: None,
      itype: None,
      name: None,
      desc: None,
      file: None,
      url: None,
      selected: None,
      extra: None,
      updated: None,
      file_data: None,
    }
  }
}

impl PrfItem {
  /// ## Local type
  /// create a new item from name/desc
  pub fn from_local(name: String, desc: String) -> Result<PrfItem> {
    let uid = help::get_uid("l");
    let file = format!("{uid}.yaml");

    Ok(PrfItem {
      uid: Some(uid),
      itype: Some("local".into()),
      name: Some(name),
      desc: Some(desc),
      file: Some(file),
      url: None,
      selected: None,
      extra: None,
      updated: Some(help::get_now()),
      file_data: Some(tmpl::ITEM_CONFIG.into()),
    })
  }

  /// ## Remote type
  /// create a new item from url
  pub async fn from_url(url: &str, with_proxy: bool) -> Result<PrfItem> {
    let mut builder = reqwest::ClientBuilder::new();

    if !with_proxy {
      builder = builder.no_proxy();
    }

    let resp = builder.build()?.get(url).send().await?;
    let header = resp.headers();

    // parse the Subscription Userinfo
    let extra = match header.get("Subscription-Userinfo") {
      Some(value) => {
        let sub_info = value.to_str().unwrap_or("");

        Some(PrfExtra {
          upload: help::parse_str(sub_info, "upload=").unwrap_or(0),
          download: help::parse_str(sub_info, "download=").unwrap_or(0),
          total: help::parse_str(sub_info, "total=").unwrap_or(0),
          expire: help::parse_str(sub_info, "expire=").unwrap_or(0),
        })
      }
      None => None,
    };

    let uid = help::get_uid("r");
    let file = format!("{uid}.yaml");
    let name = uid.clone();
    let data = resp.text_with_charset("utf-8").await?;

    Ok(PrfItem {
      uid: Some(uid),
      itype: Some("remote".into()),
      name: Some(name),
      desc: None,
      file: Some(file),
      url: Some(url.into()),
      selected: None,
      extra,
      updated: Some(help::get_now()),
      file_data: Some(data),
    })
  }
}

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
  /// read the config from the file
  pub fn read_file() -> Self {
    let mut profiles = config::read_yaml::<Self>(dirs::profiles_path());

    if profiles.items.is_none() {
      profiles.items = Some(vec![]);
    }

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

  /// sync the config between file and memory
  pub fn sync_file(&mut self) -> Result<()> {
    let data = Self::read_file();
    if data.current.is_none() && data.items.is_none() {
      bail!("failed to read profiles.yaml");
    }

    self.current = data.current;
    self.chain = data.chain;
    self.items = data.items;
    Ok(())
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

    for each in items.iter() {
      if each.uid == some_uid {
        self.current = some_uid;
        return self.save_file();
      }
    }

    bail!("invalid uid \"{uid}\"");
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

  /// update the item's value
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

        each.updated = Some(help::get_now());

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

    self.items.as_mut().map(|items| {
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
              .unwrap()
              .write(file_data.as_bytes())
              .unwrap();
          }

          break;
        }
      }
    });

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

  /// only generate config mapping
  pub fn gen_activate(&self) -> Result<Mapping> {
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

        let mut new_config = Mapping::new();
        let def_config = config::read_yaml::<Mapping>(file_path.clone());

        // Only the following fields are allowed:
        // proxies/proxy-providers/proxy-groups/rule-providers/rules
        let valid_keys = vec![
          "proxies",
          "proxy-providers",
          "proxy-groups",
          "rule-providers",
          "rules",
        ];

        valid_keys.iter().for_each(|key| {
          let key = Value::String(key.to_string());
          if def_config.contains_key(&key) {
            let value = def_config[&key].clone();
            new_config.insert(key, value);
          }
        });

        return Ok(new_config);
      }
    }

    bail!("failed to found the uid \"{current}\"");
  }
}
