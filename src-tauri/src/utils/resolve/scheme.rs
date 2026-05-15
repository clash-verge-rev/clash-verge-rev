use std::{borrow::Cow, time::Duration};

use anyhow::Result;
use percent_encoding::percent_decode_str;
use smartstring::alias::String;
use tauri::Url;

use crate::{
    cmd,
    config::{Config, PrfItem, profiles},
    core::{CoreManager, handle},
};
use clash_verge_logging::{Type, logging, logging_error};

#[derive(Debug, PartialEq, Eq)]
enum DeepLinkAction {
    ImportSubscription {
        url: std::string::String,
        name: Option<String>,
    },
    SwitchProfile {
        uid: String,
    },
}

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

    let Some(action) = parse_deep_link_action(&link_parsed) else {
        logging!(error, Type::Config, "unsupported deep link: {}", param_str);
        return Ok(());
    };

    match action {
        DeepLinkAction::ImportSubscription { url, name } => {
            import_subscription(&url, name.as_ref()).await;
        }
        DeepLinkAction::SwitchProfile { uid } => {
            switch_profile(&uid).await;
        }
    }

    Ok(())
}

fn parse_deep_link_action(link_parsed: &Url) -> Option<DeepLinkAction> {
    if !matches!(link_parsed.scheme(), "clash" | "clash-verge") {
        return None;
    }

    if let Some(uid) = extract_switch_profile_uid(link_parsed) {
        return Some(DeepLinkAction::SwitchProfile { uid });
    }

    let name = extract_query_param(link_parsed, "name").map(|value| value.into_owned().into());
    let url = extract_subscription_url(link_parsed)?;
    Some(DeepLinkAction::ImportSubscription { url, name })
}

fn extract_switch_profile_uid(link_parsed: &Url) -> Option<String> {
    let host = link_parsed.host_str().unwrap_or_default();
    let path = link_parsed.path().trim_matches('/');

    let is_switch_route = matches!(
        (host, path),
        ("profile", "switch") | ("switch", "") | ("switch", "switch") | ("", "profile/switch")
    );

    if !is_switch_route {
        return None;
    }

    extract_query_param(link_parsed, "uid").map(|value| value.into_owned().into())
}

fn extract_query_param<'a>(link_parsed: &'a Url, key: &str) -> Option<Cow<'a, str>> {
    link_parsed
        .query_pairs()
        .find(|(query_key, _)| query_key == key)
        .map(|(_, value)| value)
}

fn extract_subscription_url(link_parsed: &Url) -> Option<std::string::String> {
    let raw_url = extract_query_param(link_parsed, "url")?;
    Some(decode_subscription_url(raw_url.as_ref()))
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

async fn switch_profile(uid: &String) {
    let profiles = Config::profiles().await;
    let profile_name = match resolve_switch_profile_label(profiles.latest_arc().as_ref(), uid) {
        Ok(label) => label,
        Err(err) => {
            logging!(warn, Type::Config, "Deep link switch profile rejected: {}", err);
            handle::Handle::notice_message("profile_switch::error", err.to_string());
            return;
        }
    };
    drop(profiles);

    match cmd::patch_profiles_config_by_profile_index(uid.to_owned()).await {
        Ok(outcome) if outcome.is_valid() => {
            logging!(info, Type::Config, "Deep link switched profile: {}", uid);
            handle::Handle::notice_message("profile_switch::ok", profile_name);
        }
        Ok(outcome) => {
            let message = outcome.to_string();
            logging!(
                warn,
                Type::Config,
                "Deep link switch profile validation failed: {}",
                message
            );
            handle::Handle::notice_message("config_validate::error", message);
        }
        Err(err) => {
            logging!(error, Type::Config, "Deep link switch profile failed: {}", err);
            handle::Handle::notice_message("profile_switch::error", err.to_string());
        }
    }
}

fn resolve_switch_profile_label(profiles: &crate::config::profiles::IProfiles, uid: &String) -> Result<String> {
    let item = profiles.get_item(uid)?;
    Ok(item.name.clone().unwrap_or_else(|| uid.clone()))
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
    logging_error!(Type::Config, Config::profiles().await.data_arc().save_file().await);
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
    handle::Handle::notify_profile_changed(uid);
    tokio::time::sleep(Duration::from_millis(100)).await;

    let should_update_core = if uid.is_empty() || had_current_profile {
        false
    } else {
        let profiles = Config::profiles().await;
        profiles.latest_arc().is_current_profile_index(uid)
    };
    handle::Handle::notify_profile_changed(uid);

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
    match CoreManager::global().update_config_forced().await {
        Ok(outcome) if outcome.is_valid() => handle::Handle::refresh_clash(),
        Ok(outcome) => {
            let message = outcome.to_string();
            logging!(warn, Type::Config, "Apply config failed: {}", message);
            handle::Handle::notice_message("config_validate::error", message);
        }
        Err(err) => {
            logging!(error, Type::Config, "Apply config error: {}", err);
            handle::Handle::notice_message("update_failed", format!("{err}"));
        }
    }
}
