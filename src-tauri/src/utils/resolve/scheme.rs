use std::time::Duration;

use anyhow::{Result, bail};
use percent_encoding::percent_decode_str;
use smartstring::alias::String;
use tauri::Url;

use crate::{
    config::{Config, PrfItem, profiles},
    core::handle,
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

    // 解析 URL
    let link_parsed = match Url::parse(param_str) {
        Ok(url) => url,
        Err(e) => {
            bail!("failed to parse deep link: {:?}, param: {:?}", e, param);
        }
    };

    let (url_param, name) = if link_parsed.scheme() == "clash" || link_parsed.scheme() == "clash-verge" {
        let name_owned: Option<String> = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "name")
            .map(|(_, value)| value.into_owned().into());

        let url_param = if let Some(query) = link_parsed.query() {
            let prefix = "url=";
            if let Some(pos) = query.find(prefix) {
                let raw_url = &query[pos + prefix.len()..];
                Some(percent_decode_str(raw_url).decode_utf8_lossy().to_string())
            } else {
                None
            }
        } else {
            None
        };
        (url_param, name_owned)
    } else {
        (None, None)
    };

    let url = if let Some(ref url) = url_param {
        url
    } else {
        logging!(error, Type::Config, "missing url parameter in deep link: {}", param_str);
        return Ok(());
    };

    let mut item = match PrfItem::from_url(url, name.as_ref(), None, None).await {
        Ok(item) => item,
        Err(e) => {
            logging!(error, Type::Config, "failed to parse profile from url: {:?}", e);
            handle::Handle::notice_message("import_sub_url::error", e.to_string());
            return Ok(());
        }
    };

    let uid = item.uid.clone().unwrap_or_default();
    match profiles::profiles_append_item_safe(&mut item).await {
        Ok(_) => {
            Config::profiles().await.apply();
            let _ = Config::profiles().await.data_arc().save_file().await;
            handle::Handle::notice_message(
                "import_sub_url::ok",
                "", // 空 msg 传入，我们不希望导致 后端-前端-后端 死循环，这里只做提醒。
            );
            handle::Handle::refresh_verge();
            handle::Handle::notify_profile_changed(uid.clone());
            tokio::time::sleep(Duration::from_millis(100)).await;
            handle::Handle::notify_profile_changed(uid);
        }
        Err(e) => {
            logging!(error, Type::Config, "failed to import subscription url: {:?}", e);
            Config::profiles().await.discard();
            handle::Handle::notice_message("import_sub_url::error", e.to_string());
            return Ok(());
        }
    }

    Ok(())
}
