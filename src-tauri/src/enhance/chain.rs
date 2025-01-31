use crate::{
    config::{PrfItem, ProfileType},
    utils::{dirs, help},
};
use serde_yaml::Mapping;
use std::fs;

#[derive(Debug, Clone)]
pub struct ChainItem {
    pub uid: String,
    pub data: ChainType,
}

#[derive(Debug, Clone)]
pub enum ChainType {
    Merge(Mapping),
    Script(String),
}

#[derive(Debug, Clone)]
pub enum ChainSupport {
    Clash,
    ClashMeta,
    ClashMetaAlpha,
    All,
}

impl From<&PrfItem> for Option<ChainItem> {
    fn from(item: &PrfItem) -> Self {
        let itype = item.itype.as_ref()?;
        let file = item.file.clone()?;
        let uid = item.uid.clone().unwrap_or("".into());
        let path = dirs::app_profiles_dir().ok()?.join(file);

        if !path.exists() {
            return None;
        }

        match itype {
            ProfileType::Script => Some(ChainItem {
                uid,
                data: ChainType::Script(fs::read_to_string(path).ok()?),
            }),
            ProfileType::Merge => Some(ChainItem {
                uid,
                data: ChainType::Merge(help::read_merge_mapping(&path).ok()?),
            }),
            _ => None,
        }
    }
}

impl ChainItem {
    /// 内建支持一些脚本
    pub fn builtin() -> Vec<(ChainSupport, ChainItem)> {
        // meta 的一些处理
        let meta_guard =
            ChainItem::to_script("verge_meta_guard", include_str!("./builtin/meta_guard.js"));

        // meta 1.13.2 alpn string 转 数组
        let hy_alpn =
            ChainItem::to_script("verge_hy_alpn", include_str!("./builtin/meta_hy_alpn.js"));

        // meta 的一些处理
        let meta_guard_alpha =
            ChainItem::to_script("verge_meta_guard", include_str!("./builtin/meta_guard.js"));

        // meta 1.13.2 alpn string 转 数组
        let hy_alpn_alpha =
            ChainItem::to_script("verge_hy_alpn", include_str!("./builtin/meta_hy_alpn.js"));

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
                (ChainSupport::All, _)
                    | (ChainSupport::Clash, "clash")
                    | (ChainSupport::ClashMeta, "verge-mihomo")
                    | (ChainSupport::ClashMetaAlpha, "verge-mihomo-alpha")
            ),
            None => true,
        }
    }
}
