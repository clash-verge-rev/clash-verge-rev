use std::time::Duration;

use anyhow::Result;
use percent_encoding::percent_decode_str;
use smartstring::alias::String;
use tauri::Url;

use crate::{
    config::{Config, PrfItem, profiles},
    core::{CoreManager, handle},
};
use clash_verge_logging::{Type, logging};

pub(super) async fn resolve_scheme(param: &str) -> Result<()> {
    logging!(info, Type::Config, "received deep link: {param}");

    let param_str = if param.starts_with("[") && param.len() > 4 {
        param
            .get(2..param.len() - 2)
            .ok_or_else(|| anyhow::anyhow!("Invalid string slice boundaries"))?
    } else {
        param
    };

    let link_parsed =
        Url::parse(param_str).map_err(|e| anyhow::anyhow!("failed to parse deep link: {:?}, param: {:?}", e, param))?;

    let Some((url, name)) = extract_subscription_info(&link_parsed) else {
        logging!(error, Type::Config, "missing url parameter in deep link: {}", param_str);
        return Ok(());
    };

    import_subscription(&url, name.as_ref()).await;
    Ok(())
}

fn extract_subscription_info(link_parsed: &Url) -> Option<(std::string::String, Option<String>)> {
    if !matches!(link_parsed.scheme(), "clash" | "clash-verge") {
        return None;
    }

    let name = link_parsed
        .query_pairs()
        .find(|(key, _)| key == "name")
        .map(|(_, value)| value.into_owned().into());
    let url = extract_subscription_url(link_parsed)?;
    Some((url, name))
}

fn extract_subscription_url(link_parsed: &Url) -> Option<std::string::String> {
    let query = link_parsed.query()?;
    let prefix = "url=";
    let pos = query.find(prefix)?;
    let raw_url = query[pos + prefix.len()..].trim();
    Some(decode_subscription_url(raw_url))
}

fn decode_subscription_url(raw_url: &str) -> std::string::String {
    // Avoid double-decoding nested subscription URLs; decode only when needed.
    if Url::parse(raw_url).is_ok() {
        return raw_url.to_string();
    }

    let mut candidate = raw_url.to_string();
    for _ in 0..2 {
        let next = percent_decode_str(&candidate).decode_utf8_lossy().to_string();
        if next == candidate {
            break;
        }
        candidate = next;
        if Url::parse(&candidate).is_ok() {
            break;
        }
    }
    candidate
}

async fn import_subscription(url: &str, name: Option<&String>) {
    let had_current_profile = {
        let profiles = Config::profiles().await;
        profiles.latest_arc().current.is_some()
    };

    let Some(mut item) = fetch_profile_item(url, name).await else {
        return;
    };

    let uid = item.uid.clone().unwrap_or_default();
    if let Err(e) = profiles::profiles_append_item_safe(&mut item).await {
        logging!(error, Type::Config, "failed to import subscription url: {:?}", e);
        Config::profiles().await.discard();
        handle::Handle::notice_message("import_sub_url::error", e.to_string());
        return;
    }

    Config::profiles().await.apply();
    let _ = Config::profiles().await.data_arc().save_file().await;
    handle::Handle::notice_message(
        "import_sub_url::ok",
        "", // 空 msg 传入，我们不希望导致 后端-前端-后端 死循环，这里只做提醒。
    );

    post_import_updates(&uid, had_current_profile).await;
}

async fn fetch_profile_item(url: &str, name: Option<&String>) -> Option<PrfItem> {
    match PrfItem::from_url(url, name, None, None).await {
        Ok(item) => Some(item),
        Err(e) => {
            logging!(error, Type::Config, "failed to parse profile from url: {:?}", e);
            handle::Handle::notice_message("import_sub_url::error", e.to_string());
            None
        }
    }
}

async fn post_import_updates(uid: &String, had_current_profile: bool) {
    handle::Handle::refresh_verge();
    handle::Handle::notify_profile_changed(uid.clone());
    tokio::time::sleep(Duration::from_millis(100)).await;

    let should_update_core = if uid.is_empty() || had_current_profile {
        false
    } else {
        let profiles = Config::profiles().await;
        profiles.latest_arc().is_current_profile_index(uid)
    };
    handle::Handle::notify_profile_changed(uid.clone());

    if should_update_core {
        refresh_core_config().await;
    }
}

async fn refresh_core_config() {
    logging!(
        info,
        Type::Config,
        "Deep link import set current profile; refreshing core config"
    );
    match CoreManager::global().update_config().await {
        Ok((true, _)) => handle::Handle::refresh_clash(),
        Ok((false, msg)) => {
            let message = if msg.is_empty() {
                String::from("Failed to apply subscription configuration")
            } else {
                msg
            };
            logging!(warn, Type::Config, "Apply config failed: {}", message);
            handle::Handle::notice_message("config_validate::error", message);
        }
        Err(err) => {
            logging!(error, Type::Config, "Apply config error: {}", err);
            handle::Handle::notice_message("update_failed", format!("{err}"));
        }
    }
}
