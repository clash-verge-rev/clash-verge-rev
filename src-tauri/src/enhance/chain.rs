use crate::{
    config::{PrfItem, ProfileType},
    utils::{dirs, help},
};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::{collections::HashMap, fs};

use super::{use_merge, use_script, LogMessage};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub struct ChainItem {
    pub uid: String,
    pub name: String,
    pub desc: String,
    pub file: String,
    #[serde(rename = "type")]
    pub itype: ChainType,
    pub parent: Option<String>,
    pub enable: bool,
    pub scope: ScopeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChainType {
    Merge,
    Script,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScopeType {
    Global,
    Specific,
}

impl Default for ScopeType {
    fn default() -> Self {
        Self::Global
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChainExcResult {
    pub config: Mapping,
    pub logs: Option<HashMap<String, Vec<LogMessage>>>,
}

impl From<PrfItem> for Option<ChainItem> {
    fn from(item: PrfItem) -> Self {
        let name = item.name.clone()?;
        let desc = item.desc.clone()?;
        let itype = item.itype.as_ref()?;
        let file = item.file.clone()?;
        let uid = item.uid.clone().unwrap_or_default();
        let path = dirs::app_profiles_dir().ok()?.join(&file);
        let enable = item.enable.unwrap_or_default();
        let parent = item.parent.clone();

        if !path.exists() {
            return None;
        }

        match itype {
            ProfileType::Script => Some(ChainItem {
                uid,
                name,
                desc,
                itype: ChainType::Script,
                file,
                parent,
                enable,
                scope: ScopeType::Global,
            }),
            ProfileType::Merge => Some(ChainItem {
                uid,
                name,
                desc,
                itype: ChainType::Merge,
                file,
                parent,
                enable,
                scope: ScopeType::Global,
            }),
            _ => None,
        }
    }
}

impl ChainItem {
    pub fn excute(&self, config: Mapping) -> Result<ChainExcResult> {
        let path = dirs::app_profiles_dir()?.join(&self.file);
        if !path.exists() {
            bail!("couldn't find enhance file, {:?}", self.name)
        }
        match self.itype {
            ChainType::Merge => {
                let content = help::read_merge_mapping(&path)?;
                let res_config = use_merge(content, config);
                Ok(ChainExcResult {
                    config: res_config,
                    logs: None,
                })
            }
            ChainType::Script => {
                let content = fs::read_to_string(&path)?;
                let (res_config, script_logs) = use_script(content, config)?;
                let mut res_logs = HashMap::new();
                res_logs.insert(self.uid.clone(), script_logs);
                Ok(ChainExcResult {
                    config: res_config,
                    logs: Some(res_logs),
                })
            }
        }
    }
}

#[test]
fn test_serde() -> anyhow::Result<()> {
    let parent = Some("rhasdfwsd".to_string());
    let uid = "123".to_string();
    let name = "test".to_string();
    let desc = "这是一个测试用例".to_string();
    let file = "m6AlCCwRNplH.yaml".to_string();
    // let path = dirs::app_profiles_dir()?.join(&file);
    let chain = ChainItem {
        uid,
        name,
        desc,
        file,
        itype: ChainType::Merge,
        parent,
        enable: false,
        scope: ScopeType::Global,
    };
    let json = serde_yaml::to_string(&chain)?;
    println!("yaml: {:?}", json);
    Ok(())
}
