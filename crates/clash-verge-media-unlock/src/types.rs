use serde::{Deserialize, Serialize};

use crate::bahamut;
use crate::bilibili;
use crate::chatgpt;
use crate::claude;
use crate::disney_plus;
use crate::gemini;
use crate::netflix;
use crate::prime_video;
use crate::spotify;
use crate::tiktok;
use crate::youtube;

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

    #[cfg(test)]
    pub fn status(&self) -> &str {
        &self.status
    }
}

const AVAILABLE_UNLOCK_ITEM_NAMES: [&str; 13] = [
    bilibili::BILIBILI_CHINA_MAINLAND_NAME,
    bilibili::BILIBILI_HK_MC_TW_NAME,
    chatgpt::CHATGPT_IOS_NAME,
    chatgpt::CHATGPT_WEB_NAME,
    claude::CLAUDE_NAME,
    gemini::GEMINI_NAME,
    youtube::YOUTUBE_PREMIUM_NAME,
    bahamut::BAHAMUT_ANIME_NAME,
    netflix::NETFLIX_NAME,
    disney_plus::DISNEY_NAME,
    prime_video::PRIME_VIDEO_NAME,
    spotify::SPOTIFY_NAME,
    tiktok::TIKTOK_NAME,
];

pub fn default_unlock_items() -> Vec<UnlockItem> {
    AVAILABLE_UNLOCK_ITEM_NAMES
        .iter()
        .map(|name| UnlockItem::pending(name))
        .collect()
}
