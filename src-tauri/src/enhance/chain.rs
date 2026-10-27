use super::SeqMap;
use crate::{
    config::PrfItem,
    utils::{dirs, help},
};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use tokio::fs;

#[derive(Debug, Clone)]
pub struct ChainItem {
    pub uid: String,
    pub data: ChainType,
}

#[derive(Debug, Clone)]
pub enum ChainType {
    Merge(Mapping),
    Script(String),
    Rules(SeqMap),
    Proxies(SeqMap),
    Groups(SeqMap),
}

#[derive(Debug, Clone, Copy)]
pub enum ChainSupport {
    Mihomo,
    MihomoAlpha,
}

// Helper trait to allow async conversion
pub trait AsyncChainItemFrom {
    async fn from_async(item: &PrfItem) -> Option<ChainItem>;
}

impl AsyncChainItemFrom for Option<ChainItem> {
    async fn from_async(item: &PrfItem) -> Self {
        let itype = item.itype.as_ref()?.as_str();
        let file = item.file.clone()?;
        let uid = item.uid.clone().unwrap_or_else(|| "".into());
        let path = dirs::app_profiles_dir().ok()?.join(file.as_str());

        if !path.exists() {
            return None;
        }

        match itype {
            "script" => Some(ChainItem {
                uid,
                data: ChainType::Script(fs::read_to_string(path).await.ok()?.into()),
            }),
            "merge" => Some(ChainItem {
                uid,
                data: ChainType::Merge(help::read_mapping(&path).await.ok()?),
            }),
            "rules" | "proxies" | "groups" => {
                let seq_map = help::read_yaml::<SeqMap>(&path).await.ok()?;
                let data = match itype {
                    "rules" => ChainType::Rules(seq_map),
                    "proxies" => ChainType::Proxies(seq_map),
                    _ => ChainType::Groups(seq_map),
                };
                Some(ChainItem { uid, data })
            }
            _ => None,
        }
    }
}
impl ChainItem {
    /// 内建支持一些脚本
    pub fn builtin() -> Vec<(ChainSupport, Self)> {
        // data intentionally empty: the enhance loop dispatches on uid to native implementations
        vec![
            (ChainSupport::Mihomo, Self::to_script("verge_hy_alpn", "")),
            (ChainSupport::Mihomo, Self::to_script("verge_meta_guard", "")),
            (ChainSupport::MihomoAlpha, Self::to_script("verge_hy_alpn", "")),
            (ChainSupport::MihomoAlpha, Self::to_script("verge_meta_guard", "")),
        ]
    }

    pub fn to_script<U: Into<String>, D: Into<String>>(uid: U, data: D) -> Self {
        Self {
            uid: uid.into(),
            data: ChainType::Script(data.into()),
        }
    }
}

impl ChainSupport {
    pub fn is_support(&self, core: Option<&String>) -> bool {
        match core {
            Some(core) => matches!(
                (self, core.as_str()),
                (Self::Mihomo, "verge-mihomo") | (Self::MihomoAlpha, "verge-mihomo-alpha")
            ),
            None => true,
        }
    }
}
