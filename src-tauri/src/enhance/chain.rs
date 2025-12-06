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

#[derive(Debug, Clone)]
pub enum ChainSupport {
    ClashMeta,
    ClashMetaAlpha,
}

// impl From<&PrfItem> for Option<ChainItem> {
//     fn from(item: &PrfItem) -> Self {
//         let itype = item.itype.as_ref()?.as_str();
//         let file = item.file.clone()?;
//         let uid = item.uid.clone().unwrap_or("".into());
//         let path = dirs::app_profiles_dir().ok()?.join(file);

//         if !path.exists() {
//             return None;
//         }

//         match itype {
//             "script" => Some(ChainItem {
//                 uid,
//                 data: ChainType::Script(fs::read_to_string(path).ok()?),
//             }),
//             "merge" => Some(ChainItem {
//                 uid,
//                 data: ChainType::Merge(help::read_mapping(&path).ok()?),
//             }),
//             "rules" => Some(ChainItem {
//                 uid,
//                 data: ChainType::Rules(help::read_seq_map(&path).ok()?),
//             }),
//             "proxies" => Some(ChainItem {
//                 uid,
//                 data: ChainType::Proxies(help::read_seq_map(&path).ok()?),
//             }),
//             "groups" => Some(ChainItem {
//                 uid,
//                 data: ChainType::Groups(help::read_seq_map(&path).ok()?),
//             }),
//             _ => None,
//         }
//     }
// }
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
            "rules" => {
                let seq_map = help::read_seq_map(&path).await.ok()?;
                Some(ChainItem {
                    uid,
                    data: ChainType::Rules(seq_map),
                })
            }
            "proxies" => {
                let seq_map = help::read_seq_map(&path).await.ok()?;
                Some(ChainItem {
                    uid,
                    data: ChainType::Proxies(seq_map),
                })
            }
            "groups" => {
                let seq_map = help::read_seq_map(&path).await.ok()?;
                Some(ChainItem {
                    uid,
                    data: ChainType::Groups(seq_map),
                })
            }
            _ => None,
        }
    }
}
impl ChainItem {
    /// 内建支持一些脚本
    pub fn builtin() -> Vec<(ChainSupport, Self)> {
        // meta 的一些处理
        let meta_guard = Self::to_script("verge_meta_guard", include_str!("./builtin/meta_guard.js"));

        // meta 1.13.2 alpn string 转 数组
        let hy_alpn = Self::to_script("verge_hy_alpn", include_str!("./builtin/meta_hy_alpn.js"));

        // meta 的一些处理
        let meta_guard_alpha = Self::to_script("verge_meta_guard", include_str!("./builtin/meta_guard.js"));

        // meta 1.13.2 alpn string 转 数组
        let hy_alpn_alpha = Self::to_script("verge_hy_alpn", include_str!("./builtin/meta_hy_alpn.js"));

        vec![
            (ChainSupport::ClashMeta, hy_alpn),
            (ChainSupport::ClashMeta, meta_guard),
            (ChainSupport::ClashMetaAlpha, hy_alpn_alpha),
            (ChainSupport::ClashMetaAlpha, meta_guard_alpha),
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
                (Self::ClashMeta, "verge-mihomo") | (Self::ClashMetaAlpha, "verge-mihomo-alpha")
            ),
            None => true,
        }
    }
}
