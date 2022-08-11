mod field;
mod merge;
mod script;
mod tun;

pub(self) use self::field::*;
use self::merge::*;
use self::script::*;
use self::tun::*;
use crate::core::ChainItem;
use crate::core::ChainType;
use serde_yaml::Mapping;
use std::collections::HashMap;
use std::collections::HashSet;

type ResultLog = Vec<(String, String)>;

pub fn enhance_config(
  clash_config: Mapping,
  profile_config: Mapping,
  chain: Vec<ChainItem>,
  valid: Vec<String>,
  tun_mode: bool,
) -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
  let mut config = profile_config;
  let mut result_map = HashMap::new();
  let mut exists_keys = use_keys(&config);

  let valid = use_valid_fields(valid);

  chain.into_iter().for_each(|item| match item.data {
    ChainType::Merge(merge) => {
      exists_keys.extend(use_keys(&merge));
      config = use_merge(merge, config.to_owned());
      config = use_filter(config.to_owned(), &valid);
    }
    ChainType::Script(script) => {
      let mut logs = vec![];

      match use_script(script, config.to_owned()) {
        Ok((res_config, res_logs)) => {
          exists_keys.extend(use_keys(&res_config));
          config = use_filter(res_config, &valid);
          logs.extend(res_logs);
        }
        Err(err) => logs.push(("exception".into(), err.to_string())),
      }

      result_map.insert(item.uid, logs);
    }
  });

  config = use_filter(config, &valid);

  for (key, value) in clash_config.into_iter() {
    config.insert(key, value);
  }

  let clash_fields = use_clash_fields();
  config = use_filter(config, &clash_fields);
  config = use_tun(config, tun_mode);
  config = use_sort(config);

  let mut exists_set = HashSet::new();
  exists_set.extend(exists_keys.into_iter().filter(|s| clash_fields.contains(s)));
  exists_keys = exists_set.into_iter().collect();

  (config, exists_keys, result_map)
}
