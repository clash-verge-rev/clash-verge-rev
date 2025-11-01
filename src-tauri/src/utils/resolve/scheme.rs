use anyhow::{Result, bail};
use percent_encoding::percent_decode_str;
use smartstring::alias::String;
use tauri::Url;

use crate::{
    config::{PrfItem, profiles},
    core::handle,
    logging, logging_error,
    utils::logging::Type,
};

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

    if link_parsed.scheme() == "clash" || link_parsed.scheme() == "clash-verge" {
        let name_owned: Option<String> = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "name")
            .map(|(_, value)| value.into_owned().into());
        let name = name_owned.as_ref();

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

        match url_param {
            Some(ref url) => {
                logging!(info, Type::Config, "decoded subscription url: {url}");
                match PrfItem::from_url(url.as_ref(), name, None, None).await {
                    Ok(mut item) => {
                        let uid = match item.uid.clone() {
                            Some(uid) => uid,
                            None => {
                                logging!(error, Type::Config, "Profile item missing UID");
                                handle::Handle::notice_message(
                                    "import_sub_url::error",
                                    "Profile item missing UID".to_string(),
                                );
                                return Ok(());
                            }
                        };
                        let result = profiles::profiles_append_item_safe(&mut item).await;
                        logging_error!(
                            Type::Config,
                            "failed to import subscription url: {:?}",
                            result
                        );
                        handle::Handle::notice_message("import_sub_url::ok", uid);
                    }
                    Err(e) => {
                        handle::Handle::notice_message("import_sub_url::error", e.to_string());
                    }
                }
            }
            None => bail!("failed to get profile url"),
        }
    }

    Ok(())
}
