use crate::core::notify::NoticeStatus;
use crate::core::notify::{Refresh, announce};
use crate::{
    cmd,
    config::{Config, PrfItem, PrfOption, profiles::profiles_update_item_safe},
    core::{CoreManager, handle, tray, validate::ValidationOutcome},
    process::AsyncHandler,
    utils::help::{mask_err, mask_url},
};
use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging};
use tauri_plugin_mihomo::models::ProxyType;
use tristr::alias::String;

/// Toggle proxy profile
pub async fn toggle_proxy_profile(profile_index: String) {
    if let Err(err) = cmd::patch_profiles_config_by_profile_index(profile_index.clone()).await {
        logging!(
            error,
            Type::Config,
            "toggle proxy profile {profile_index} failed: {err}"
        );
    }
}

/// First `select` group in config order that lists `group_name`, when that group is `url-test` or `fallback`.
fn parent_selector<'a>(groups: &'a [serde_yaml_ng::Value], group_name: &str) -> Option<&'a str> {
    let field = |group: &'a serde_yaml_ng::Value, key: &str| group.get(key)?.as_str();
    let group = groups.iter().find(|group| field(group, "name") == Some(group_name))?;
    if !matches!(field(group, "type"), Some("url-test" | "fallback")) {
        return None;
    }
    groups
        .iter()
        .filter(|group| field(group, "type") == Some("select"))
        .filter(|group| {
            group
                .get("proxies")
                .and_then(|members| members.as_sequence())
                .is_some_and(|members| members.iter().any(|member| member.as_str() == Some(group_name)))
        })
        .filter_map(|group| field(group, "name"))
        .find(|name| *name != "GLOBAL")
}

/// Rule traffic enters through `select` groups, so a pick inside a `url-test`/`fallback` group only
/// carries traffic once the first `select` group listing that group points at it.
/// Returns the node that group left.
async fn follow_group_selection(group_name: &str) -> Option<std::string::String> {
    if !Config::verge()
        .await
        .data_arc()
        .auto_switch_selector_group
        .unwrap_or(true)
    {
        return None;
    }
    if Config::clash()
        .await
        .data_arc()
        .get_mode()
        .is_some_and(|mode| mode != "rule")
    {
        return None;
    }
    let selector = {
        let runtime = Config::runtime().await.latest_arc();
        let groups = runtime.config.as_ref()?.get("proxy-groups")?.as_sequence()?;
        parent_selector(groups, group_name)?.to_owned()
    };

    let mihomo = handle::Handle::mihomo();
    let current = mihomo.get_proxy_by_name(&selector).await.ok()?;
    // The runtime config can lag the core, which alone knows what this group is now.
    if current.proxy_type != ProxyType::Selector {
        return None;
    }
    let previous = current.now?;
    if previous == group_name {
        return None;
    }
    if let Err(err) = mihomo.select_node_for_group(&selector, group_name).await {
        logging!(warn, Type::Core, "Failed to point {selector} at {group_name}: {err:#}");
        return None;
    }
    if let Err(error) = crate::config::profiles::record_selected_node(&selector, group_name).await {
        logging!(
            warn,
            Type::Config,
            "Failed to persist proxy selection for {selector}: {error:#}"
        );
    }
    Some(previous)
}

pub async fn switch_proxy_node(group_name: &str, proxy_name: &str, unfix: bool) -> Result<()> {
    let mihomo = handle::Handle::mihomo();
    let auto_close = Config::verge().await.data_arc().auto_close_connection.unwrap_or(false);
    let previous_proxy = if auto_close {
        match mihomo.get_proxy_by_name(group_name).await {
            Ok(group) => group.now.filter(|name| !name.is_empty()),
            Err(err) => {
                logging!(
                    warn,
                    Type::Core,
                    "Failed to read previous proxy selection for {group_name}: {err}"
                );
                None
            }
        }
    } else {
        None
    };
    if unfix {
        mihomo.unfixed_proxy(group_name).await?;
    } else {
        mihomo.select_node_for_group(group_name, proxy_name).await?;
    }

    let save_result = if unfix {
        crate::config::profiles::forget_selected_node(group_name).await
    } else {
        crate::config::profiles::record_selected_node(group_name, proxy_name).await
    };
    // The core selection is already applied; persistence failure must not report it as failed.
    if let Err(error) = save_result {
        logging!(
            warn,
            Type::Config,
            "Failed to persist proxy selection for {group_name}: {error:#}"
        );
    }
    let mut stale_proxies: Vec<_> = previous_proxy.into_iter().collect();
    if !unfix
        && let Some(left) = follow_group_selection(group_name).await
        && auto_close
    {
        stale_proxies.push(left);
    }
    announce(Refresh::Proxies);

    if !stale_proxies.is_empty() {
        AsyncHandler::spawn(move || async move {
            let connections = match mihomo.get_connections().await {
                Ok(connections) => connections,
                Err(err) => {
                    logging!(
                        warn,
                        Type::Core,
                        "Failed to read connections after switching proxy: {err}"
                    );
                    return;
                }
            };
            futures::future::join_all(
                connections
                    .connections
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|connection| stale_proxies.iter().any(|proxy| connection.chains.contains(proxy)))
                    .map(|connection| async move {
                        if let Err(err) = mihomo.close_connection(&connection.id).await {
                            logging!(
                                warn,
                                Type::Core,
                                "Failed to close connection {} after switching proxy: {err}",
                                connection.id
                            );
                        }
                    }),
            )
            .await;
        });
    }
    if let Err(err) = tray::Tray::global().update_menu().await {
        logging!(
            warn,
            Type::Tray,
            "Failed to refresh tray after switching proxy: {err:#}"
        );
    }
    Ok(())
}

async fn should_update_profile(uid: &str, ignore_auto_update: bool) -> Result<Option<(String, Option<PrfOption>)>> {
    let profiles = Config::profiles().await;
    let profiles = profiles.latest_arc();
    let item = profiles.get_item(uid)?;
    let is_remote = item.itype.as_ref().is_some_and(|s| s == "remote");

    if !is_remote {
        logging!(info, Type::Config, "[订阅更新] 不是远程订阅，跳过更新");
        Ok(None)
    } else if item.url.is_none() {
        logging!(warn, Type::Config, "[订阅更新] 缺少URL，无法更新");
        bail!("failed to get the profile item url");
    } else if !ignore_auto_update && !item.option.as_ref().and_then(|o| o.allow_auto_update).unwrap_or(true) {
        logging!(info, Type::Config, "[订阅更新] 禁止自动更新，跳过更新");
        Ok(None)
    } else {
        logging!(
            info,
            Type::Config,
            "[订阅更新] 远程订阅，URL: {}",
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

#[tracing::instrument(skip_all, level = "info", fields(uid = %uid, strategy = tracing::field::Empty, configured_elapsed = tracing::field::Empty, clash_elapsed = tracing::field::Empty, system_elapsed = tracing::field::Empty))]
async fn perform_profile_update(
    uid: &str,
    url: &str,
    opt: Option<&PrfOption>,
    option: Option<&PrfOption>,
    is_mannual_trigger: bool,
) -> Result<()> {
    let merged_opt = PrfOption::merge(opt, option);
    let profiles = Config::profiles().await;
    let profiles_arc = profiles.latest_arc();
    let profile_name = profiles_arc
        .get_item(uid)
        .ok()
        .and_then(|item| item.name.clone())
        .unwrap_or_else(|| String::from("UnKnown Profile"));

    #[derive(Clone, Copy)]
    enum Strategy {
        Configured,
        Clash,
        System,
    }

    let result =
        crate::utils::retry::try_strategies(Strategy::Configured, [Strategy::Clash, Strategy::System], |strategy| {
            let mut options = merged_opt.clone();
            async move {
                let (name, success, failure) = match strategy {
                    Strategy::Configured => (
                        "configured",
                        "[订阅更新] 更新订阅配置成功",
                        "[订阅更新] 直接更新失败: {}，尝试使用Clash代理更新",
                    ),
                    Strategy::Clash => (
                        "clash",
                        "[订阅更新] 使用 Clash代理 更新订阅配置成功",
                        "[订阅更新] Clash代理更新失败: {}，尝试使用系统代理更新",
                    ),
                    Strategy::System => (
                        "system",
                        "[订阅更新] 使用 系统代理 更新订阅配置成功",
                        "[订阅更新] 系统代理更新失败: {}，所有重试均已失败",
                    ),
                };
                match strategy {
                    Strategy::Configured => {}
                    Strategy::Clash | Strategy::System => {
                        let option = options.get_or_insert_with(PrfOption::default);
                        option.self_proxy = Some(matches!(strategy, Strategy::Clash));
                        option.with_proxy = Some(matches!(strategy, Strategy::System));
                    }
                }
                tracing::Span::current().record("strategy", name);
                let started = std::time::Instant::now();
                let result = PrfItem::from_url(url, None, None, options.as_ref()).await;
                let elapsed_field = match strategy {
                    Strategy::Configured => "configured_elapsed",
                    Strategy::Clash => "clash_elapsed",
                    Strategy::System => "system_elapsed",
                };
                tracing::Span::current().record(elapsed_field, tracing::field::debug(started.elapsed()));
                match &result {
                    Ok(_) => logging!(info, Type::Config, "{success}"),
                    Err(error) => logging!(
                        warn,
                        Type::Config,
                        "{}",
                        failure.replace("{}", &mask_err(&format!("{error:#}")))
                    ),
                }
                result
            }
        })
        .await;
    let last_err = match result {
        Ok((strategy, mut item)) => {
            // A persistence error must not replay a successful download with another transport.
            profiles_update_item_safe(uid, &mut item).await?;
            if !matches!(strategy, Strategy::Configured) {
                handle::Handle::notice(NoticeStatus::UpdateWithClashProxy, profile_name.as_str());
            }
            return Ok(());
        }
        Err(error) => error,
    };

    let last_err = mask_err(&last_err.to_string());
    if is_mannual_trigger {
        handle::Handle::notice(
            NoticeStatus::UpdateFailedEvenWithClash,
            format!("{profile_name} - {last_err}"),
        );
    }
    bail!(last_err)
}

#[tracing::instrument(skip_all, level = "info", fields(uid = %uid, manual = is_mannual_trigger))]
pub async fn update_profile(uid: &str, option: Option<&PrfOption>, is_mannual_trigger: bool) -> Result<()> {
    let url_opt = should_update_profile(uid, is_mannual_trigger).await?;

    let profile_persisted = match url_opt {
        Some((url, opt)) => {
            perform_profile_update(uid, &url, opt.as_ref(), option, is_mannual_trigger).await?;
            true
        }
        None => false,
    };
    let profiles = Config::profiles().await;
    let is_current = profiles.latest_arc().current.as_deref() == Some(uid);
    let should_refresh = is_current || (!profile_persisted && is_mannual_trigger);

    if should_refresh {
        logging!(debug, Type::Config, "[订阅更新] 更新内核配置");
        match CoreManager::global().update_config_with_force(is_mannual_trigger).await {
            Ok(outcome) if outcome.is_valid() => announce(Refresh::Clash),
            Ok(outcome @ (ValidationOutcome::Skipped { .. } | ValidationOutcome::Busy)) if !is_mannual_trigger => {
                logging!(info, Type::Config, "[订阅更新] 本次配置刷新已跳过: {}", outcome);
            }
            result => {
                let message = match result {
                    Ok(outcome) => outcome.to_string(),
                    Err(err) => err.to_string(),
                };
                let message = mask_err(&message);
                let message = if profile_persisted {
                    format!("订阅已保存，但未能确认已应用到内核: {message}")
                } else {
                    message
                };
                logging!(error, Type::Config, "[订阅更新] 更新失败: {}", message);
                handle::Handle::notice(NoticeStatus::UpdateFailed, message.as_str());
                bail!(message);
            }
        }
    }

    Ok(())
}

/// 增强配置
pub async fn enhance_profiles() -> Result<ValidationOutcome> {
    CoreManager::global().update_config_forced().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_first_select_group_follows_an_auto_group() -> Result<()> {
        let groups: Vec<serde_yaml_ng::Value> = serde_yaml_ng::from_str(
            "
- { name: GLOBAL, type: select, proxies: [Auto, Proxy, Direct] }
- { name: Auto, type: url-test, proxies: [Node] }
- { name: Proxy, type: select, proxies: [Auto, Node] }
- { name: Direct, type: select, proxies: [DIRECT, Auto] }
",
        )?;

        assert_eq!(parent_selector(&groups, "Auto"), Some("Proxy"));
        assert_eq!(parent_selector(&groups, "Proxy"), None);
        Ok(())
    }
}
