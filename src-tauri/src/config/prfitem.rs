use crate::{
    config::{
        encrypt::{deserialize_encrypted, serialize_encrypted},
        profiles,
    },
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
use std::{borrow::Cow, fmt, io::Read as _, time::Duration};
use tokio::fs;
// TODO, use other re-export
use reqwest_dav::re_exports::url::form_urlencoded;
use tauri::Url;

pub(super) fn normalize_profile_home_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw.trim()).ok()?;

    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }

    url.host_str()?;
    Some(url.to_string().into())
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, specta::Type)]
#[serde(default)]
pub struct PrfItem {
    #[specta(type = Option<std::string::String>)]
    pub uid: Option<String>,

    /// enum value: remote | local | script | merge
    #[serde(rename = "type")]
    #[specta(type = Option<std::string::String>)]
    pub itype: Option<String>,
    #[specta(type = Option<std::string::String>)]
    pub name: Option<String>,
    #[specta(type = Option<std::string::String>)]
    pub file: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<std::string::String>)]
    pub desc: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<std::string::String>)]
    pub url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<Vec<PrfSelected>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<PrfExtra>,

    pub updated: Option<usize>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub option: Option<PrfOption>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<std::string::String>)]
    pub home: Option<String>,

    #[serde(skip)]
    #[specta(type = Option<std::string::String>)]
    pub file_data: Option<String>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(default)]
pub struct PrfSelected {
    #[specta(type = Option<std::string::String>)]
    pub name: Option<String>,
    #[specta(type = Option<std::string::String>)]
    pub now: Option<String>,
}

#[derive(Default, Debug, Clone, Copy, Deserialize, Serialize, specta::Type)]
pub struct PrfExtra {
    pub upload: u64,
    pub download: u64,
    pub total: u64,
    pub expire: u64,
}

#[derive(Default, Clone, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(default)]
pub struct PrfOption {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_encrypted",
        deserialize_with = "deserialize_encrypted"
    )]
    #[specta(type = Option<std::string::String>)]
    pub age_secret_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<std::string::String>)]
    pub user_agent: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub with_proxy: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_proxy: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_interval: Option<u64>,

    /// HTTP request timeout in seconds
    /// default is 60 seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,

    /// default is `false`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danger_accept_invalid_certs: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_auto_update: Option<bool>,
    #[specta(type = Option<std::string::String>)]
    pub merge: Option<String>,
    #[specta(type = Option<std::string::String>)]
    pub script: Option<String>,
    #[specta(type = Option<std::string::String>)]
    pub rules: Option<String>,
    #[specta(type = Option<std::string::String>)]
    pub proxies: Option<String>,
    #[specta(type = Option<std::string::String>)]
    pub groups: Option<String>,
}

impl fmt::Debug for PrfOption {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PrfOption")
            .field("age_secret_key", &self.age_secret_key.as_ref().map(|_| "[REDACTED]"))
            .field("user_agent", &self.user_agent)
            .field("with_proxy", &self.with_proxy)
            .field("self_proxy", &self.self_proxy)
            .field("update_interval", &self.update_interval)
            .field("timeout_seconds", &self.timeout_seconds)
            .field("danger_accept_invalid_certs", &self.danger_accept_invalid_certs)
            .field("allow_auto_update", &self.allow_auto_update)
            .field("merge", &self.merge)
            .field("script", &self.script)
            .field("rules", &self.rules)
            .field("proxies", &self.proxies)
            .field("groups", &self.groups)
            .finish()
    }
}

impl PrfOption {
    // Refresh requests and downloaded metadata cannot replace the saved credential.
    pub(crate) fn merge(one: Option<&Self>, other: Option<&Self>) -> Option<Self> {
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
            (None, Some(b_ref)) => Some(Self {
                age_secret_key: None,
                ..b_ref.clone()
            }),
            (None, None) => None,
        }
    }
}

impl PrfItem {
    /// Builds an item from a partial value that must include `itype`.
    pub(super) async fn from(item: &Self, file_data: Option<String>) -> Result<Self> {
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

    async fn from_local(
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
            let merge_item = &mut Self::from_merge(None);
            profiles::profiles_append_item_safe(merge_item).await?;
            merge = merge_item.uid.clone();
        }
        if script.is_none() {
            let script_item = &mut Self::from_script(None);
            profiles::profiles_append_item_safe(script_item).await?;
            script = script_item.uid.clone();
        }
        if rules.is_none() {
            let rules_item = &mut Self::from_rules();
            profiles::profiles_append_item_safe(rules_item).await?;
            rules = rules_item.uid.clone();
        }
        if proxies.is_none() {
            let proxies_item = &mut Self::from_proxies();
            profiles::profiles_append_item_safe(proxies_item).await?;
            proxies = proxies_item.uid.clone();
        }
        if groups.is_none() {
            let groups_item = &mut Self::from_groups();
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

    pub(crate) async fn from_url(
        url: &str,
        name: Option<&String>,
        desc: Option<&String>,
        option: Option<&PrfOption>,
    ) -> Result<Self> {
        let age_secret_key = normalize_age_secret_key(option.and_then(|o| o.age_secret_key.as_deref()))?;
        let with_proxy = option.is_some_and(|o| o.with_proxy.unwrap_or(false));
        let self_proxy = option.is_some_and(|o| o.self_proxy.unwrap_or(false));
        let accept_invalid_certs = option.is_some_and(|o| o.danger_accept_invalid_certs.unwrap_or(false));
        let allow_auto_update = Some(allow_auto_update_enabled(option));
        let user_agent = option.and_then(|o| o.user_agent.clone());
        let update_interval = option.and_then(|o| o.update_interval);
        let timeout = option.and_then(|o| o.timeout_seconds).unwrap_or(20);
        let mut merge = option.and_then(|o| o.merge.clone());
        let mut script = option.and_then(|o| o.script.clone());
        let mut rules = option.and_then(|o| o.rules.clone());
        let mut proxies = option.and_then(|o| o.proxies.clone());
        let mut groups = option.and_then(|o| o.groups.clone());

        let proxy_type = if self_proxy {
            ProxyType::Localhost
        } else if with_proxy {
            ProxyType::System
        } else {
            ProxyType::None
        };

        let url = fix_dirty_url(url)?;

        let resp = match NetworkManager::new()
            .get(
                url.as_str(),
                proxy_type,
                Some(timeout),
                user_agent.clone(),
                accept_invalid_certs,
            )
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
                return Err(e).context("failed to fetch remote profile");
            }
        };

        let status_code = resp.status();
        if !status_code.is_success() {
            bail!("failed to fetch remote profile with status {status_code}")
        }

        let header = resp.headers();

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
            None => {
                Some(crate::utils::help::get_last_part_and_decode(url.as_str()).unwrap_or_else(|| "Remote File".into()))
            }
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

        let home = header
            .get("profile-web-page-url")
            .and_then(|value| value.to_str().ok())
            .and_then(normalize_profile_home_url);

        let uid = help::get_uid("R").into();
        let file = format!("{uid}.yaml").into();
        let name = name
            .map(|s| s.to_owned())
            .unwrap_or_else(|| filename.map(|s| s.into()).unwrap_or_else(|| "Remote File".into()));
        let data = decrypt_remote_profile(resp.text().trim_start_matches('\u{feff}'), age_secret_key.as_deref())?;
        let data = data.trim_start_matches('\u{feff}');

        let yaml = serde_yaml_ng::from_str::<Mapping>(data).context("the remote profile data is invalid yaml")?;

        if !yaml.contains_key("proxies") && !yaml.contains_key("proxy-providers") {
            bail!("profile does not contain `proxies` or `proxy-providers`");
        }

        if merge.is_none() {
            let merge_item = &mut Self::from_merge(None);
            profiles::profiles_append_item_safe(merge_item).await?;
            merge = merge_item.uid.clone();
        }
        if script.is_none() {
            let script_item = &mut Self::from_script(None);
            profiles::profiles_append_item_safe(script_item).await?;
            script = script_item.uid.clone();
        }
        if rules.is_none() {
            let rules_item = &mut Self::from_rules();
            profiles::profiles_append_item_safe(rules_item).await?;
            rules = rules_item.uid.clone();
        }
        if proxies.is_none() {
            let proxies_item = &mut Self::from_proxies();
            profiles::profiles_append_item_safe(proxies_item).await?;
            proxies = proxies_item.uid.clone();
        }
        if groups.is_none() {
            let groups_item = &mut Self::from_groups();
            profiles::profiles_append_item_safe(groups_item).await?;
            groups = groups_item.uid.clone();
        }

        Ok(Self {
            uid: Some(uid),
            itype: Some("remote".into()),
            name: Some(name),
            desc: desc.cloned(),
            file: Some(file),
            url: Some(url.as_str().into()),
            selected: None,
            extra,
            option: Some(PrfOption {
                age_secret_key,
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

    pub(super) fn from_merge(uid: Option<String>) -> Self {
        let (id, template) = if let Some(uid) = uid {
            (uid, tmpl::ITEM_MERGE.into())
        } else {
            (help::get_uid("m").into(), tmpl::ITEM_MERGE_EMPTY.into())
        };
        let file = format!("{id}.yaml").into();

        Self {
            uid: Some(id),
            itype: Some("merge".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(template),
            ..Default::default()
        }
    }

    pub(super) fn from_script(uid: Option<String>) -> Self {
        let id = if let Some(uid) = uid {
            uid
        } else {
            help::get_uid("s").into()
        };
        let file = format!("{id}.js").into(); // js ext
        Self {
            uid: Some(id),
            itype: Some("script".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_SCRIPT.into()),
            ..Default::default()
        }
    }

    fn from_rules() -> Self {
        let uid = help::get_uid("r").into();
        let file = format!("{uid}.yaml").into(); // yaml ext

        Self {
            uid: Some(uid),
            itype: Some("rules".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_RULES.into()),
            ..Default::default()
        }
    }

    fn from_proxies() -> Self {
        let uid = help::get_uid("p").into();
        let file = format!("{uid}.yaml").into(); // yaml ext

        Self {
            uid: Some(uid),
            itype: Some("proxies".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_PROXIES.into()),
            ..Default::default()
        }
    }

    fn from_groups() -> Self {
        let uid = help::get_uid("g").into();
        let file = format!("{uid}.yaml").into(); // yaml ext

        Self {
            uid: Some(uid),
            itype: Some("groups".into()),
            file: Some(file),
            updated: Some(chrono::Local::now().timestamp() as usize),
            file_data: Some(tmpl::ITEM_GROUPS.into()),
            ..Default::default()
        }
    }

    pub(crate) async fn read_file(&self) -> Result<String> {
        let file = self
            .file
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("could not find the file"))?;
        let path = dirs::app_profiles_dir()?.join(file.as_str());
        let content = fs::read_to_string(&path)
            .await
            .with_context(|| format!("failed to read the file \"{}\"", path.display()))?;
        Ok(content.into())
    }
}

impl PrfItem {
    pub(crate) fn current_merge(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.merge.as_ref())
    }

    pub(crate) fn current_script(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.script.as_ref())
    }

    pub(crate) fn current_rules(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.rules.as_ref())
    }

    pub(crate) fn current_proxies(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.proxies.as_ref())
    }

    pub(crate) fn current_groups(&self) -> Option<&String> {
        self.option.as_ref().and_then(|o| o.groups.as_ref())
    }
}

fn allow_auto_update_enabled(option: Option<&PrfOption>) -> bool {
    option.and_then(|o| o.allow_auto_update).unwrap_or(true)
}

pub(super) fn normalize_age_secret_key(key: Option<&str>) -> Result<Option<String>> {
    let Some(key) = key.map(str::trim).filter(|key| !key.is_empty()) else {
        return Ok(None);
    };
    key.parse::<age::x25519::Identity>()
        .map_err(|_| anyhow::anyhow!("invalid age X25519 secret key"))?;
    Ok(Some(key.into()))
}

fn decrypt_remote_profile<'a>(data: &'a str, key: Option<&str>) -> Result<Cow<'a, str>> {
    if !data.starts_with("-----BEGIN AGE ENCRYPTED FILE-----") {
        return Ok(Cow::Borrowed(data));
    }
    let key = key.ok_or_else(|| anyhow::anyhow!("an age secret key is required for this subscription"))?;
    let identity = key
        .parse::<age::x25519::Identity>()
        .map_err(|_| anyhow::anyhow!("invalid age X25519 secret key"))?;
    let decryptor = age::Decryptor::new(age::armor::ArmoredReader::new(data.as_bytes()))
        .map_err(|_| anyhow::anyhow!("failed to decrypt age subscription"))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| anyhow::anyhow!("failed to decrypt age subscription"))?;
    let mut plaintext = Vec::new();
    // The final chunk must authenticate before any profile files or metadata are written.
    reader
        .read_to_end(&mut plaintext)
        .map_err(|_| anyhow::anyhow!("failed to decrypt age subscription"))?;
    let plaintext = std::string::String::from_utf8(plaintext)
        .map_err(|_| anyhow::anyhow!("the decrypted subscription is not UTF-8"))?;
    Ok(Cow::Owned(plaintext))
}

/// Fix URLs where query parameters are incorrectly appended to the path segment
///
/// Incorrect Example: https://example.com/path&param1=value1
fn fix_dirty_url(input: &str) -> Result<Url> {
    let mut url = match Url::parse(input) {
        Ok(u) => u,
        Err(e) => {
            return Err(anyhow::anyhow!(
                "failed to parse subscription URL: {:?}, input: {}",
                e,
                help::mask_url(input)
            ));
        }
    };

    if url.query().is_none() && url.path().contains('&') {
        let path = url.path().to_string();

        if let Some((clean_path, dirty_params)) = path.split_once('&') {
            url.set_path(clean_path);

            url.query_pairs_mut()
                .extend_pairs(form_urlencoded::parse(dirty_params.as_bytes()));
        }
    }

    Ok(url)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, reason = "tests assert by panicking")]
pub(super) mod tests {
    use super::*;
    use age::secrecy::ExposeSecret as _;
    use std::io::Write as _;

    // Generated by Mihomo's EncryptBytes with a disposable X25519 identity.
    pub(in crate::config) const AGE_KEY: &str =
        "AGE-SECRET-KEY-1V3CRQHY4RDQG630CG0UUTU0L5UZL7HZYATPM4J697953NFE6YP2S0VGCK6";
    pub(in crate::config) const AGE_PROFILE: &str = "-----BEGIN AGE ENCRYPTED FILE-----\n\
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOSBUMjNHU0RUbmZkcGczM0s5\n\
akxPNW1KajdmNmdDWFhOd0wxRHpWUFlqVFF3CmRLdHE5aGZZOCtQVFNxYkR2RHE3\n\
TnIvTWo2WklLK0pUVHh1aUpjditkVDQKLS0tIGNmSFhkTTJ4Q3dhN2VwL0U2bjJV\n\
RUd1OG56K21MRlVhZGh6dDBBNCtuRncK2gAyIGK1M5r86XRdQoSX3cAPRpk+d4FZ\n\
rlBhp3apE3YxD+SBkrViOOsDo1k11Ipa4BdJHsavZ83lNw9tB5VfiqXYFC5KThg=\n\
-----END AGE ENCRYPTED FILE-----\n";
    const PLAIN_PROFILE: &str = "proxies: []\nproxy-groups: []\nrules: []\n";

    pub(in crate::config) async fn fetch_profile(body: &str, option: Option<&PrfOption>) -> Result<PrfItem> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        let url = format!("http://{}/profile.yaml", listener.local_addr()?);
        let body = body.to_owned();
        let server = std::thread::spawn(move || -> std::io::Result<()> {
            let (mut socket, _) = listener.accept()?;
            let mut request = [0; 4096];
            let _ = socket.read(&mut request)?;
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
        });
        let result = PrfItem::from(
            &PrfItem {
                itype: Some("remote".into()),
                url: Some(url.into()),
                option: option.cloned(),
                ..PrfItem::default()
            },
            None,
        )
        .await;
        server.join().expect("fixture server panicked")?;
        result
    }

    #[tokio::test]
    async fn age_subscription_import_and_refresh() -> Result<()> {
        let option: PrfOption = serde_json::from_value(serde_json::json!({
            "age_secret_key": format!("  {AGE_KEY}\n"),
            "merge": "m", "script": "s", "rules": "r", "proxies": "p", "groups": "g"
        }))?;
        let imported = fetch_profile(AGE_PROFILE, Some(&option)).await?;
        assert_eq!(imported.file_data.as_deref(), Some(PLAIN_PROFILE));
        assert_eq!(
            imported.option.as_ref().and_then(|o| o.age_secret_key.as_deref()),
            Some(AGE_KEY)
        );
        let refreshed = fetch_profile(AGE_PROFILE, imported.option.as_ref()).await?;
        assert_eq!(refreshed.file_data.as_deref(), Some(PLAIN_PROFILE));
        let mut plain_option = option;
        plain_option.age_secret_key = None;
        let plain = fetch_profile(&format!("\u{feff}{PLAIN_PROFILE}"), Some(&plain_option)).await?;
        assert_eq!(plain.file_data.as_deref(), Some(PLAIN_PROFILE));
        Ok(())
    }

    #[tokio::test]
    async fn age_subscription_rejects_missing_wrong_and_corrupt_keys() -> Result<()> {
        let missing = fetch_profile(AGE_PROFILE, None).await.unwrap_err();
        assert!(missing.to_string().contains("secret key is required"));
        let wrong_key = age::x25519::Identity::generate().to_string();
        let option = PrfOption {
            age_secret_key: Some(wrong_key.expose_secret().into()),
            ..PrfOption::default()
        };
        let wrong = fetch_profile(AGE_PROFILE, Some(&option)).await.unwrap_err();
        assert_eq!(wrong.to_string(), "failed to decrypt age subscription");
        assert!(!format!("{wrong:#?}").contains(wrong_key.expose_secret()));
        let corrupt = AGE_PROFILE.replace("FC5KThg=", "FC5KThA=");
        let option = PrfOption {
            age_secret_key: Some(AGE_KEY.into()),
            ..PrfOption::default()
        };
        let error = fetch_profile(&corrupt, Some(&option)).await.unwrap_err();
        assert_eq!(error.to_string(), "failed to decrypt age subscription");
        assert!(!format!("{error:#?}").contains(AGE_KEY));
        let invalid = normalize_age_secret_key(Some("AGE-SECRET-KEY-private-invalid")).unwrap_err();
        assert_eq!(invalid.to_string(), "invalid age X25519 secret key");
        let recipient = AGE_KEY
            .parse::<age::x25519::Identity>()
            .expect("valid fixture key")
            .to_public();
        for invalid_yaml in ["proxies: [", "unrelated: true"] {
            let encryptor = age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))?;
            let armor = age::armor::ArmoredWriter::wrap_output(Vec::new(), age::armor::Format::AsciiArmor)?;
            let mut writer = encryptor.wrap_output(armor)?;
            writer.write_all(invalid_yaml.as_bytes())?;
            let encrypted = std::string::String::from_utf8(writer.finish()?.finish()?)?;
            assert!(fetch_profile(&encrypted, Some(&option)).await.is_err());
        }
        Ok(())
    }

    #[test]
    fn age_subscription_refresh_options_never_override_saved_key() -> Result<()> {
        let saved = PrfOption {
            age_secret_key: Some(AGE_KEY.into()),
            ..PrfOption::default()
        };
        let stale = saved.clone();
        let cleared = PrfOption {
            timeout_seconds: Some(30),
            ..PrfOption::default()
        };
        for current in [None, Some(&cleared)] {
            let merged = PrfOption::merge(current, Some(&stale)).unwrap();
            assert!(merged.age_secret_key.is_none());
            assert!(decrypt_remote_profile(AGE_PROFILE, merged.age_secret_key.as_deref()).is_err());
        }
        let newer = PrfOption {
            age_secret_key: Some("new saved key".into()),
            ..PrfOption::default()
        };
        let committed = PrfOption::merge(Some(&newer), Some(&stale)).unwrap();
        assert_eq!(committed.age_secret_key, newer.age_secret_key);
        let json = serde_json::to_string(&saved)?;
        assert!(json.contains(AGE_KEY));
        assert!(!format!("{saved:?}").contains(AGE_KEY));
        assert!(serde_json::from_str::<PrfOption>("{}")?.age_secret_key.is_none());
        assert!(normalize_age_secret_key(Some(" \n"))?.is_none());
        Ok(())
    }
}
