use crate::{
    cmd,
    config::{Config, PrfItem, PrfOption, profiles::profiles_draft_update_item_safe},
    core::{CoreManager, handle, tray, validate::ValidationOutcome},
    utils::help::{mask_err, mask_url},
};
use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging, logging_error};
use smartstring::alias::String;
use tauri::Emitter as _;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProfileUpdateProxyMode {
    Direct,
    Clash,
    System,
}

impl ProfileUpdateProxyMode {
    const fn label(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Clash => "Clash proxy",
            Self::System => "system proxy",
        }
    }
}

fn profile_update_proxy_mode(option: Option<&PrfOption>) -> ProfileUpdateProxyMode {
    match option {
        Some(option) if option.self_proxy.unwrap_or(false) => ProfileUpdateProxyMode::Clash,
        Some(option) if option.with_proxy.unwrap_or(false) => ProfileUpdateProxyMode::System,
        _ => ProfileUpdateProxyMode::Direct,
    }
}

fn set_profile_update_proxy_mode(option: &mut PrfOption, mode: ProfileUpdateProxyMode) {
    match mode {
        ProfileUpdateProxyMode::Direct => {
            option.self_proxy = Some(false);
            option.with_proxy = Some(false);
        }
        ProfileUpdateProxyMode::Clash => {
            option.self_proxy = Some(true);
            option.with_proxy = Some(false);
        }
        ProfileUpdateProxyMode::System => {
            option.self_proxy = Some(false);
            option.with_proxy = Some(true);
        }
    }
}

fn profile_update_attempts(initial_mode: ProfileUpdateProxyMode) -> Vec<ProfileUpdateProxyMode> {
    let mut attempts = vec![initial_mode];

    for mode in [ProfileUpdateProxyMode::Clash, ProfileUpdateProxyMode::System] {
        if !attempts.contains(&mode) {
            attempts.push(mode);
        }
    }

    if initial_mode != ProfileUpdateProxyMode::Direct {
        attempts.push(ProfileUpdateProxyMode::Direct);
    }

    attempts
}

/// Toggle proxy profile
pub async fn toggle_proxy_profile(profile_index: String) {
    logging_error!(
        Type::Config,
        cmd::patch_profiles_config_by_profile_index(profile_index).await
    );
}

pub async fn switch_proxy_node(group_name: &str, proxy_name: &str) {
    match handle::Handle::mihomo()
        .await
        .select_node_for_group(group_name, proxy_name)
        .await
    {
        Ok(_) => {
            logging!(info, Type::Tray, "切换代理成功: {} -> {}", group_name, proxy_name);
            let _ = handle::Handle::app_handle().emit("verge://refresh-proxy-config", ());
            let _ = tray::Tray::global().update_menu().await;
            return;
        }
        Err(err) => {
            logging!(
                error,
                Type::Tray,
                "切换代理失败: {} -> {}, 错误: {:?}",
                group_name,
                proxy_name,
                err
            );
        }
    }

    match handle::Handle::mihomo()
        .await
        .select_node_for_group(group_name, proxy_name)
        .await
    {
        Ok(_) => {
            logging!(info, Type::Tray, "代理切换回退成功: {} -> {}", group_name, proxy_name);
            let _ = tray::Tray::global().update_menu().await;
        }
        Err(err) => {
            logging!(
                error,
                Type::Tray,
                "代理切换最终失败: {} -> {}, 错误: {:?}",
                group_name,
                proxy_name,
                err
            );
        }
    }
}

async fn should_update_profile(uid: &String, ignore_auto_update: bool) -> Result<Option<(String, Option<PrfOption>)>> {
    let profiles = Config::profiles().await;
    let profiles = profiles.latest_arc();
    let item = profiles.get_item(uid)?;
    let is_remote = item.itype.as_ref().is_some_and(|s| s == "remote");

    if !is_remote {
        logging!(info, Type::Config, "[订阅更新] {uid} 不是远程订阅，跳过更新");
        Ok(None)
    } else if item.url.is_none() {
        logging!(warn, Type::Config, "Warning: [订阅更新] {uid} 缺少URL，无法更新");
        bail!("failed to get the profile item url");
    } else if !ignore_auto_update && !item.option.as_ref().and_then(|o| o.allow_auto_update).unwrap_or(true) {
        logging!(info, Type::Config, "[订阅更新] {} 禁止自动更新，跳过更新", uid);
        Ok(None)
    } else {
        logging!(
            info,
            Type::Config,
            "[订阅更新] {} 是远程订阅，URL: {}",
            uid,
            mask_url(
                item.url
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Profile URL is None"))?
            )
        );
        Ok(Some((
            item.url.clone().ok_or_else(|| anyhow::anyhow!("Profile URL is None"))?,
            item.option.clone(),
        )))
    }
}

async fn perform_profile_update(
    uid: &String,
    url: &String,
    opt: Option<&PrfOption>,
    option: Option<&PrfOption>,
    is_mannual_trigger: bool,
) -> Result<bool> {
    logging!(info, Type::Config, "[订阅更新] 开始下载新的订阅内容");
    let mut merged_opt = PrfOption::merge(opt, option);
    let initial_mode = profile_update_proxy_mode(merged_opt.as_ref());
    let is_current = {
        let profiles = Config::profiles().await;
        profiles.latest_arc().is_current_profile_index(uid)
    };
    let profiles = Config::profiles().await;
    let profiles_arc = profiles.latest_arc();
    let profile_name = profiles_arc
        .get_name_by_uid(uid)
        .cloned()
        .unwrap_or_else(|| String::from("UnKnown Profile"));

    let mut last_err = None;

    for mode in profile_update_attempts(initial_mode) {
        set_profile_update_proxy_mode(merged_opt.get_or_insert_with(PrfOption::default), mode);

        match PrfItem::from_url(url, None, None, merged_opt.as_ref()).await {
            Ok(mut item) => {
                logging!(info, Type::Config, "[订阅更新] 使用 {} 更新订阅配置成功", mode.label());
                profiles_draft_update_item_safe(uid, &mut item).await?;
                if mode != initial_mode {
                    handle::Handle::notice_message(
                        "update_with_fallback",
                        format!("{profile_name} - updated with {}", mode.label()),
                    );
                }
                return Ok(is_current);
            }
            Err(err) => {
                logging!(
                    warn,
                    Type::Config,
                    "Warning: [订阅更新] 使用 {} 更新失败: {}",
                    mode.label(),
                    mask_err(&err.to_string())
                );
                last_err = Some(err);
            }
        }
    }

    if is_mannual_trigger {
        let last_err = last_err
            .map(|err| err.to_string())
            .unwrap_or_else(|| "unknown error".into());
        handle::Handle::notice_message("update_failed_after_fallback", format!("{profile_name} - {last_err}"));
    }
    Ok(is_current)
}

#[cfg(test)]
mod tests {
    use super::{
        ProfileUpdateProxyMode, profile_update_attempts, profile_update_proxy_mode, set_profile_update_proxy_mode,
    };
    use crate::config::PrfOption;

    #[test]
    fn direct_updates_still_fallback_to_proxies() {
        assert_eq!(
            profile_update_attempts(ProfileUpdateProxyMode::Direct),
            vec![
                ProfileUpdateProxyMode::Direct,
                ProfileUpdateProxyMode::Clash,
                ProfileUpdateProxyMode::System,
            ]
        );
    }

    #[test]
    fn clash_proxy_updates_fallback_to_system_then_direct() {
        assert_eq!(
            profile_update_attempts(ProfileUpdateProxyMode::Clash),
            vec![
                ProfileUpdateProxyMode::Clash,
                ProfileUpdateProxyMode::System,
                ProfileUpdateProxyMode::Direct,
            ]
        );
    }

    #[test]
    fn system_proxy_updates_fallback_to_clash_then_direct() {
        assert_eq!(
            profile_update_attempts(ProfileUpdateProxyMode::System),
            vec![
                ProfileUpdateProxyMode::System,
                ProfileUpdateProxyMode::Clash,
                ProfileUpdateProxyMode::Direct,
            ]
        );
    }

    #[test]
    fn proxy_mode_round_trips_through_profile_options() {
        let mut option = PrfOption::default();

        set_profile_update_proxy_mode(&mut option, ProfileUpdateProxyMode::Clash);
        assert_eq!(profile_update_proxy_mode(Some(&option)), ProfileUpdateProxyMode::Clash);

        set_profile_update_proxy_mode(&mut option, ProfileUpdateProxyMode::System);
        assert_eq!(profile_update_proxy_mode(Some(&option)), ProfileUpdateProxyMode::System);

        set_profile_update_proxy_mode(&mut option, ProfileUpdateProxyMode::Direct);
        assert_eq!(profile_update_proxy_mode(Some(&option)), ProfileUpdateProxyMode::Direct);
    }
}

pub async fn update_profile(
    uid: &String,
    option: Option<&PrfOption>,
    auto_refresh: bool,
    ignore_auto_update: bool,
    is_mannual_trigger: bool,
) -> Result<()> {
    logging!(info, Type::Config, "[订阅更新] 开始更新订阅 {}", uid);
    let url_opt = should_update_profile(uid, ignore_auto_update).await?;

    let should_refresh = match url_opt {
        Some((url, opt)) => {
            perform_profile_update(uid, &url, opt.as_ref(), option, is_mannual_trigger).await? && auto_refresh
        }
        None => auto_refresh,
    };

    if should_refresh {
        logging!(info, Type::Config, "[订阅更新] 更新内核配置");
        match CoreManager::global().update_config_with_force(is_mannual_trigger).await {
            Ok(outcome) if outcome.is_valid() => {
                logging!(info, Type::Config, "[订阅更新] 更新成功");
                handle::Handle::refresh_clash();
            }
            Ok(outcome @ (ValidationOutcome::Skipped { .. } | ValidationOutcome::Busy)) if !is_mannual_trigger => {
                logging!(info, Type::Config, "[订阅更新] 本次配置刷新已跳过: {}", outcome);
            }
            Ok(outcome) => {
                let message = outcome.to_string();
                logging!(error, Type::Config, "[订阅更新] 更新失败: {}", message);
                handle::Handle::notice_message("update_failed", message);
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
pub async fn enhance_profiles() -> Result<ValidationOutcome> {
    CoreManager::global().update_config_forced().await
}
