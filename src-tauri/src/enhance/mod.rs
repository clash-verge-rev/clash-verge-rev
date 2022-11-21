mod chain;
mod field;
mod merge;
mod script;
mod tun;

use self::chain::*;
pub(self) use self::field::*;
use self::merge::*;
use self::script::*;
use self::tun::*;
use crate::config::Config;
use serde_yaml::Mapping;
use std::collections::HashMap;
use std::collections::HashSet;

type ResultLog = Vec<(String, String)>;

/// Enhance mode
/// 返回最终配置、该配置包含的键、和script执行的结果
pub fn enhance() -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
    let clash_config = { Config::clash().latest().0.clone() };

    let (tun_mode, enable_builtin) = {
        let verge = Config::verge();
        let verge = verge.latest();
        (
            verge.enable_tun_mode.clone(),
            verge.enable_builtin_enhanced.clone(),
        )
    };

    let tun_mode = tun_mode.unwrap_or(false);
    let enable_builtin = enable_builtin.unwrap_or(true);

    let (mut config, mut chain, valid) = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();

        let current = profiles.current_mapping().unwrap_or(Mapping::new());

        let chain = match profiles.chain.as_ref() {
            Some(chain) => chain
                .iter()
                .filter_map(|uid| profiles.get_item(uid).ok())
                .filter_map(|item| <Option<ChainItem>>::from(item))
                .collect::<Vec<ChainItem>>(),
            None => vec![],
        };

        let valid = profiles.valid.clone().unwrap_or(vec![]);

        (current, chain, valid)
    };

    let mut result_map = HashMap::new();
    let mut exists_keys = use_keys(&config);

    let valid = use_valid_fields(valid);

    if enable_builtin {
        chain.extend(ChainItem::builtin().into_iter());
    }

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
