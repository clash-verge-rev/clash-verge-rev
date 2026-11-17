use super::SeqMap;
use crate::{
    config::PrfItem,
    utils::{dirs, help},
};
use parking_lot::Mutex;
use serde_yaml_ng::Mapping;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::SystemTime;
use tokio::fs;
use tristr::alias::String;

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

struct CachedChain {
    mtime: SystemTime,
    len: u64,
    item: Arc<ChainItem>,
}

static CHAIN_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedChain>>> = OnceLock::new();

fn chain_cache() -> &'static Mutex<HashMap<PathBuf, CachedChain>> {
    CHAIN_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
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

        let meta = fs::metadata(&path).await.ok()?;
        let (mtime, len) = (meta.modified().ok()?, meta.len());
        if let Some(cached) = chain_cache().lock().get(&path)
            && cached.mtime == mtime
            && cached.len == len
        {
            return Some((*cached.item).clone());
        }

        let loaded = match itype {
            "script" => Some(ChainItem {
                uid,
                data: ChainType::Script(fs::read_to_string(&path).await.ok()?.into()),
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
        }?;

        chain_cache().lock().insert(
            path,
            CachedChain {
                mtime,
                len,
                item: Arc::new(loaded.clone()),
            },
        );
        Some(loaded)
    }
}
