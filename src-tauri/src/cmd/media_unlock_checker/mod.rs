use std::sync::Arc;

use reqwest::Client;
use tauri::command;
use tokio::{sync::Mutex, task::JoinSet};

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

use bahamut::check_bahamut_anime;
use bilibili::{check_bilibili_china_mainland, check_bilibili_hk_mc_tw};
use chatgpt::check_chatgpt_combined;
use claude::check_claude;
use disney_plus::check_disney_plus;
use gemini::check_gemini;
use netflix::check_netflix;
use prime_video::check_prime_video;
use spotify::check_spotify;
use tiktok::check_tiktok;
use youtube::check_youtube_premium;

#[command]
pub async fn get_unlock_items() -> Result<Vec<UnlockItem>, String> {
    Ok(types::default_unlock_items())
}

#[command]
pub async fn check_media_unlock() -> Result<Vec<UnlockItem>, String> {
    let client = match Client::builder()
        .use_rustls_tls()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .tcp_keepalive(std::time::Duration::from_secs(60))
        .connection_verbose(true)
        .build() {
        Ok(client) => client,
        Err(e) => return Err(format!("创建HTTP客户端失败: {e}")),
    };

    let results = Arc::new(Mutex::new(Vec::new()));
    let mut tasks = JoinSet::new();
    let client_arc = Arc::new(client);

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_bilibili_china_mainland(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_bilibili_hk_mc_tw(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let chatgpt_results = check_chatgpt_combined(&client).await;
            let mut results = results.lock().await;
            results.extend(chatgpt_results);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_claude(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_gemini(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_youtube_premium(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_bahamut_anime(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_netflix(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_disney_plus(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_spotify(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_tiktok(&client).await;
            results.lock().await.push(result);
        });
    }

    {
        let client = Arc::clone(&client_arc);
        let results = Arc::clone(&results);
        tasks.spawn(async move {
            let result = check_prime_video(&client).await;
            results.lock().await.push(result);
        });
    }

    while let Some(res) = tasks.join_next().await {
        if let Err(e) = res {
            eprintln!("任务执行失败: {e}");
        }
    }

    let results = match Arc::try_unwrap(results) {
        Ok(mutex) => mutex.into_inner(),
        Err(_) => {
            logging!(
                error,
                Type::Network,
                "Failed to unwrap results Arc, references still exist"
            );
            return Err("Failed to collect results".to_string());
        }
    };

    Ok(results)
}
