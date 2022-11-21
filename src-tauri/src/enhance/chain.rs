use crate::{
    config::PrfItem,
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

impl From<&PrfItem> for Option<ChainItem> {
    fn from(item: &PrfItem) -> Self {
        let itype = item.itype.as_ref()?.as_str();
        let file = item.file.clone()?;
        let uid = item.uid.clone().unwrap_or("".into());
        let path = dirs::app_profiles_dir().ok()?.join(file);

        if !path.exists() {
            return None;
        }

        match itype {
            "script" => Some(ChainItem {
                uid,
                data: ChainType::Script(fs::read_to_string(path).ok()?),
            }),
            "merge" => Some(ChainItem {
                uid,
                data: ChainType::Merge(help::read_merge_mapping(&path).ok()?),
            }),
            _ => None,
        }
    }
}

impl ChainItem {
    /// 内建支持一些脚本
    pub fn builtin() -> Vec<ChainItem> {
        // meta 1.13.2 alpn string 转 数组
        let hy_alpn = ChainItem {
            uid: "verge_hy_alpn".into(),
            data: ChainType::Script(include_str!("./builtin/hy_alpn.js").into()),
        };

        vec![hy_alpn]
    }
}
