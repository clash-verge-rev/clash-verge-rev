use super::SeqMap;
use crate::{
    config::PrfItem,
    utils::{dirs, help},
};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::{borrow::Cow, path::Path};
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
                let yaml = fs::read_to_string(&path).await.ok()?;
                let seq_map = parse_seq_map(&yaml, &path)?;
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

/// Typed parsing reads `delete: [1234]` as strings where a `Value` round trip would reject it.
fn parse_seq_map(yaml: &str, path: &Path) -> Option<SeqMap> {
    let original = serde_yaml_ng::from_str::<SeqMap>(yaml).ok()?;
    let Ok((Cow::Owned(tolerant), _)) = help::short_id_tolerant(yaml, path) else {
        return Some(original);
    };
    match serde_yaml_ng::from_str::<SeqMap>(&tolerant) {
        Ok(seq_map) => Some(seq_map),
        Err(_) => {
            logging!(
                warn,
                Type::Config,
                "kept numeric short-id in {}: quoted text does not load",
                path.display()
            );
            Some(original)
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::parse_seq_map;
    use serde_yaml_ng::Value;
    use std::path::Path;

    #[test]
    fn seq_short_id_keeps_typed_parse() {
        for (input, delete) in [
            ("prepend: []\nappend: []\ndelete: [1234]\n", "1234"),
            ("prepend: []\nappend: []\ndelete: [true]\n", "true"),
        ] {
            let seq_map = parse_seq_map(input, Path::new("b8.yaml")).expect("seq file should load");
            assert_eq!(seq_map.delete, [delete]);
        }

        let input = "prepend:\n  - name: r\n    reality-opts:\n      short-id: 1234e123\nappend: []\ndelete: []\n";
        let seq_map = parse_seq_map(input, Path::new("seq.yaml")).expect("seq file should load");
        let short_id = seq_map
            .prepend
            .first()
            .and_then(|proxy| proxy.get("reality-opts"))
            .and_then(|opts| opts.get("short-id"));
        assert_eq!(short_id, Some(&Value::String("1234e123".into())));
    }
}
