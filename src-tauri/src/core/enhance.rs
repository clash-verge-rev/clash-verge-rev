use super::prfitem::PrfItem;
use crate::utils::{config, dirs};
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::fs;

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct PrfEnhanced {
  pub current: Mapping,

  pub chain: Vec<PrfData>,

  pub valid: Vec<String>,

  pub callback: String,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct PrfEnhancedResult {
  pub data: Option<Mapping>,

  pub status: String,

  pub error: Option<String>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct PrfData {
  item: PrfItem,

  #[serde(skip_serializing_if = "Option::is_none")]
  merge: Option<Mapping>,

  #[serde(skip_serializing_if = "Option::is_none")]
  script: Option<String>,
}

impl PrfData {
  pub fn from_item(item: &PrfItem) -> Option<PrfData> {
    match item.itype.as_ref() {
      Some(itype) => {
        let file = item.file.clone()?;
        let path = dirs::app_profiles_dir().join(file);

        if !path.exists() {
          return None;
        }

        match itype.as_str() {
          "script" => Some(PrfData {
            item: item.clone(),
            script: Some(fs::read_to_string(path).unwrap_or("".into())),
            merge: None,
          }),
          "merge" => Some(PrfData {
            item: item.clone(),
            merge: Some(config::read_yaml::<Mapping>(path)),
            script: None,
          }),
          _ => None,
        }
      }
      None => None,
    }
  }
}
