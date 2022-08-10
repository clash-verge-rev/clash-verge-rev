mod field;
mod merge;
mod script;
mod tun;

pub(self) use self::field::*;
use self::merge::*;
use self::script::*;
use self::tun::*;
use crate::core::PrfData;
use serde_yaml::Mapping;
use std::collections::HashMap;

type ResultLog = Vec<(String, String)>;

pub fn runtime_config(
  clash_config: Mapping,
  profile_config: Mapping,
  profile_enhanced: Vec<PrfData>,
  valid: Vec<String>,
  tun_mode: bool,
) -> (Mapping, HashMap<String, ResultLog>) {
  let mut config = profile_config;
  let mut result_map = HashMap::new();

  profile_enhanced.into_iter().for_each(|data| {
    if data.merge.is_some() {
      config = use_merge(data.merge.unwrap(), config.to_owned(), valid.clone());
    } else if data.script.is_some() {
      let mut logs = vec![];

      match use_script(data.script.unwrap(), config.to_owned(), valid.clone()) {
        Ok((res_config, res_logs)) => {
          config = res_config;
          logs.extend(res_logs);
        }
        Err(err) => {
          logs.push(("error".into(), err.to_string()));
        }
      }

      if let Some(uid) = data.item.uid {
        result_map.insert(uid, logs);
      }
    }
  });

  config = use_filter(config, use_valid_fields(valid));

  for (key, value) in clash_config.into_iter() {
    config.insert(key, value);
  }

  config = use_filter(config, use_clash_fields());
  config = use_tun(config, tun_mode);
  config = use_sort(config);

  (config, result_map)
}
