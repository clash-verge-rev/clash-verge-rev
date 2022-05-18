use crate::utils::{dirs, help, tmpl};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::fs;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrfItem {
  pub uid: Option<String>,

  /// profile item type
  /// enum value: remote | local | script | merge
  #[serde(rename = "type")]
  pub itype: Option<String>,

  /// profile name
  pub name: Option<String>,

  /// profile file
  pub file: Option<String>,

  /// profile description
  #[serde(skip_serializing_if = "Option::is_none")]
  pub desc: Option<String>,

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

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PrfOption {
  /// for `remote` profile's http request
  /// see issue #13
  #[serde(skip_serializing_if = "Option::is_none")]
  pub user_agent: Option<String>,

  /// for `remote` profile
  #[serde(skip_serializing_if = "Option::is_none")]
  pub with_proxy: Option<bool>,

  #[serde(skip_serializing_if = "Option::is_none")]
  pub update_interval: Option<u64>,
}

impl PrfOption {
  pub fn merge(one: Option<Self>, other: Option<Self>) -> Option<Self> {
    if one.is_none() {
      return other;
    }

    if one.is_some() && other.is_some() {
      let mut one = one.unwrap();
      let other = other.unwrap();

      if let Some(val) = other.user_agent {
        one.user_agent = Some(val);
      }

      if let Some(val) = other.with_proxy {
        one.with_proxy = Some(val);
      }

      if let Some(val) = other.update_interval {
        one.update_interval = Some(val);
      }

      return Some(one);
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
      typ @ _ => bail!("invalid profile item type \"{typ}\""),
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

    builder = builder.user_agent(user_agent.unwrap_or("clash-verge/v1.0.0".into()));

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

    // parse the Content-Disposition
    let filename = match header.get("Content-Disposition") {
      Some(value) => {
        let filename = value.to_str().unwrap_or("");
        help::parse_str::<String>(filename, "filename=")
      }
      None => None,
    };

    // parse the profile-update-interval
    let option = match header.get("profile-update-interval") {
      Some(value) => match value.to_str().unwrap_or("").parse::<u64>() {
        Ok(val) => Some(PrfOption {
          update_interval: Some(val * 60), // hour -> min
          ..PrfOption::default()
        }),
        Err(_) => None,
      },
      None => None,
    };

    let uid = help::get_uid("r");
    let file = format!("{uid}.yaml");
    let name = name.unwrap_or(filename.unwrap_or("Remote File".into()));
    let data = resp.text_with_charset("utf-8").await?;

    // check the data whether the valid yaml format
    if !serde_yaml::from_str::<Mapping>(&data).is_ok() {
      bail!("the remote profile data is invalid yaml");
    }

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

  /// get the file data
  pub fn read_file(&self) -> Result<String> {
    if self.file.is_none() {
      bail!("could not find the file");
    }

    let file = self.file.clone().unwrap();
    let path = dirs::app_profiles_dir().join(file);
    fs::read_to_string(path).context("failed to read the file")
  }

  /// save the file data
  pub fn save_file(&self, data: String) -> Result<()> {
    if self.file.is_none() {
      bail!("could not find the file");
    }

    let file = self.file.clone().unwrap();
    let path = dirs::app_profiles_dir().join(file);
    fs::write(path, data.as_bytes()).context("failed to save the file")
  }
}
