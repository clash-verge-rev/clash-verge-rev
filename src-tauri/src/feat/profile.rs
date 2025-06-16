use crate::{
    cmd,
    config::{Config, PrfItem, PrfOption},
    core::{handle, CoreManager, *},
    logging,
    process::AsyncHandler,
    utils::logging::Type,
};
use anyhow::{bail, Result};

/// Toggle proxy profile
pub fn toggle_proxy_profile(profile_index: String) {
    AsyncHandler::spawn(|| async move {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        match cmd::patch_profiles_config_by_profile_index(app_handle, profile_index).await {
            Ok(_) => {
                let _ = tray::Tray::global().update_menu();
            }
            Err(err) => {
                log::error!(target: "app", "{err}");
            }
        }
    });
}

/// Update a profile
/// If updating current profile, activate it
/// auto_refresh: 是否自动更新配置和刷新前端
pub async fn update_profile(
    uid: String,
    option: Option<PrfOption>,
    auto_refresh: Option<bool>,
) -> Result<()> {
    logging!(info, Type::Config, true, "[订阅更新] 开始更新订阅 {}", uid);
    let auto_refresh = auto_refresh.unwrap_or(true); // 默认为true，保持兼容性

    let url_opt = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let item = profiles.get_item(&uid)?;
        let is_remote = item.itype.as_ref().is_some_and(|s| s == "remote");

        if !is_remote {
            log::info!(target: "app", "[订阅更新] {} 不是远程订阅，跳过更新", uid);
            None // 非远程订阅直接更新
        } else if item.url.is_none() {
            log::warn!(target: "app", "[订阅更新] {} 缺少URL，无法更新", uid);
            bail!("failed to get the profile item url");
        } else {
            log::info!(target: "app",
                "[订阅更新] {} 是远程订阅，URL: {}",
                uid,
                item.url.clone().unwrap()
            );
            Some((item.url.clone().unwrap(), item.option.clone()))
        }
    };

    let should_update = match url_opt {
        Some((url, opt)) => {
            log::info!(target: "app", "[订阅更新] 开始下载新的订阅内容");
            let merged_opt = PrfOption::merge(opt.clone(), option.clone());

            // 尝试使用正常设置更新
            match PrfItem::from_url(&url, None, None, merged_opt.clone()).await {
                Ok(item) => {
                    log::info!(target: "app", "[订阅更新] 更新订阅配置成功");
                    let profiles = Config::profiles();
                    let mut profiles = profiles.latest();
                    profiles.update_item(uid.clone(), item)?;

                    let is_current = Some(uid.clone()) == profiles.get_current();
                    log::info!(target: "app", "[订阅更新] 是否为当前使用的订阅: {}", is_current);
                    is_current && auto_refresh
                }
                Err(err) => {
                    // 首次更新失败，尝试使用Clash代理
                    log::warn!(target: "app", "[订阅更新] 正常更新失败: {}，尝试使用Clash代理更新", err);

                    // 发送通知
                    handle::Handle::notice_message("update_retry_with_clash", uid.clone());

                    // 保存原始代理设置
                    let original_with_proxy = merged_opt.as_ref().and_then(|o| o.with_proxy);
                    let original_self_proxy = merged_opt.as_ref().and_then(|o| o.self_proxy);

                    // 创建使用Clash代理的选项
                    let mut fallback_opt = merged_opt.unwrap_or_default();
                    fallback_opt.with_proxy = Some(false);
                    fallback_opt.self_proxy = Some(true);

                    // 使用Clash代理重试
                    match PrfItem::from_url(&url, None, None, Some(fallback_opt)).await {
                        Ok(mut item) => {
                            log::info!(target: "app", "[订阅更新] 使用Clash代理更新成功");

                            // 恢复原始代理设置到item
                            if let Some(option) = item.option.as_mut() {
                                option.with_proxy = original_with_proxy;
                                option.self_proxy = original_self_proxy;
                            }

                            // 更新到配置
                            let profiles = Config::profiles();
                            let mut profiles = profiles.latest();
                            profiles.update_item(uid.clone(), item.clone())?;

                            // 获取配置名称用于通知
                            let profile_name = item.name.clone().unwrap_or_else(|| uid.clone());

                            // 发送通知告知用户自动更新使用了回退机制
                            handle::Handle::notice_message("update_with_clash_proxy", profile_name);

                            let is_current = Some(uid.clone()) == profiles.get_current();
                            log::info!(target: "app", "[订阅更新] 是否为当前使用的订阅: {}", is_current);
                            is_current && auto_refresh
                        }
                        Err(retry_err) => {
                            log::error!(target: "app", "[订阅更新] 使用Clash代理更新仍然失败: {}", retry_err);
                            handle::Handle::notice_message(
                                "update_failed_even_with_clash",
                                format!("{}", retry_err),
                            );
                            return Err(retry_err);
                        }
                    }
                }
            }
        }
        None => auto_refresh,
    };

    if should_update {
        logging!(info, Type::Config, true, "[订阅更新] 更新内核配置");
        match CoreManager::global().update_config().await {
            Ok(_) => {
                logging!(info, Type::Config, true, "[订阅更新] 更新成功");
                handle::Handle::refresh_clash();
            }
            Err(err) => {
                logging!(error, Type::Config, true, "[订阅更新] 更新失败: {}", err);
                handle::Handle::notice_message("update_failed", format!("{err}"));
                log::error!(target: "app", "{err}");
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
