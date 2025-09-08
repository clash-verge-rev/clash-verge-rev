use anyhow::{Result, bail};
use percent_encoding::percent_decode_str;
use tauri::Url;

use crate::{config::PrfItem, core::handle, logging, utils::logging::Type, wrap_err};

pub(super) async fn resolve_scheme(param: String) -> Result<()> {
    log::info!(target:"app", "received deep link: {param}");

    let param_str = if param.starts_with("[") && param.len() > 4 {
        param
            .get(2..param.len() - 2)
            .ok_or_else(|| anyhow::anyhow!("Invalid string slice boundaries"))?
    } else {
        param.as_str()
    };

    // 解析 URL
    let link_parsed = match Url::parse(param_str) {
        Ok(url) => url,
        Err(e) => {
            bail!("failed to parse deep link: {:?}, param: {:?}", e, param);
        }
    };

    if link_parsed.scheme() == "clash" || link_parsed.scheme() == "clash-verge" {
        let name = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "name")
            .map(|(_, value)| value.into_owned());

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
            Some(url) => {
                log::info!(target:"app", "decoded subscription url: {url}");
                // create_window(false).await;
                match PrfItem::from_url(url.as_ref(), name, None, None).await {
                    Ok(item) => {
                        let uid = match item.uid.clone() {
                            Some(uid) => uid,
                            None => {
                                logging!(error, Type::Config, true, "Profile item missing UID");
                                handle::Handle::notice_message(
                                    "import_sub_url::error",
                                    "Profile item missing UID".to_string(),
                                );
                                return Ok(());
                            }
                        };
                        let result = crate::config::profiles::profiles_append_item_safe(item).await;
                        let _ = wrap_err!(result);
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
