//! Todos
//! refactor the profiles

use crate::utils::{config, dirs};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::{fs, str::FromStr};

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
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

type FileData = String;

impl PrfItem {
  pub fn gen_now() -> usize {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_secs() as _
  }

  /// generate the uid
  pub fn gen_uid(prefix: &str) -> String {
    let now = Self::gen_now();
    format!("{prefix}{now}")
  }

  /// parse the string
  fn parse_str<T: FromStr>(target: &str, key: &str) -> Option<T> {
    match target.find(key) {
      Some(idx) => {
        let idx = idx + key.len();
        let value = &target[idx..];
        match match value.split(';').nth(0) {
          Some(value) => value.trim().parse(),
          None => value.trim().parse(),
        } {
          Ok(r) => Some(r),
          Err(_) => None,
        }
      }
      None => None,
    }
  }

  pub async fn from_url(url: &str, with_proxy: bool) -> Result<(Self, FileData)> {
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
          upload: PrfItem::parse_str(sub_info, "upload=").unwrap_or(0),
          download: PrfItem::parse_str(sub_info, "download=").unwrap_or(0),
          total: PrfItem::parse_str(sub_info, "total=").unwrap_or(0),
          expire: PrfItem::parse_str(sub_info, "expire=").unwrap_or(0),
        })
      }
      None => None,
    };

    let uid = PrfItem::gen_uid("r");
    let file = format!("{uid}.yaml");
    let name = uid.clone();
    let data = resp.text_with_charset("utf-8").await?;

    let item = PrfItem {
      uid: Some(uid),
      itype: Some("remote".into()),
      name: Some(name),
      desc: None,
      file: Some(file),
      url: Some(url.into()),
      selected: None,
      extra,
      updated: Some(PrfItem::gen_now()),
    };

    Ok((item, data))
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

impl Profiles {
  pub fn new() -> Profiles {
    Profiles::read_file()
  }

  /// read the config from the file
  pub fn read_file() -> Self {
    config::read_yaml::<Self>(dirs::profiles_path())
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

    for each in items.iter() {
      if each.uid == some_uid {
        self.current = some_uid;
        return self.save_file();
      }
    }

    bail!("invalid uid \"{uid}\"");
  }

  /// append new item
  /// return the new item's uid
  pub fn append_item(&mut self, item: PrfItem) -> Result<()> {
    if item.uid.is_none() {
      bail!("the uid should not be null");
    }

    let mut items = self.items.take().unwrap_or(vec![]);
    items.push(item);
    self.items = Some(items);
    self.save_file()
  }

  /// update the item's value
  pub fn patch_item(&mut self, uid: String, item: PrfItem) -> Result<()> {
    let mut items = self.items.take().unwrap_or(vec![]);

    macro_rules! patch {
      ($lv: expr, $rv: expr, $key: tt) => {
        if ($rv.$key).is_some() {
          $lv.$key = $rv.$key;
        }
      };
    }

    for mut each in items.iter_mut() {
      if each.uid == Some(uid.clone()) {
        patch!(each, item, itype);
        patch!(each, item, name);
        patch!(each, item, desc);
        patch!(each, item, file);
        patch!(each, item, url);
        patch!(each, item, selected);
        patch!(each, item, extra);

        each.updated = Some(PrfItem::gen_now());

        self.items = Some(items);
        return self.save_file();
      }
    }

    self.items = Some(items);
    bail!("failed to found the uid \"{uid}\"")
  }

  /// delete item
  /// if delete the main then return true
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
    if self.current.is_none() {
      bail!("invalid main uid on profiles");
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
