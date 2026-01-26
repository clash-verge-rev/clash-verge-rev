use crate::{
    config::profiles,
    utils::{
        dirs, help,
        network::{NetworkManager, ProxyType},
        tmpl,
    },
};
use anyhow::{Context as _, Result, bail};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::time::Duration;
use tokio::fs;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
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

    /// selected information
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

    /// profile web page url
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,

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
    pub upload: u64,
    pub download: u64,
    pub total: u64,
    pub expire: u64,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PrfOption {
    /// for `remote` profile's http request
    /// see issue #13
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,

    /// for `remote` profile
    /// use system proxy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub with_proxy: Option<bool>,

    /// for `remote` profile
    /// use self proxy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_proxy: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_interval: Option<u64>,

    /// for `remote` profile
    /// HTTP request timeout in seconds
    /// default is 60 seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,

    /// for `remote` profile
    /// disable certificate validation
    /// default is `false`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danger_accept_invalid_certs: Option<bool>,

    #[serde(default = "default_allow_auto_update")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_auto_update: Option<bool>,

    pub merge: Option<String>,

    pub script: Option<String>,

    pub rules: Option<String>,

    pub proxies: Option<String>,

    pub groups: Option<String>,
}

impl PrfOption {
    pub fn merge(one: Option<&Self>, other: Option<&Self>) -> Option<Self> {
        match (one, other) {
            (Some(a_ref), Some(b_ref)) => {
                let mut result = a_ref.clone();
                result.user_agent = b_ref.user_agent.clone().or(result.user_agent);
                result.with_proxy = b_ref.with_proxy.or(result.with_proxy);
                result.self_proxy = b_ref.self_proxy.or(result.self_proxy);
                result.danger_accept_invalid_certs =
                    b_ref.danger_accept_invalid_certs.or(result.danger_accept_invalid_certs);
                result.allow_auto_update = b_ref.allow_auto_update.or(result.allow_auto_update);
                result.update_interval = b_ref.update_interval.or(result.update_interval);
                result.merge = b_ref.merge.clone().or(result.merge);
                result.script = b_ref.script.clone().or(result.script);
                result.rules = b_ref.rules.clone().or(result.rules);
                result.proxies = b_ref.proxies.clone().or(result.proxies);
                result.groups = b_ref.groups.clone().or(result.groups);
                result.timeout_seconds = b_ref.timeout_seconds.or(result.timeout_seconds);
                Some(result)
            }
            (Some(a_ref), None) => Some(a_ref.clone()),
            (None, Some(b_ref)) => Some(b_ref.clone()),
            (None, None) => None,
        }
    }
}

impl PrfItem {
    /// From partial item
    /// must contain `itype`
    pub async fn from(item: &Self, file_data: Option<String>) -> Result<Self> {
        if item.itype.is_none() {
            bail!("type should not be null");
        }

        let itype = item
            .itype
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("type should not be null"))?;
        match itype.as_str() {
            "remote" => {
                let url = item
                    .url
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("url should not be null"))?;
                let name = item.name.as_ref();
                let desc = item.desc.as_ref();
                let option = item.option.as_ref();
                Self::from_url(url, name, desc, option).await
            }
            "local" => {
                let name = item.name.clone().unwrap_or_else(|| "Local File".into());
                let desc = item.desc.clone().unwrap_or_else(|| "".into());
                let option = item.option.as_ref();
                Self::from_local(name, desc, file_data, option).await
            }
            typ => bail!("invalid profile item type \"{typ}\""),
        }
    }

    /// ## Local type
    /// create a new item from name/desc
    pub async fn from_local(
        name: String,
        desc: String,
        file_data: Option<String>,
        option: Option<&PrfOption>,
    ) -> Result<Self> {
        let uid = help::get_uid("L").into();
        let file = format!("{uid}.yaml").into();
        let opt_ref = option.as_ref();
        let update_interval = opt_ref.and_then(|o| o.update_interval);
        let mut merge = opt_ref.and_then(|o| o.merge.clone());
        let mut script = opt_ref.and_then(|o| o.script.clone());
        let mut rules = opt_ref.and_then(|o| o.rules.clone());
        let mut proxies = opt_ref.and_then(|o| o.proxies.clone());
        let mut groups = opt_ref.and_then(|o| o.groups.clone());

        if merge.is_none() {
            let merge_item = &mut Self::from_merge(None)?;
            profiles::profiles_append_item_safe(merge_item).await?;
            merge = merge_item.uid.clone();
        }
        if script.is_none() {
            let script_item = &mut Self::from_script(None)?;
            profiles::profiles_append_item_safe(script_item).await?;
            script = script_item.uid.clone();
        }
        if rules.is_none() {
            let rules_item = &mut Self::from_rules()?;
            profiles::profiles_append_item_safe(rules_item).await?;
            rules = rules_item.uid.clone();
        }
        if proxies.is_none() {
            let proxies_item = &mut Self::from_proxies()?;
            profiles::profiles_append_item_safe(proxies_item).await?;
            proxies = proxies_item.uid.clone();
        }
        if groups.is_none() {
            let groups_item = &mut Self::from_groups()?;
            profiles::profiles_append_item_safe(groups_item).await?;
            groups = groups_item.uid.clone();
        }
        Ok(Self {
            uid: Some(uid),
            itype: Some("local".into()),
            name: Some(name),
            desc: Some(desc),
            file: Some(file),
            url: None,
            selected: None,
            extra: None,
            option: Some(PrfOption {
                update_interval,
                merge,
                script,
                rules,
                proxies,
                groups,
                ..PrfOption::default()
            }),
            home: None,
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(file_data.unwrap_or_else(|| tmpl::ITEM_LOCAL.into())),
        })
    }

    /// ## Remote type
    /// create a new item from url
    pub async fn from_url(
        url: &str,
        name: Option<&String>,
        desc: Option<&String>,
        option: Option<&PrfOption>,
    ) -> Result<Self> {
        let with_proxy = option.is_some_and(|o| o.with_proxy.unwrap_or(false));
        let self_proxy = option.is_some_and(|o| o.self_proxy.unwrap_or(false));
        let accept_invalid_certs = option.is_some_and(|o| o.danger_accept_invalid_certs.unwrap_or(false));
        let allow_auto_update = option.map(|o| o.allow_auto_update.unwrap_or(true));
        let user_agent = option.and_then(|o| o.user_agent.clone());
        let update_interval = option.and_then(|o| o.update_interval);
        let timeout = option.and_then(|o| o.timeout_seconds).unwrap_or(20);
        let mut merge = option.and_then(|o| o.merge.clone());
        let mut script = option.and_then(|o| o.script.clone());
        let mut rules = option.and_then(|o| o.rules.clone());
        let mut proxies = option.and_then(|o| o.proxies.clone());
        let mut groups = option.and_then(|o| o.groups.clone());

        // 选择代理类型
        let proxy_type = if self_proxy {
            ProxyType::Localhost
        } else if with_proxy {
            ProxyType::System
        } else {
            ProxyType::None
        };

        // 使用网络管理器发送请求
        let resp = match NetworkManager::new()
            .get_with_interrupt(url, proxy_type, Some(timeout), user_agent.clone(), accept_invalid_certs)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
                bail!("failed to fetch remote profile: {}", e);
            }
        };

        let status_code = resp.status();
        if !status_code.is_success() {
            bail!("failed to fetch remote profile with status {status_code}")
        }

        let header = resp.headers();

        // parse the Subscription UserInfo
        let extra;
        'extra: {
            for (k, v) in header.iter() {
                let key_lower = k.as_str().to_ascii_lowercase();
                // Accept standard custom-metadata prefixes (x-amz-meta-, x-obs-meta-, x-cos-meta-, etc.).
                if key_lower
                    .strip_suffix("subscription-userinfo")
                    .is_some_and(|prefix| prefix.is_empty() || prefix.ends_with('-'))
                {
                    let sub_info = v.to_str().unwrap_or("");
                    extra = Some(PrfExtra {
                        upload: help::parse_str(sub_info, "upload").unwrap_or(0),
                        download: help::parse_str(sub_info, "download").unwrap_or(0),
                        total: help::parse_str(sub_info, "total").unwrap_or(0),
                        expire: help::parse_str(sub_info, "expire").unwrap_or(0),
                    });
                    break 'extra;
                }
            }
            extra = None;
        }

        // parse the Content-Disposition
        let filename = match header.get("Content-Disposition") {
            Some(value) => {
                let filename = format!("{value:?}");
                let filename = filename.trim_matches('"');
                match help::parse_str::<String>(filename, "filename*") {
                    Some(filename) => {
                        let iter = percent_encoding::percent_decode(filename.as_bytes());
                        let filename = iter.decode_utf8().unwrap_or_default();
                        filename.split("''").last().map(|s| s.into())
                    }
                    None => match help::parse_str::<String>(filename, "filename") {
                        Some(filename) => {
                            let filename = filename.trim_matches('"');
                            Some(filename.into())
                        }
                        None => None,
                    },
                }
            }
            None => Some(crate::utils::help::get_last_part_and_decode(url).unwrap_or_else(|| "Remote File".into())),
        };
        let update_interval = match update_interval {
            Some(val) => Some(val),
            None => match header.get("profile-update-interval") {
                Some(value) => match value.to_str().unwrap_or("").parse::<u64>() {
                    Ok(val) => Some(val * 60), // hour -> min
                    Err(_) => None,
                },
                None => None,
            },
        };

        let home = match header.get("profile-web-page-url") {
            Some(value) => {
                let str_value = value.to_str().unwrap_or("");
                Some(str_value.into())
            }
            None => None,
        };

        let uid = help::get_uid("R").into();
        let file = format!("{uid}.yaml").into();
        let name = name
            .map(|s| s.to_owned())
            .unwrap_or_else(|| filename.map(|s| s.into()).unwrap_or_else(|| "Remote File".into()));
        let data = resp.text_with_charset()?;

        // process the charset "UTF-8 with BOM"
        let data = data.trim_start_matches('\u{feff}');

        // check the data whether the valid yaml format
        let yaml = serde_yaml_ng::from_str::<Mapping>(data).context("the remote profile data is invalid yaml")?;

        if !yaml.contains_key("proxies") && !yaml.contains_key("proxy-providers") {
            bail!("profile does not contain `proxies` or `proxy-providers`");
        }

        if merge.is_none() {
            let merge_item = &mut Self::from_merge(None)?;
            profiles::profiles_append_item_safe(merge_item).await?;
            merge = merge_item.uid.clone();
        }
        if script.is_none() {
            let script_item = &mut Self::from_script(None)?;
            profiles::profiles_append_item_safe(script_item).await?;
            script = script_item.uid.clone();
        }
        if rules.is_none() {
            let rules_item = &mut Self::from_rules()?;
            profiles::profiles_append_item_safe(rules_item).await?;
            rules = rules_item.uid.clone();
        }
        if proxies.is_none() {
            let proxies_item = &mut Self::from_proxies()?;
            profiles::profiles_append_item_safe(proxies_item).await?;
            proxies = proxies_item.uid.clone();
        }
        if groups.is_none() {
            let groups_item = &mut Self::from_groups()?;
            profiles::profiles_append_item_safe(groups_item).await?;
            groups = groups_item.uid.clone();
        }

        Ok(Self {
            uid: Some(uid),
            itype: Some("remote".into()),
            name: Some(name),
            desc: desc.cloned(),
            file: Some(file),
            url: Some(url.into()),
            selected: None,
            extra,
            option: Some(PrfOption {
                update_interval,
                merge,
                script,
                rules,
                proxies,
                groups,
                allow_auto_update,
                ..PrfOption::default()
            }),
            home,
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(data.into()),
        })
    }

    /// ## Merge type (enhance)
    /// create the enhanced item by using `merge` rule
    pub fn from_merge(uid: Option<String>) -> Result<Self> {
        let (id, template) = if let Some(uid) = uid {
            (uid, tmpl::ITEM_MERGE.into())
        } else {
            (help::get_uid("m").into(), tmpl::ITEM_MERGE_EMPTY.into())
        };
        let file = format!("{id}.yaml").into();

        Ok(Self {
            uid: Some(id),
            itype: Some("merge".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(template),
            ..Default::default()
        })
    }

    /// ## Script type (enhance)
    /// create the enhanced item by using javascript quick.js
    pub fn from_script(uid: Option<String>) -> Result<Self> {
        let id = if let Some(uid) = uid {
            uid
        } else {
            help::get_uid("s").into()
        };
        let file = format!("{id}.js").into(); // js ext
        Ok(Self {
            uid: Some(id),
            itype: Some("script".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_SCRIPT.into()),
            ..Default::default()
        })
    }

    /// ## Rules type (enhance)
    pub fn from_rules() -> Result<Self> {
        let uid = help::get_uid("r").into();
        let file = format!("{uid}.yaml").into(); // yaml ext

        Ok(Self {
            uid: Some(uid),
            itype: Some("rules".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_RULES.into()),
            ..Default::default()
        })
    }

    /// ## Proxies type (enhance)
    pub fn from_proxies() -> Result<Self> {
        let uid = help::get_uid("p").into();
        let file = format!("{uid}.yaml").into(); // yaml ext

        Ok(Self {
            uid: Some(uid),
            itype: Some("proxies".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_PROXIES.into()),
            ..Default::default()
        })
    }

    /// ## Groups type (enhance)
    pub fn from_groups() -> Result<Self> {
        let uid = help::get_uid("g").into();
        let file = format!("{uid}.yaml").into(); // yaml ext

        Ok(Self {
            uid: Some(uid),
            itype: Some("groups".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_GROUPS.into()),
            ..Default::default()
        })
    }

    /// get the file data
    pub async fn read_file(&self) -> Result<String> {
        let file = self
            .file
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("could not find the file"))?;
        let path = dirs::app_profiles_dir()?.join(file.as_str());
        let content = fs::read_to_string(path).await.context("failed to read the file")?;
        Ok(content.into())
    }

    /// save the file data
    pub async fn save_file(&self, data: String) -> Result<()> {
        let file = self
            .file
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("could not find the file"))?;
        let path = dirs::app_profiles_dir()?.join(file.as_str());
        fs::write(path, data.as_bytes())
            .await
            .context("failed to save the file")
    }
}

impl PrfItem {
    /// 获取current指向的订阅的merge
    pub fn current_merge(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.merge.as_ref())
    }

    /// 获取current指向的订阅的script
    pub fn current_script(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.script.as_ref())
    }

    /// 获取current指向的订阅的rules
    pub fn current_rules(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.rules.as_ref())
    }

    /// 获取current指向的订阅的proxies
    pub fn current_proxies(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.proxies.as_ref())
    }

    /// 获取current指向的订阅的groups
    pub fn current_groups(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.groups.as_ref())
    }
}

// 向前兼容，默认为订阅启用自动更新
#[allow(clippy::unnecessary_wraps)]
const fn default_allow_auto_update() -> Option<bool> {
    Some(true)
}
