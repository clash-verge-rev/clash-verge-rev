use crate::{
    cmd,
    config::{Config, PrfItem, PrfOption, profiles::profiles_draft_update_item_safe},
    core::{CoreManager, handle, tray},
    logging,
    utils::logging::Type,
};
use anyhow::{Result, bail};
use smartstring::alias::String;

/// Toggle proxy profile
pub async fn toggle_proxy_profile(profile_index: String) {
    match cmd::patch_profiles_config_by_profile_index(profile_index).await {
        Ok(_) => {
            let result = tray::Tray::global().update_menu().await;
            if let Err(err) = result {
                logging!(error, Type::Tray, "更新菜单失败: {}", err);
            }
        }
        Err(err) => {
            logging!(error, Type::Tray, "{err}");
        }
    }
}

async fn should_update_profile(
    uid: &String,
    ignore_auto_update: bool,
) -> Result<Option<(String, Option<PrfOption>)>> {
    let profiles = Config::profiles().await;
    let profiles = profiles.latest_ref();
    let item = profiles.get_item(uid)?;
    let is_remote = item.itype.as_ref().is_some_and(|s| s == "remote");

    if !is_remote {
        logging!(
            info,
            Type::Config,
            "[订阅更新] {uid} 不是远程订阅，跳过更新"
        );
        Ok(None)
    } else if item.url.is_none() {
        logging!(
            warn,
            Type::Config,
            "Warning: [订阅更新] {uid} 缺少URL，无法更新"
        );
        bail!("failed to get the profile item url");
    } else if !ignore_auto_update
        && !item
            .option
            .as_ref()
            .and_then(|o| o.allow_auto_update)
            .unwrap_or(true)
    {
        logging!(
            info,
            Type::Config,
            "[订阅更新] {} 禁止自动更新，跳过更新",
            uid
        );
        Ok(None)
    } else {
        logging!(
            info,
            Type::Config,
            "[订阅更新] {} 是远程订阅，URL: {}",
            uid,
            item.url
                .clone()
                .ok_or_else(|| anyhow::anyhow!("Profile URL is None"))?
        );
        Ok(Some((
            item.url
                .clone()
                .ok_or_else(|| anyhow::anyhow!("Profile URL is None"))?,
            item.option.clone(),
        )))
    }
}

async fn perform_profile_update(
    uid: &String,
    url: &String,
    opt: Option<&PrfOption>,
    option: Option<&PrfOption>,
) -> Result<bool> {
    logging!(info, Type::Config, "[订阅更新] 开始下载新的订阅内容");
    let merged_opt = PrfOption::merge(opt, option);

    match PrfItem::from_url(url, None, None, merged_opt.as_ref()).await {
        Ok(mut item) => {
            logging!(info, Type::Config, "[订阅更新] 更新订阅配置成功");
            let profiles = Config::profiles().await;
            profiles_draft_update_item_safe(uid, &mut item).await?;
            let is_current = Some(uid.clone()) == profiles.latest_ref().get_current();
            logging!(
                info,
                Type::Config,
                "[订阅更新] 是否为当前使用的订阅: {is_current}"
            );
            Ok(is_current)
        }
        Err(err) => {
            logging!(
                warn,
                Type::Config,
                "Warning: [订阅更新] 正常更新失败: {err}，尝试使用Clash代理更新"
            );
            handle::Handle::notice_message("update_retry_with_clash", uid.clone());

            let original_with_proxy = merged_opt.as_ref().and_then(|o| o.with_proxy);
            let original_self_proxy = merged_opt.as_ref().and_then(|o| o.self_proxy);

            let mut fallback_opt = merged_opt.unwrap_or_default();
            fallback_opt.with_proxy = Some(false);
            fallback_opt.self_proxy = Some(true);

            match PrfItem::from_url(url, None, None, Some(&fallback_opt)).await {
                Ok(mut item) => {
                    logging!(info, Type::Config, "[订阅更新] 使用Clash代理更新成功");

                    if let Some(option) = item.option.as_mut() {
                        option.with_proxy = original_with_proxy;
                        option.self_proxy = original_self_proxy;
                    }

                    let profiles = Config::profiles().await;
                    profiles_draft_update_item_safe(uid, &mut item).await?;

                    let profile_name = item.name.clone().unwrap_or_else(|| uid.clone());
                    handle::Handle::notice_message("update_with_clash_proxy", profile_name);

                    let is_current = Some(uid.clone()) == profiles.latest_ref().get_current();
                    logging!(
                        info,
                        Type::Config,
                        "[订阅更新] 是否为当前使用的订阅: {is_current}"
                    );
                    Ok(is_current)
                }
                Err(retry_err) => {
                    logging!(
                        error,
                        Type::Config,
                        "[订阅更新] 使用Clash代理更新仍然失败: {retry_err}"
                    );
                    handle::Handle::notice_message(
                        "update_failed_even_with_clash",
                        format!("{retry_err}"),
                    );
                    Err(retry_err)
                }
            }
        }
    }
}

pub async fn update_profile(
    uid: &String,
    option: Option<&PrfOption>,
    auto_refresh: bool,
    ignore_auto_update: bool,
) -> Result<()> {
    logging!(info, Type::Config, "[订阅更新] 开始更新订阅 {}", uid);
    let url_opt = should_update_profile(uid, ignore_auto_update).await?;

    let should_refresh = match url_opt {
        Some((url, opt)) => {
            perform_profile_update(uid, &url, opt.as_ref(), option).await? && auto_refresh
        }
        None => auto_refresh,
    };

    if should_refresh {
        logging!(info, Type::Config, "[订阅更新] 更新内核配置");
        match CoreManager::global().update_config().await {
            Ok(_) => {
                logging!(info, Type::Config, "[订阅更新] 更新成功");
                handle::Handle::refresh_clash();
            }
            Err(err) => {
                logging!(error, Type::Config, "[订阅更新] 更新失败: {}", err);
                handle::Handle::notice_message("update_failed", format!("{err}"));
                logging!(error, Type::Config, "{err}");
            }
        }
    }

    Ok(())
}

/// 增强配置
pub async fn enhance_profiles() -> Result<()> {
    crate::core::CoreManager::global()
        .update_config()
        .await
        .map(|_| ())
}
