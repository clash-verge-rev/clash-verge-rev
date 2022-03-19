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

  /// subscription user info
  #[serde(skip_serializing_if = "Option::is_none")]
  pub extra: Option<PrfExtra>,

  /// updated time
  pub updated: Option<usize>,

  /// some options of the item
  #[serde(skip_serializing_if = "Option::is_none")]
  pub option: Option<PrfOption>,

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

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct PrfOption {
  /// for `remote` profile's http request
  /// see issue #13
  #[serde(skip_serializing_if = "Option::is_none")]
  pub user_agent: Option<String>,

  /// for `remote` profile
  #[serde(skip_serializing_if = "Option::is_none")]
  pub with_proxy: Option<bool>,
}

impl PrfOption {
  pub fn merge(one: Option<Self>, other: Option<Self>) -> Option<Self> {
    if one.is_some() && other.is_some() {
      let mut one = one.unwrap();
      let other = other.unwrap();

      if let Some(val) = other.user_agent {
        one.user_agent = Some(val);
      }

      if let Some(val) = other.with_proxy {
        one.with_proxy = Some(val);
      }

      return Some(one);
    }

    if one.is_none() {
      return other;
    }

    return one;
  }
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
      option: None,
      file_data: None,
    }
  }
}

impl PrfItem {
  /// From partial item
  /// must contain `itype`
  pub async fn from(item: PrfItem, file_data: Option<String>) -> Result<PrfItem> {
    if item.itype.is_none() {
      bail!("type should not be null");
    }

    match item.itype.unwrap().as_str() {
      "remote" => {
        if item.url.is_none() {
          bail!("url should not be null");
        }
        let url = item.url.as_ref().unwrap().as_str();
        let name = item.name;
        let desc = item.desc;
        PrfItem::from_url(url, name, desc, item.option).await
      }
      "local" => {
        let name = item.name.unwrap_or("Local File".into());
        let desc = item.desc.unwrap_or("".into());
        PrfItem::from_local(name, desc, file_data)
      }
      "merge" => {
        let name = item.name.unwrap_or("Merge".into());
        let desc = item.desc.unwrap_or("".into());
        PrfItem::from_merge(name, desc)
      }
      "script" => {
        let name = item.name.unwrap_or("Script".into());
        let desc = item.desc.unwrap_or("".into());
        PrfItem::from_script(name, desc)
      }
      typ @ _ => bail!("invalid type \"{typ}\""),
    }
  }

  /// ## Local type
  /// create a new item from name/desc
  pub fn from_local(name: String, desc: String, file_data: Option<String>) -> Result<PrfItem> {
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
      option: None,
      updated: Some(help::get_now()),
      file_data: Some(file_data.unwrap_or(tmpl::ITEM_LOCAL.into())),
    })
  }

  /// ## Remote type
  /// create a new item from url
  pub async fn from_url(
    url: &str,
    name: Option<String>,
    desc: Option<String>,
    option: Option<PrfOption>,
  ) -> Result<PrfItem> {
    let with_proxy = match option.as_ref() {
      Some(opt) => opt.with_proxy.unwrap_or(false),
      None => false,
    };
    let user_agent = match option.as_ref() {
      Some(opt) => opt.user_agent.clone(),
      None => None,
    };

    let mut builder = reqwest::ClientBuilder::new();

    if !with_proxy {
      builder = builder.no_proxy();
    }
    if let Some(user_agent) = user_agent {
      builder = builder.user_agent(user_agent);
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
    let name = name.unwrap_or(uid.clone());
    let data = resp.text_with_charset("utf-8").await?;

    Ok(PrfItem {
      uid: Some(uid),
      itype: Some("remote".into()),
      name: Some(name),
      desc,
      file: Some(file),
      url: Some(url.into()),
      selected: None,
      extra,
      option,
      updated: Some(help::get_now()),
      file_data: Some(data),
    })
  }

  /// ## Merge type (enhance)
  /// create the enhanced item by using `merge` rule
  pub fn from_merge(name: String, desc: String) -> Result<PrfItem> {
    let uid = help::get_uid("m");
    let file = format!("{uid}.yaml");

    Ok(PrfItem {
      uid: Some(uid),
      itype: Some("merge".into()),
      name: Some(name),
      desc: Some(desc),
      file: Some(file),
      url: None,
      selected: None,
      extra: None,
      option: None,
      updated: Some(help::get_now()),
      file_data: Some(tmpl::ITEM_MERGE.into()),
    })
  }

  /// ## Script type (enhance)
  /// create the enhanced item by using javascript(browserjs)
  pub fn from_script(name: String, desc: String) -> Result<PrfItem> {
    let uid = help::get_uid("s");
    let file = format!("{uid}.js"); // js ext

    Ok(PrfItem {
      uid: Some(uid),
      itype: Some("script".into()),
      name: Some(name),
      desc: Some(desc),
      file: Some(file),
      url: None,
      selected: None,
      extra: None,
      option: None,
      updated: Some(help::get_now()),
      file_data: Some(tmpl::ITEM_SCRIPT.into()),
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

  /// just change the `chain`
  pub fn put_chain(&mut self, chain: Option<Vec<String>>) {
    self.chain = chain;
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

        for (key, value) in def_config.into_iter() {
          key.as_str().map(|key_str| {
            // change to lowercase
            let mut key_str = String::from(key_str);
            key_str.make_ascii_lowercase();

            if valid_keys.contains(&&*key_str) {
              new_config.insert(Value::String(key_str), value);
            }
          });
        }

        return Ok(new_config);
      }
    }

    bail!("failed to found the uid \"{current}\"");
  }

  /// gen the enhanced profiles
  pub fn gen_enhanced(&self, callback: String) -> Result<PrfEnhanced> {
    let current = self.gen_activate()?;

    let chain = match self.chain.as_ref() {
      Some(chain) => chain
        .iter()
        .map(|uid| self.get_item(uid))
        .filter(|item| item.is_ok())
        .map(|item| item.unwrap())
        .map(|item| PrfData::from_item(item))
        .filter(|o| o.is_some())
        .map(|o| o.unwrap())
        .collect::<Vec<PrfData>>(),
      None => vec![],
    };

    Ok(PrfEnhanced {
      current,
      chain,
      callback,
    })
  }
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct PrfEnhanced {
  current: Mapping,

  chain: Vec<PrfData>,

  callback: String,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct PrfEnhancedResult {
  pub data: Option<Mapping>,

  pub status: String,

  pub error: Option<String>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct PrfData {
  item: PrfItem,

  #[serde(skip_serializing_if = "Option::is_none")]
  merge: Option<Mapping>,

  #[serde(skip_serializing_if = "Option::is_none")]
  script: Option<String>,
}

impl PrfData {
  pub fn from_item(item: &PrfItem) -> Option<PrfData> {
    match item.itype.as_ref() {
      Some(itype) => {
        let file = item.file.clone()?;
        let path = dirs::app_profiles_dir().join(file);

        if !path.exists() {
          return None;
        }

        match itype.as_str() {
          "script" => Some(PrfData {
            item: item.clone(),
            script: Some(fs::read_to_string(path).unwrap_or("".into())),
            merge: None,
          }),
          "merge" => Some(PrfData {
            item: item.clone(),
            merge: Some(config::read_yaml::<Mapping>(path)),
            script: None,
          }),
          _ => None,
        }
      }
      None => None,
    }
  }
}
