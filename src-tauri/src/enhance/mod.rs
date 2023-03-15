mod chain;
mod field;
mod merge;
mod script;
mod tun;

pub(self) use self::field::*;

use self::chain::*;
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
    // config.yaml 的配置
    let clash_config = { Config::clash().latest().0.clone() };

    let (clash_core, enable_tun, enable_builtin, enable_filter) = {
        let verge = Config::verge();
        let verge = verge.latest();
        (
            verge.clash_core.clone(),
            verge.enable_tun_mode.clone().unwrap_or(false),
            verge.enable_builtin_enhanced.clone().unwrap_or(true),
            verge.enable_clash_fields.clone().unwrap_or(true),
        )
    };

    // 从profiles里拿东西
    let (mut config, chain, valid) = {
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

    let mut result_map = HashMap::new(); // 保存脚本日志
    let mut exists_keys = use_keys(&config); // 保存出现过的keys

    let valid = use_valid_fields(valid);
    config = use_filter(config, &valid, enable_filter);

    // 处理用户的profile
    chain.into_iter().for_each(|item| match item.data {
        ChainType::Merge(merge) => {
            exists_keys.extend(use_keys(&merge));
            config = use_merge(merge, config.to_owned());
            config = use_filter(config.to_owned(), &valid, enable_filter);
        }
        ChainType::Script(script) => {
            let mut logs = vec![];

            match use_script(script, config.to_owned()) {
                Ok((res_config, res_logs)) => {
                    exists_keys.extend(use_keys(&res_config));
                    config = use_filter(res_config, &valid, enable_filter);
                    logs.extend(res_logs);
                }
                Err(err) => logs.push(("exception".into(), err.to_string())),
            }

            result_map.insert(item.uid, logs);
        }
    });

    // 合并默认的config
    for (key, value) in clash_config.into_iter() {
        config.insert(key, value);
    }

    let clash_fields = use_clash_fields();

    // 内建脚本最后跑
    if enable_builtin {
        ChainItem::builtin()
            .into_iter()
            .filter(|(s, _)| s.is_support(clash_core.as_ref()))
            .map(|(_, c)| c)
            .for_each(|item| {
                log::debug!(target: "app", "run builtin script {}", item.uid);

                match item.data {
                    ChainType::Script(script) => match use_script(script, config.to_owned()) {
                        Ok((res_config, _)) => {
                            config = use_filter(res_config, &clash_fields, enable_filter);
                        }
                        Err(err) => {
                            log::error!(target: "app", "builtin script error `{err}`");
                        }
                    },
                    _ => {}
                }
            });
    }

    config = use_filter(config, &clash_fields, enable_filter);
    config = use_tun(config, enable_tun);
    config = use_sort(config, enable_filter);

    let mut exists_set = HashSet::new();
    exists_set.extend(exists_keys.into_iter().filter(|s| clash_fields.contains(s)));
    exists_keys = exists_set.into_iter().collect();

    (config, exists_keys, result_map)
}
