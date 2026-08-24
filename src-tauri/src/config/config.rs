use super::{IClashTemp, IProfiles, IVerge, MixedPort};
use crate::{
    config::{PrfItem, profiles_append_item_to_safe, runtime::IRuntime},
    constants::{files, timing},
    core::{
        CoreManager,
        handle::{self, Handle},
        listener::MIXED_PORT_KEY,
        tray,
        validate::CoreConfigValidator,
    },
    enhance,
    process::AsyncHandler,
    utils::{dirs, help},
};
use anyhow::{Result, anyhow};
use backon::{ExponentialBuilder, Retryable as _};
use clash_verge_draft::Draft;
use clash_verge_logging::{Type, logging, logging_error};
use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};
use tokio::sync::{Mutex, MutexGuard, OnceCell};
use tokio::time::sleep;

pub struct Config {
    clash_config: Draft<IClashTemp>,
    verge_config: Draft<IVerge>,
    profiles_config: Draft<IProfiles>,
    runtime_config: Draft<IRuntime>,
}

static TUN_SESSION_SUPPRESSED: AtomicBool = AtomicBool::new(false);
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::const_new(());

impl Config {
    pub async fn global() -> &'static Self {
        static CONFIG: OnceCell<Config> = OnceCell::const_new();
        CONFIG
            .get_or_init(|| async {
                Self {
                    clash_config: Draft::new(IClashTemp::new().await),
                    verge_config: Draft::new(IVerge::new().await),
                    profiles_config: Draft::new(IProfiles::new().await),
                    runtime_config: Draft::new(IRuntime::default()),
                }
            })
            .await
    }

    pub async fn clash() -> Draft<IClashTemp> {
        Self::global().await.clash_config.clone()
    }

    pub async fn verge() -> Draft<IVerge> {
        Self::global().await.verge_config.clone()
    }

    pub async fn profiles() -> Draft<IProfiles> {
        Self::global().await.profiles_config.clone()
    }

    pub async fn runtime() -> Draft<IRuntime> {
        Self::global().await.runtime_config.clone()
    }

    /// Serializes transactions sharing configuration draft layers.
    pub(crate) async fn lock_config_write() -> MutexGuard<'static, ()> {
        CONFIG_WRITE_LOCK.lock().await
    }

    pub async fn init_config_before_window() -> Result<()> {
        Self::ensure_default_profile_items().await?;

        let verge = Self::verge().await.latest_arc();
        clash_verge_i18n::sync_locale(verge.language.as_deref());

        Ok(())
    }

    pub fn tun_suppressed_for_session() -> bool {
        TUN_SESSION_SUPPRESSED.load(Ordering::Acquire)
    }

    pub(crate) async fn suppress_tun_for_session() {
        TUN_SESSION_SUPPRESSED.store(true, Ordering::Release);
        Handle::refresh_verge();
        let _ = tray::Tray::global().update_menu().await;
    }

    pub(crate) async fn restore_tun_for_session() {
        TUN_SESSION_SUPPRESSED.store(false, Ordering::Release);
        Handle::refresh_verge();
        let _ = tray::Tray::global().update_menu().await;
    }

    pub(crate) async fn disable_tun_and_persist() -> Result<()> {
        TUN_SESSION_SUPPRESSED.store(false, Ordering::Release);
        let verge = Self::verge().await;
        verge.edit_draft(|draft| {
            draft.enable_tun_mode = Some(false);
        });
        verge.apply();
        verge.data_arc().save_file().await?;
        Handle::refresh_verge();
        let _ = tray::Tray::global().update_menu().await;
        Ok(())
    }

    pub async fn init_runtime_config() -> Result<()> {
        let fallback_applied = match Self::resolve_startup_mixed_port().await {
            Ok(applied) => applied,
            Err(error) => {
                Self::block_startup_core(&error);
                return Err(error);
            }
        };
        let validation_result = if fallback_applied {
            None
        } else {
            Self::generate_and_validate().await?
        };

        if let Some((msg_type, msg_content)) = validation_result {
            sleep(timing::STARTUP_ERROR_DELAY).await;
            handle::Handle::notice_message(msg_type, msg_content);
        }

        Self::runtime().await.apply();

        {
            let profiles = Self::profiles().await.data_arc();
            let _ = profiles.cleanup_orphaned_files().await;
        }

        Ok(())
    }

    async fn ensure_default_profile_items() -> Result<()> {
        let profiles = Self::profiles().await;
        Self::ensure_default_profile_items_for(&profiles).await
    }

    async fn ensure_default_profile_items_for(profiles: &Draft<IProfiles>) -> Result<()> {
        if profiles.latest_arc().items.is_none() {
            logging!(
                warn,
                Type::Config,
                "Profile items 无法加载，跳过默认项初始化以保留现有配置文件"
            );
            return Ok(());
        }

        if profiles.latest_arc().get_item("Merge").is_err() {
            let merge_item = &mut PrfItem::from_merge(Some("Merge".into()));
            profiles_append_item_to_safe(profiles, merge_item).await?;
        }
        if profiles.latest_arc().get_item("Script").is_err() {
            let script_item = &mut PrfItem::from_script(Some("Script".into()));
            profiles_append_item_to_safe(profiles, script_item).await?;
        }
        Ok(())
    }

    async fn generate_and_validate() -> Result<Option<(&'static str, String)>> {
        if let Err(err) = Self::generate().await {
            let error_msg: String = err.to_string().into();
            logging!(error, Type::Config, "生成运行时配置失败: {}", error_msg);
            CoreManager::global()
                .use_default_config("config_validate::boot_error", &error_msg)
                .await?;
            return Ok(Some(("config_validate::boot_error", error_msg)));
        }
        logging!(info, Type::Config, "生成运行时配置成功");

        let config_result = Self::generate_file(ConfigType::Run).await;

        if config_result.is_ok() {
            logging!(info, Type::Config, "开始验证配置");

            match CoreConfigValidator::global().validate_config_outcome().await {
                Ok(outcome) if outcome.is_valid() => {
                    logging!(info, Type::Config, "配置验证成功");
                    Ok(None)
                }
                Ok(outcome) => {
                    let error_msg: String = outcome.to_string().into();
                    logging!(
                        warn,
                        Type::Config,
                        "[首次启动] 配置验证未通过，使用默认最小配置启动: {}",
                        error_msg
                    );
                    CoreManager::global()
                        .use_default_config("config_validate::boot_error", &error_msg)
                        .await?;
                    Ok(Some(("config_validate::boot_error", error_msg)))
                }
                Err(err) => {
                    logging!(warn, Type::Config, "验证过程执行失败: {}", err);
                    CoreManager::global()
                        .use_default_config("config_validate::process_terminated", "")
                        .await?;
                    Ok(Some(("config_validate::process_terminated", String::new())))
                }
            }
        } else {
            logging!(warn, Type::Config, "生成配置文件失败，使用默认配置");
            CoreManager::global()
                .use_default_config("config_validate::error", "")
                .await?;
            Ok(Some(("config_validate::error", String::new())))
        }
    }

    pub async fn generate_file(typ: ConfigType) -> Result<PathBuf> {
        let path = match typ {
            ConfigType::Run => dirs::app_home_dir()?.join(files::RUNTIME_CONFIG),
            ConfigType::Check => dirs::app_home_dir()?.join(files::CHECK_CONFIG),
        };

        let runtime = Self::runtime().await;
        let runtime_lastest = runtime.latest_arc();
        let runtime_data = runtime.data_arc();
        let config = runtime_lastest
            .config
            .as_ref()
            .or_else(|| runtime_data.config.as_ref())
            .ok_or_else(|| anyhow!("failed to generate runtime config, might need to restart application"))?;

        help::save_yaml(&path, config, Some("# Generated by Clash Verge")).await?;
        Ok(path)
    }

    pub async fn generate() -> Result<()> {
        let profiles = Self::profiles().await.latest_arc();
        Self::generate_with_profiles(&profiles).await
    }

    pub(crate) async fn generate_with_profiles(profiles: &IProfiles) -> Result<()> {
        let (mut config, exists_keys, logs) = enhance::enhance(profiles).await?;

        sanitize_tunnels_proxy(&mut config);
        // Apply only to generated core config so the saved choice survives the next launch.
        if let Some(port) = MixedPort::session_fallback() {
            config.insert(MIXED_PORT_KEY.into(), port.into());
        }

        Self::runtime().await.edit_draft(|d| {
            *d = IRuntime {
                config: Some(config),
                exists_keys,
                chain_logs: logs,
            }
        });

        Ok(())
    }

    pub async fn verify_config_initialization() {
        if Self::startup_core_block_reason().is_some() {
            return;
        }

        let backoff = ExponentialBuilder::default()
            .with_min_delay(std::time::Duration::from_millis(100))
            .with_max_delay(std::time::Duration::from_secs(2))
            .with_factor(2.0)
            .with_max_times(10);

        if let Err(e) = (|| async {
            if Self::runtime().await.latest_arc().config.is_some() {
                return Ok::<(), anyhow::Error>(());
            }
            Self::generate().await
        })
        .retry(backoff)
        .await
        {
            logging!(error, Type::Setup, "Config init verification failed: {}", e);
        }
    }

    /// Commits drafts during exit/restart/shutdown so user changes are not lost.
    pub async fn apply_all_and_save_file() {
        logging!(info, Type::Config, "save all draft data");
        let save_clash_task = AsyncHandler::spawn(|| async {
            let clash = Self::clash().await;
            clash.apply();
            logging_error!(Type::Config, clash.data_arc().save_config().await);
        });

        let save_verge_task = AsyncHandler::spawn(|| async {
            let verge = Self::verge().await;
            verge.apply();
            logging_error!(Type::Config, verge.data_arc().save_file().await);
        });

        let save_profiles_task = AsyncHandler::spawn(|| async {
            let _profile_write = super::profiles::PROFILE_WRITE_LOCK.lock().await;
            let profiles = Self::profiles().await;
            profiles.apply();
            logging_error!(Type::Config, profiles.data_arc().save_file().await);
        });

        let _ = tokio::join!(save_clash_task, save_verge_task, save_profiles_task);
        logging!(info, Type::Config, "save all draft data finished");
    }
}

fn sanitize_tunnels_proxy(config: &mut Mapping) {
    if !config
        .get("tunnels")
        .and_then(|v| v.as_sequence())
        .is_some_and(|t| tunnels_need_validation(t))
    {
        return;
    }

    let mut valid: HashSet<String> = HashSet::with_capacity(64);
    collect_names(config, "proxies", &mut valid);
    collect_names(config, "proxy-groups", &mut valid);

    valid.insert("DIRECT".into());
    valid.insert("REJECT".into());

    let Some(tunnels) = config.get_mut("tunnels").and_then(|v| v.as_sequence_mut()) else {
        return;
    };

    for item in tunnels {
        let Some(tunnel) = item.as_mapping_mut() else { continue };

        let Some(proxy_name) = tunnel.get("proxy").and_then(|v| v.as_str()) else {
            continue;
        };

        if proxy_name == "DIRECT" || proxy_name == "REJECT" {
            continue;
        }

        if !valid.contains(proxy_name) {
            tunnel.remove("proxy");
        }
    }
}

fn tunnels_need_validation(tunnels: &[Value]) -> bool {
    tunnels.iter().any(|item| {
        item.as_mapping()
            .and_then(|t| t.get("proxy"))
            .and_then(|p| p.as_str())
            .is_some_and(|name| name != "DIRECT" && name != "REJECT")
    })
}

fn collect_names(config: &Mapping, list_key: &str, out: &mut HashSet<String>) {
    let Some(Value::Sequence(seq)) = config.get(list_key) else {
        return;
    };

    for item in seq {
        let Value::Mapping(map) = item else {
            continue;
        };
        if let Some(Value::String(n)) = map.get("name")
            && !n.is_empty()
        {
            out.insert(n.into());
        }
    }
}

#[derive(Debug)]
pub enum ConfigType {
    Run,
    Check,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_profile_index_survives_startup_without_cleanup() -> Result<()> {
        let profiles = Draft::new(IProfiles::default());
        let profiles_dir = std::env::temp_dir().join(format!("clash-verge-profile-cleanup-{}", nanoid::nanoid!()));
        tokio::fs::create_dir_all(&profiles_dir).await?;
        let active_profile = profiles_dir.join("Ractive.yaml");
        tokio::fs::write(&active_profile, "proxies: []").await?;

        Config::ensure_default_profile_items_for(&profiles).await?;
        profiles.data_arc().cleanup_orphaned_files_in(&profiles_dir).await?;

        let profile_was_preserved = tokio::fs::try_exists(&active_profile).await?;
        tokio::fs::remove_dir_all(&profiles_dir).await?;

        assert!(profile_was_preserved);
        assert!(profiles.data_arc().items.is_none());
        Ok(())
    }
}
