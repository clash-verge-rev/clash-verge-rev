use super::Config;
use crate::{
    enhance::chain::ScopeType,
    utils::{dirs, help, tmpl},
    APP_VERSION,
};
use anyhow::{bail, Context, Result};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::{collections::HashMap, fs, path::PathBuf, time::Duration};
use sysproxy::Sysproxy;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct PrfItem {
    pub uid: Option<String>,

    /// profile item type
    /// enum value: remote | local | script | merge
    #[serde(rename = "type")]
    pub itype: Option<ProfileType>,

    /// profile name
    pub name: Option<String>,

    /// profile description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,

    /// profile file
    pub file: Option<String>,

    /// the file data
    #[serde(skip)]
    pub file_data: Option<String>,

    // =========== chain ===========
    /// this chain is belong to profile
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,

    /// enable chain
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,

    /// scope of chain  (GLOBAL / SPECIFIC)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<ScopeType>,
    // =========== chain ===========

    // =========== profile ===========
    /// selected information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<Vec<PrfSelected>>,

    /// profile rule providers path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_providers_path: Option<HashMap<String, PathBuf>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain: Option<Vec<String>>,
    // =========== profile ===========

    // =========== remote profile ===========
    /// source url
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// subscription user info
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<PrfExtra>,

    /// some options of the item
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option: Option<PrfOption>,

    /// profile web page url
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,

    /// updated time
    pub updated: Option<usize>,
    // =========== remote profile ===========
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileType {
    Local,
    Remote,
    Merge,
    Script,
}

impl Default for ProfileType {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum EnableFilter {
    All,
    Enable,
    Disable,
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
    /// disable certificate validation
    /// default is `false`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danger_accept_invalid_certs: Option<bool>,
}

impl PrfOption {
    pub fn merge(one: Option<Self>, other: Option<Self>) -> Option<Self> {
        match (one, other) {
            (Some(mut a), Some(b)) => {
                a.user_agent = b.user_agent.or(a.user_agent);
                a.with_proxy = b.with_proxy.or(a.with_proxy);
                a.self_proxy = b.self_proxy.or(a.self_proxy);
                a.danger_accept_invalid_certs = b
                    .danger_accept_invalid_certs
                    .or(a.danger_accept_invalid_certs);
                a.update_interval = b.update_interval.or(a.update_interval);
                Some(a)
            }
            t => t.0.or(t.1),
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

        match item.itype.unwrap() {
            ProfileType::Remote => {
                if item.url.is_none() {
                    bail!("url should not be null");
                }
                let url = item.url.as_ref().unwrap().as_str();
                let name = item.name;
                let desc = item.desc;
                PrfItem::from_url(url, name, desc, item.option).await
            }
            ProfileType::Local => {
                let name = item.name.unwrap_or("Local File".into());
                let desc = item.desc.unwrap_or("".into());
                PrfItem::from_local(name, desc, file_data)
            }
            ProfileType::Merge => {
                let name = item.name.unwrap_or("Merge".into());
                let desc = item.desc.unwrap_or("".into());
                let parent = item.parent;
                let scope = item.scope.unwrap_or_default();
                PrfItem::from_merge(parent, scope, name, desc)
            }
            ProfileType::Script => {
                let name = item.name.unwrap_or("Script".into());
                let desc = item.desc.unwrap_or("".into());
                let parent = item.parent;
                let scope = item.scope.unwrap_or_default();
                PrfItem::from_script(parent, scope, name, desc)
            }
        }
    }

    /// ## Local type
    /// create a new item from name/desc
    pub fn from_local(name: String, desc: String, file_data: Option<String>) -> Result<PrfItem> {
        let uid = help::get_uid("l");
        let file = format!("{uid}.yaml");

        Ok(PrfItem {
            uid: Some(uid),
            itype: Some(ProfileType::Local),
            name: Some(name),
            desc: Some(desc),
            file: Some(file),
            file_data: Some(file_data.unwrap_or(tmpl::ITEM_LOCAL.into())),
            parent: None,
            enable: None,
            scope: None,
            selected: None,
            rule_providers_path: None,
            chain: None,
            url: None,
            extra: None,
            option: None,
            home: None,
            updated: Some(chrono::Local::now().timestamp() as usize),
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
        let opt_ref = option.as_ref();
        let with_proxy = opt_ref.is_some_and(|o| o.with_proxy.unwrap_or(false));
        let self_proxy = opt_ref.is_some_and(|o| o.self_proxy.unwrap_or(false));
        let accept_invalid_certs =
            opt_ref.is_some_and(|o| o.danger_accept_invalid_certs.unwrap_or(false));
        let user_agent = opt_ref.and_then(|o| o.user_agent.clone());
        let update_interval = opt_ref.and_then(|o| o.update_interval);

        let mut builder = reqwest::ClientBuilder::new()
            .timeout(Duration::from_secs(10))
            .use_rustls_tls()
            .no_proxy();

        if self_proxy {
            // 使用软件自己的代理
            let port = Config::clash().latest().get_mixed_port();

            let proxy_scheme = format!("http://127.0.0.1:{port}");

            if let Ok(proxy) = reqwest::Proxy::http(&proxy_scheme) {
                builder = builder.proxy(proxy);
            }
            if let Ok(proxy) = reqwest::Proxy::https(&proxy_scheme) {
                builder = builder.proxy(proxy);
            }
            if let Ok(proxy) = reqwest::Proxy::all(&proxy_scheme) {
                builder = builder.proxy(proxy);
            }
        } else if with_proxy {
            // 使用系统代理
            if let Ok(p @ Sysproxy { enable: true, .. }) = Sysproxy::get_system_proxy() {
                let proxy_scheme = format!("http://{}:{}", p.host, p.port);

                if let Ok(proxy) = reqwest::Proxy::http(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
                if let Ok(proxy) = reqwest::Proxy::https(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
                if let Ok(proxy) = reqwest::Proxy::all(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
            }
        }

        let version = match APP_VERSION.get() {
            Some(v) => format!("clash-verge/v{v}"),
            None => "clash-verge/unknown".to_string(),
        };

        builder = builder.danger_accept_invalid_certs(accept_invalid_certs);
        builder = builder.user_agent(user_agent.unwrap_or(version));

        let resp = builder.build()?.get(url).send().await?;

        let status_code = resp.status();
        if !StatusCode::is_success(&status_code) {
            bail!("failed to fetch remote profile with status {status_code}")
        }

        let header = resp.headers();

        // parse the Subscription UserInfo
        let extra = match header.get("Subscription-Userinfo") {
            Some(value) => {
                let sub_info = value.to_str().unwrap_or("");
                Some(PrfExtra {
                    upload: help::parse_str(sub_info, "upload").unwrap_or(0),
                    download: help::parse_str(sub_info, "download").unwrap_or(0),
                    total: help::parse_str(sub_info, "total").unwrap_or(0),
                    expire: help::parse_str(sub_info, "expire").unwrap_or(0),
                })
            }
            None => None,
        };

        // parse the Content-Disposition
        let filename = match header.get("Content-Disposition") {
            Some(value) => {
                let filename = format!("{value:?}");
                let filename = filename.trim_matches('"');
                match help::parse_str::<String>(filename, "filename*") {
                    Some(filename) => {
                        let iter = percent_encoding::percent_decode(filename.as_bytes());
                        let filename = iter.decode_utf8().unwrap_or_default();
                        filename.split("''").last().map(|s| s.to_string())
                    }
                    None => match help::parse_str::<String>(filename, "filename") {
                        Some(filename) => {
                            let filename = filename.trim_matches('"');
                            Some(filename.to_string())
                        }
                        None => None,
                    },
                }
            }
            None => Some(help::get_last_part_and_decode(url).unwrap_or("Remote File".into())),
        };
        let option = match update_interval {
            Some(val) => Some(PrfOption {
                update_interval: Some(val),
                ..PrfOption::default()
            }),
            None => match header.get("profile-update-interval") {
                Some(value) => match value.to_str().unwrap_or("").parse::<u64>() {
                    Ok(val) => Some(PrfOption {
                        update_interval: Some(val * 60), // hour -> min
                        ..PrfOption::default()
                    }),
                    Err(_) => None,
                },
                None => None,
            },
        };

        let home = match header.get("profile-web-page-url") {
            Some(value) => {
                let str_value = value.to_str().unwrap_or("");
                Some(str_value.to_string())
            }
            None => None,
        };

        let uid = help::get_uid("r");
        let file = format!("{uid}.yaml");
        let name = name.unwrap_or(filename.unwrap_or("Remote File".into()));
        let data = resp.text_with_charset("utf-8").await?;

        // process the charset "UTF-8 with BOM"
        let data = data.trim_start_matches('\u{feff}');

        // check the data whether the valid yaml format
        let yaml = serde_yaml::from_str::<Mapping>(data)
            .context("the remote profile data is invalid yaml")?;

        if !yaml.contains_key("proxies") && !yaml.contains_key("proxy-providers") {
            bail!("profile does not contain `proxies` or `proxy-providers`");
        }

        Ok(PrfItem {
            uid: Some(uid),
            itype: Some(ProfileType::Remote),
            name: Some(name),
            desc,
            file: Some(file),
            file_data: Some(data.into()),
            parent: None,
            enable: None,
            scope: None,
            selected: None,
            rule_providers_path: None,
            chain: None,
            url: Some(url.into()),
            extra,
            option,
            home,
            updated: Some(chrono::Local::now().timestamp() as usize),
        })
    }

    /// ## Merge type (enhance)
    /// create the enhanced item by using `merge` rule
    pub fn from_merge(
        parent: Option<String>,
        scope: ScopeType,
        name: String,
        desc: String,
    ) -> Result<PrfItem> {
        let uid = help::get_uid("m");
        let file = format!("{uid}.yaml");

        Ok(PrfItem {
            uid: Some(uid),
            itype: Some(ProfileType::Merge),
            name: Some(name),
            desc: Some(desc),
            file_data: Some(tmpl::ITEM_MERGE.into()),
            file: Some(file),
            parent,
            enable: Some(false),
            scope: Some(scope),
            selected: None,
            rule_providers_path: None,
            chain: None,
            url: None,
            extra: None,
            option: None,
            home: None,
            updated: Some(chrono::Local::now().timestamp() as usize),
        })
    }

    /// ## Script type (enhance)
    /// create the enhanced item by using javascript quick.js
    pub fn from_script(
        parent: Option<String>,
        scope: ScopeType,
        name: String,
        desc: String,
    ) -> Result<PrfItem> {
        let uid = help::get_uid("s");
        let file = format!("{uid}.js"); // js ext

        Ok(PrfItem {
            uid: Some(uid),
            itype: Some(ProfileType::Script),
            name: Some(name),
            desc: Some(desc),
            file: Some(file),
            file_data: Some(tmpl::ITEM_SCRIPT.into()),
            parent,
            enable: Some(false),
            scope: Some(scope),
            selected: None,
            rule_providers_path: None,
            chain: None,
            url: None,
            extra: None,
            option: None,
            home: None,
            updated: Some(chrono::Local::now().timestamp() as usize),
        })
    }

    /// get the file data
    pub fn read_file(&self) -> Result<String> {
        if self.file.is_none() {
            bail!("could not find the file");
        }

        let file = self.file.clone().unwrap();
        let path = dirs::app_profiles_dir()?.join(file);
        fs::read_to_string(path).context("failed to read the file")
    }

    /// save the file data
    pub fn save_file(&self, data: String) -> Result<()> {
        if self.file.is_none() {
            bail!("could not find the file");
        }
        let file = self.file.clone().unwrap();
        let path = dirs::app_profiles_dir()?.join(file);
        fs::write(path, data.as_bytes()).context("failed to save the file")
    }

    pub fn delete_file(&self) -> Result<()> {
        if self.file.is_none() {
            bail!("could not find the file");
        }
        let file = self.file.clone().unwrap();
        let path = dirs::app_profiles_dir()?.join(file);
        fs::remove_file(path).context("failed to delete the file")
    }
}
