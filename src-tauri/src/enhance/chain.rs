use super::SeqMap;
use crate::{
    config::PrfItem,
    utils::{dirs, help},
};
use parking_lot::Mutex;
use serde_yaml_ng::Mapping;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::SystemTime;
use tokio::fs;
use tristr::alias::String;

#[derive(Debug)]
pub struct ChainItem {
    pub uid: String,
    pub data: ChainType,
}

#[derive(Debug)]
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

static CHAIN_CACHE: LazyLock<Mutex<HashMap<PathBuf, CachedChain>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

// Helper trait to allow async conversion
pub trait AsyncChainItemFrom {
    async fn from_async(item: &PrfItem) -> Option<Arc<ChainItem>>;
}

impl AsyncChainItemFrom for Option<Arc<ChainItem>> {
    async fn from_async(item: &PrfItem) -> Self {
        let itype = item.itype.as_ref()?.as_str();
        let file = item.file.clone()?;
        let uid = item.uid.clone().unwrap_or_else(|| "".into());
        let path = dirs::app_profiles_dir().ok()?.join(file.as_str());

        let meta = fs::metadata(&path).await.ok()?;
        let (mtime, len) = (meta.modified().ok()?, meta.len());
        if let Some(cached) = CHAIN_CACHE.lock().get(&path)
            && cached.mtime == mtime
            && cached.len == len
        {
            return Some(Arc::clone(&cached.item));
        }

        let loaded = Arc::new(match itype {
            "script" => Some(ChainItem {
                uid,
                data: ChainType::Script(fs::read_to_string(&path).await.ok()?.as_str().into()),
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
        }?);

        CHAIN_CACHE.lock().insert(
            path,
            CachedChain {
                mtime,
                len,
                item: Arc::clone(&loaded),
            },
        );
        Some(loaded)
    }
}
