use super::prfitem::PrfItem;
use crate::utils::{config, dirs};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_yaml::{self, Mapping, Sequence, Value};
use std::fs;

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct PrfEnhanced {
  pub current: Mapping,

  pub chain: Vec<PrfData>,

  pub valid: Vec<String>,

  pub callback: String,
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

fn get_valid_list(valid: Vec<String>) -> Vec<String> {
  let mut valid_list: Vec<String> = vec![
    "rules",
    "proxies",
    "proxy-groups",
    "proxy-providers",
    "rule-providers",
  ]
  .iter()
  .map(|s| s.to_string())
  .collect();

  valid_list.extend(valid);
  valid_list
}

fn use_valid_filter(config: Mapping, valid: Vec<String>) -> Mapping {
  let valid = get_valid_list(valid);
  let mut new_config = Mapping::new();

  valid.iter().for_each(|k| {
    let k = Value::from(k.clone());
    if let Some(value) = config.get(&k) {
      new_config.insert(k, value.clone());
    }
  });
  new_config
}

pub fn use_merge(merge: Mapping, config: Mapping, valid: Vec<String>) -> Mapping {
  let valid_list = get_valid_list(valid);
  let mut config = config;

  valid_list.iter().for_each(|key| {
    let key = Value::String(key.into());
    if let Some(value) = merge.get(&key) {
      config.insert(key, value.clone());
    }
  });

  vec!["rules", "proxies", "proxy-groups"]
    .iter()
    .for_each(|key_str| {
      let key_val = Value::from(key_str.to_string());

      let mut list = Sequence::default();
      list = config.get(&key_val).map_or(list.clone(), |val| {
        val.as_sequence().map_or(list, |v| v.clone())
      });

      let pre_key = Value::from(format!("prepend-{key_str}"));
      let post_key = Value::from(format!("append-{key_str}"));

      if let Some(pre_val) = merge.get(&pre_key) {
        if pre_val.is_sequence() {
          let mut pre_val = pre_val.as_sequence().unwrap().clone();
          pre_val.extend(list);
          list = pre_val;
        }
      }

      if let Some(post_val) = merge.get(&post_key) {
        if post_val.is_sequence() {
          list.extend(post_val.as_sequence().unwrap().clone());
        }
      }

      config.insert(key_val, Value::from(list));
    });

  config
}

pub fn use_script(
  script: String,
  config: Mapping,
  valid: Vec<String>,
) -> Result<(Mapping, Vec<(String, String)>)> {
  use quick_js::{Context, JsValue};
  use std::sync::{Arc, Mutex};

  let context = Context::new().unwrap();
  let outputs = Arc::new(Mutex::new(vec![]));

  let copy_outputs = outputs.clone();
  context.add_callback("__verge__log__", move |level: String, data: String| {
    let mut out = copy_outputs.lock().unwrap();
    out.push((level, data));
    JsValue::Undefined
  })?;

  context.eval(
    r#"var console = Object.freeze({
      log(data){__verge__log__("log",JSON.stringify(data))}, 
      info(data){__verge__log__("info",JSON.stringify(data))}, 
      error(data){__verge__log__("error",JSON.stringify(data))},
    });"#,
  )?;

  let config_str = serde_json::to_string(&config)?;

  let code = format!("\n{script}\n;\nJSON.stringify(main({config_str}))");
  let result = context.eval(code.as_str())?;

  let mut out = outputs.lock().unwrap();
  match result.into_string() {
    Some(result) => match serde_json::from_str::<Mapping>(result.as_str()) {
      Ok(config) => {
        let config = use_valid_filter(config, valid);
        Ok((config, out.to_vec()))
      }
      Err(_) => {
        out.push(("error".into(), "failed to parse json string".into()));
        Ok((config, out.to_vec()))
      }
    },
    None => {
      out.push(("error".into(), "main function should return object".into()));
      Ok((config, out.to_vec()))
    }
  }
}

#[test]
fn test_merge() -> Result<()> {
  let merge = r"
    prepend-rules:
      - prepend
      - 1123123
    append-rules:
      - append
    prepend-proxies:
      - 9999
    append-proxies:
      - 1111
    rules:
      - replace
    proxy-groups: 
      - 123781923810
    tun:
      enable: true
    dns:
      enable: true
  ";

  let config = r"
    rules:
      - aaaaa
    script: test
  ";

  let merge = serde_yaml::from_str::<Mapping>(merge)?;
  let config = serde_yaml::from_str::<Mapping>(config)?;

  let result = serde_yaml::to_string(&use_merge(
    merge,
    config,
    vec!["tun"].iter().map(|s| s.to_string()).collect(),
  ))?;

  println!("{result}");

  Ok(())
}

#[test]
fn test_script() {
  let script = r#"
    function main(config) {
      config.rules = [...config.rules, "add"];
      config.proxies = ["111"];
      console.log(config);
      return config;
    }
  "#;

  let config = r#"
    rules:
      - 111
      - 222
    tun:
      enable: false
    dns:
      enable: false
  "#;

  let config = serde_yaml::from_str(config).unwrap();
  let (config, results) = use_script(
    script.into(),
    config,
    vec!["tun"].iter().map(|s| s.to_string()).collect(),
  )
  .unwrap();

  let config_str = serde_yaml::to_string(&config).unwrap();

  println!("{config_str}");

  dbg!(results);
}
