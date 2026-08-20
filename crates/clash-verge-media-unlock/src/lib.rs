use std::sync::Arc;

use reqwest::Client;
use tokio::task::JoinSet;

use clash_verge_logging::{Type, logging};

mod bahamut;
mod bilibili;
mod chatgpt;
mod claude;
mod disney_plus;
mod gemini;
mod netflix;
mod prime_video;
mod spotify;
mod tiktok;
mod types;
mod utils;
mod youtube;

pub use types::UnlockItem;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UnlockCheck {
    BilibiliChinaMainland,
    BilibiliHkMcTw,
    ChatGptWeb,
    Claude,
    Gemini,
    YouTubePremium,
    BahamutAnime,
    Netflix,
    DisneyPlus,
    PrimeVideo,
    Spotify,
    TikTok,
}

impl UnlockCheck {
    const ALL: &[Self] = &[
        Self::BilibiliChinaMainland,
        Self::BilibiliHkMcTw,
        Self::ChatGptWeb,
        Self::Claude,
        Self::Gemini,
        Self::YouTubePremium,
        Self::BahamutAnime,
        Self::Netflix,
        Self::DisneyPlus,
        Self::PrimeVideo,
        Self::Spotify,
        Self::TikTok,
    ];

    fn all() -> &'static [Self] {
        Self::ALL
    }

    fn from_name(name: &str) -> Option<Self> {
        Self::all().iter().copied().find(|check| check.name() == name)
    }

    fn name(self) -> &'static str {
        match self {
            Self::BilibiliChinaMainland => bilibili::BILIBILI_CHINA_MAINLAND_NAME,
            Self::BilibiliHkMcTw => bilibili::BILIBILI_HK_MC_TW_NAME,
            Self::ChatGptWeb => chatgpt::CHATGPT_WEB_NAME,
            Self::Claude => claude::CLAUDE_NAME,
            Self::Gemini => gemini::GEMINI_NAME,
            Self::YouTubePremium => youtube::YOUTUBE_PREMIUM_NAME,
            Self::BahamutAnime => bahamut::BAHAMUT_ANIME_NAME,
            Self::Netflix => netflix::NETFLIX_NAME,
            Self::DisneyPlus => disney_plus::DISNEY_NAME,
            Self::PrimeVideo => prime_video::PRIME_VIDEO_NAME,
            Self::Spotify => spotify::SPOTIFY_NAME,
            Self::TikTok => tiktok::TIKTOK_NAME,
        }
    }

    async fn check(self, client: &Client) -> UnlockItem {
        match self {
            Self::BilibiliChinaMainland => bilibili::check_bilibili_china_mainland(client).await,
            Self::BilibiliHkMcTw => bilibili::check_bilibili_hk_mc_tw(client).await,
            Self::ChatGptWeb => chatgpt::check_chatgpt(client).await,
            Self::Claude => claude::check_claude(client).await,
            Self::Gemini => gemini::check_gemini(client).await,
            Self::YouTubePremium => youtube::check_youtube_premium(client).await,
            Self::BahamutAnime => bahamut::check_bahamut_anime(client).await,
            Self::Netflix => netflix::check_netflix(client).await,
            Self::DisneyPlus => disney_plus::check_disney_plus(client).await,
            Self::PrimeVideo => prime_video::check_prime_video(client).await,
            Self::Spotify => spotify::check_spotify(client).await,
            Self::TikTok => tiktok::check_tiktok(client).await,
        }
    }
}

pub fn default_unlock_items() -> Vec<UnlockItem> {
    UnlockCheck::all()
        .iter()
        .map(|check| UnlockItem::pending(check.name()))
        .collect()
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .use_rustls_tls()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .tcp_keepalive(std::time::Duration::from_secs(60))
        .connection_verbose(true)
        .build()
        .map_err(|error| format!("创建HTTP客户端失败: {error}"))
}

// TODO add a custom client parameter
pub async fn check_media_unlock() -> Result<Vec<UnlockItem>, String> {
    let mut tasks = JoinSet::new();
    let client = Arc::new(build_client()?);

    for check in UnlockCheck::all() {
        let client = Arc::clone(&client);
        let check = *check;
        tasks.spawn(async move { check.check(&client).await });
    }

    let mut results = Vec::new();
    while let Some(res) = tasks.join_next().await {
        match res {
            Ok(item) => results.push(item),
            Err(e) => logging!(error, Type::Network, "任务执行失败: {e}"),
        }
    }

    Ok(results)
}

pub async fn check_media_unlock_item(name: &str) -> Result<UnlockItem, String> {
    let check = UnlockCheck::from_name(name).ok_or_else(|| format!("未知的流媒体检测项目: {name}"))?;
    let client = build_client()?;

    Ok(check.check(&client).await)
}
