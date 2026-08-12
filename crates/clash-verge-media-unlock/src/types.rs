use serde::{Deserialize, Serialize};

use super::utils::{country_code_to_emoji, get_local_date_string};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockItem {
    pub name: String,
    pub status: String,
    pub region: Option<String>,
    pub check_time: Option<String>,
}

impl UnlockItem {
    pub fn checked(name: &str, status: impl Into<String>, region: Option<String>) -> Self {
        Self {
            name: name.to_string(),
            status: status.into(),
            region,
            check_time: Some(get_local_date_string()),
        }
    }

    pub fn checked_region(name: &str, status: impl Into<String>, country_code: &str) -> Self {
        Self::checked(name, status, Some(Self::region_label(country_code)))
    }

    pub fn region_label(country_code: &str) -> String {
        let emoji = country_code_to_emoji(country_code);
        format!("{emoji}{country_code}")
    }

    pub fn pending(name: &str) -> Self {
        Self {
            name: name.to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        }
    }
}

const DEFAULT_UNLOCK_ITEM_NAMES: [&str; 13] = [
    "哔哩哔哩大陆",
    "哔哩哔哩港澳台",
    "ChatGPT iOS",
    "ChatGPT Web",
    "Claude",
    "Gemini",
    "YouTube Premium",
    "Bahamut Anime",
    "Netflix",
    "Disney+",
    "Prime Video",
    "Spotify",
    "TikTok",
];

pub fn default_unlock_items() -> Vec<UnlockItem> {
    DEFAULT_UNLOCK_ITEM_NAMES
        .iter()
        .map(|name| UnlockItem::pending(name))
        .collect()
}
