use crate::core::notify::NoticeStatus;
use crate::core::notify::{Refresh, announce};
use crate::{
    cmd,
    config::{Config, PrfItem, PrfOption, profiles::profiles_update_item_safe},
    core::{CoreManager, handle, tray, validate::ValidationOutcome},
    utils::help::{mask_err, mask_url},
};
use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging, logging_error};
use smartstring::alias::String;

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

/// Tell the profile which node this group is on now.
///
/// The core is already switched by the time this runs, so failing to record is not a reason to
/// report the switch as failed — but it is worth a log line, because what the profile holds is
/// what gets re-applied the next time a core starts.
async fn record_switched_node(group_name: &str, proxy_name: &str) {
    if let Err(error) = crate::config::profiles::record_selected_node(group_name, proxy_name).await {
        logging!(
            warn,
            Type::Config,
            "切换代理成功但未能记录到配置: {} -> {}, 错误: {error:#}",
            group_name,
            proxy_name
        );
    }
}

pub async fn switch_proxy_node(group_name: &str, proxy_name: &str) {
    match handle::Handle::mihomo()
        .select_node_for_group(group_name, proxy_name)
        .await
    {
        Ok(_) => {
            record_switched_node(group_name, proxy_name).await;
            announce(Refresh::Proxies);
            let _ = tray::Tray::global().update_menu().await;
            return;
        }
        Err(err) => {
            logging!(error, Type::Tray, "切换代理失败: {err:?}");
        }
    }

    match handle::Handle::mihomo()
        .select_node_for_group(group_name, proxy_name)
        .await
    {
        Ok(_) => {
            logging!(info, Type::Tray, "代理切换回退成功: {} -> {}", group_name, proxy_name);
            record_switched_node(group_name, proxy_name).await;
            let _ = tray::Tray::global().update_menu().await;
        }
        Err(err) => {
            logging!(error, Type::Tray, "代理切换最终失败: {err:?}");
        }
    }
}

async fn should_update_profile(uid: &String, ignore_auto_update: bool) -> Result<Option<(String, Option<PrfOption>)>> {
    let profiles = Config::profiles().await;
    let profiles = profiles.data_arc();
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
    uid: &String,
    url: &String,
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
pub async fn update_profile(uid: &String, option: Option<&PrfOption>, is_mannual_trigger: bool) -> Result<()> {
    let url_opt = should_update_profile(uid, is_mannual_trigger).await?;

    let profile_persisted = match url_opt {
        Some((url, opt)) => {
            perform_profile_update(uid, &url, opt.as_ref(), option, is_mannual_trigger).await?;
            true
        }
        None => false,
    };
    let profiles = Config::profiles().await;
    let is_current = profiles.latest_arc().current.as_ref() == Some(uid);
    let should_refresh = is_current || (!profile_persisted && is_mannual_trigger);

    if should_refresh {
        logging!(debug, Type::Config, "[订阅更新] 更新内核配置");
        match CoreManager::global().update_config_with_force(is_mannual_trigger).await {
            Ok(outcome) if outcome.is_valid() => {
                logging_error!(Type::Config, Config::sync_dns_override().await);
                announce(Refresh::Clash);
            }
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
    let outcome = CoreManager::global().update_config_forced().await?;
    if outcome.is_valid() {
        logging_error!(Type::Config, Config::sync_dns_override().await);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{IProfiles, profiles::profiles_patch_item_safe},
        utils::{dirs, help},
    };
    use age::secrecy::ExposeSecret as _;
    use std::io::{Read as _, Write as _};
    use tokio::fs;

    #[tokio::test]
    #[ignore = "requires HOME and CLASH_VERGE_TEST_HOME pointing to a disposable directory"]
    #[allow(clippy::unwrap_used, clippy::expect_used, reason = "tests assert by panicking")]
    async fn age_subscription_selects_committed_key_while_switch_draft_is_pending() -> Result<()> {
        let test_root = std::env::var("CLASH_VERGE_TEST_HOME")?;
        assert!(!test_root.is_empty());
        assert!(dirs::app_home_dir()?.starts_with(&test_root));
        fs::create_dir_all(dirs::app_profiles_dir()?).await?;
        let cache_path = dirs::app_profiles_dir()?.join("age-selection.yaml");
        fs::write(&cache_path, "proxies: []\n").await?;

        let original = age::x25519::Identity::generate();
        let replacement = age::x25519::Identity::generate();
        let stale_option = PrfOption {
            age_secret_key: Some(original.to_string().expose_secret().into()),
            merge: Some("m".into()),
            script: Some("s".into()),
            rules: Some("r".into()),
            proxies: Some("p".into()),
            groups: Some("g".into()),
            ..PrfOption::default()
        };
        let uid: String = "age-selection".into();
        let profiles = Config::profiles().await;
        for current_key in [None, Some(replacement.to_string())] {
            let recipient = if current_key.is_none() { &original } else { &replacement }.to_public();
            let encryptor = age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))?;
            let armor = age::armor::ArmoredWriter::wrap_output(Vec::new(), age::armor::Format::AsciiArmor)?;
            let mut writer = encryptor.wrap_output(armor)?;
            writer.write_all(b"proxies: []\nrules: []\n")?;
            let body = writer.finish()?.finish()?;
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            let url: String = format!("http://{}/profile.yaml", listener.local_addr()?).into();
            let server = std::thread::spawn(move || -> std::io::Result<()> {
                let (mut socket, _) = listener.accept()?;
                let mut request = [0; 4096];
                let _ = socket.read(&mut request)?;
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )?;
                socket.write_all(&body)
            });
            profiles.discard();
            profiles
                .with_data_modify(|_| async {
                    Ok((
                        IProfiles {
                            current: None,
                            items: Some(vec![PrfItem {
                                uid: Some(uid.clone()),
                                itype: Some("remote".into()),
                                file: Some("age-selection.yaml".into()),
                                url: Some(url.clone()),
                                option: Some(stale_option.clone()),
                                ..PrfItem::default()
                            }]),
                        },
                        (),
                    ))
                })
                .await?;
            profiles.edit_draft(|_| {});
            profiles_patch_item_safe(
                &uid,
                &PrfItem {
                    option: Some(PrfOption {
                        age_secret_key: Some(current_key.as_ref().map(|key| key.expose_secret()).unwrap_or("").into()),
                        ..stale_option.clone()
                    }),
                    ..PrfItem::default()
                },
            )
            .await?;
            assert_eq!(profiles.latest_arc().get_item(&uid)?.option, Some(stale_option.clone()));
            let persisted: IProfiles = help::read_yaml(&dirs::profiles_path()?).await?;
            let (selected_url, selected_option) = should_update_profile(&uid, false).await?.unwrap();
            assert_eq!(selected_option, persisted.get_item(&uid)?.option);
            let options = PrfOption::merge(selected_option.as_ref(), Some(&stale_option));
            let metadata = fs::read(dirs::profiles_path()?).await?;
            let cache = fs::read(&cache_path).await?;
            let downloaded = PrfItem::from_url(&selected_url, None, None, options.as_ref()).await;
            server.join().expect("fixture server panicked")?;
            if current_key.is_none() {
                assert_eq!(
                    downloaded.unwrap_err().to_string(),
                    "an age secret key is required for this subscription"
                );
            } else {
                assert_eq!(downloaded?.file_data.as_deref(), Some("proxies: []\nrules: []\n"));
            }
            assert_eq!(fs::read(dirs::profiles_path()?).await?, metadata);
            assert_eq!(fs::read(&cache_path).await?, cache);
        }
        profiles.discard();
        Ok(())
    }
}
