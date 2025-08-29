use super::{Draft, IClashTemp, IProfiles, IRuntime, IVerge};
use crate::{
    config::{profiles_append_item_safe, PrfItem},
    core::{handle, CoreManager},
    enhance, logging,
    utils::{dirs, help, logging::Type},
};
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use tokio::sync::OnceCell;
use tokio::time::{sleep, Duration};

pub const RUNTIME_CONFIG: &str = "clash-verge.yaml";
pub const CHECK_CONFIG: &str = "clash-verge-check.yaml";

pub struct Config {
    clash_config: Draft<Box<IClashTemp>>,
    verge_config: Draft<Box<IVerge>>,
    profiles_config: Draft<Box<IProfiles>>,
    runtime_config: Draft<Box<IRuntime>>,
}

impl Config {
    pub async fn global() -> &'static Config {
        static CONFIG: OnceCell<Config> = OnceCell::const_new();
        CONFIG
            .get_or_init(|| async {
                Config {
                    clash_config: Draft::from(Box::new(IClashTemp::new().await)),
                    verge_config: Draft::from(Box::new(IVerge::new().await)),
                    profiles_config: Draft::from(Box::new(IProfiles::new().await)),
                    runtime_config: Draft::from(Box::new(IRuntime::new())),
                }
            })
            .await
    }

    pub async fn clash() -> Draft<Box<IClashTemp>> {
        Self::global().await.clash_config.clone()
    }

    pub async fn verge() -> Draft<Box<IVerge>> {
        Self::global().await.verge_config.clone()
    }

    pub async fn profiles() -> Draft<Box<IProfiles>> {
        Self::global().await.profiles_config.clone()
    }

    pub async fn runtime() -> Draft<Box<IRuntime>> {
        Self::global().await.runtime_config.clone()
    }

    /// 初始化订阅
    pub async fn init_config() -> Result<()> {
        if Self::profiles()
            .await
            .latest_ref()
            .get_item(&"Merge".to_string())
            .is_err()
        {
            let merge_item = PrfItem::from_merge(Some("Merge".to_string()))?;
            profiles_append_item_safe(merge_item.clone()).await?;
        }
        if Self::profiles()
            .await
            .latest_ref()
            .get_item(&"Script".to_string())
            .is_err()
        {
            let script_item = PrfItem::from_script(Some("Script".to_string()))?;
            profiles_append_item_safe(script_item.clone()).await?;
        }
        // 生成运行时配置
        if let Err(err) = Self::generate().await {
            logging!(error, Type::Config, true, "生成运行时配置失败: {}", err);
        } else {
            logging!(info, Type::Config, true, "生成运行时配置成功");
        }

        // 生成运行时配置文件并验证
        let config_result = Self::generate_file(ConfigType::Run).await;

        let validation_result = if config_result.is_ok() {
            // 验证配置文件
            logging!(info, Type::Config, true, "开始验证配置");

            match CoreManager::global().validate_config().await {
                Ok((is_valid, error_msg)) => {
                    if !is_valid {
                        logging!(
                            warn,
                            Type::Config,
                            true,
                            "[首次启动] 配置验证失败，使用默认最小配置启动: {}",
                            error_msg
                        );
                        CoreManager::global()
                            .use_default_config("config_validate::boot_error", &error_msg)
                            .await?;
                        Some(("config_validate::boot_error", error_msg))
                    } else {
                        logging!(info, Type::Config, true, "配置验证成功");
                        Some(("config_validate::success", String::new()))
                    }
                }
                Err(err) => {
                    logging!(warn, Type::Config, true, "验证进程执行失败: {}", err);
                    CoreManager::global()
                        .use_default_config("config_validate::process_terminated", "")
                        .await?;
                    Some(("config_validate::process_terminated", String::new()))
                }
            }
        } else {
            logging!(warn, Type::Config, true, "生成配置文件失败，使用默认配置");
            CoreManager::global()
                .use_default_config("config_validate::error", "")
                .await?;
            Some(("config_validate::error", String::new()))
        };

        // 在单独的任务中发送通知
        if let Some((msg_type, msg_content)) = validation_result {
            sleep(Duration::from_secs(2)).await;
            handle::Handle::notice_message(msg_type, &msg_content);
        }

        Ok(())
    }

    /// 将订阅丢到对应的文件中
    pub async fn generate_file(typ: ConfigType) -> Result<PathBuf> {
        let path = match typ {
            ConfigType::Run => dirs::app_home_dir()?.join(RUNTIME_CONFIG),
            ConfigType::Check => dirs::app_home_dir()?.join(CHECK_CONFIG),
        };

        let runtime = Config::runtime().await;
        let config = runtime
            .latest_ref()
            .config
            .as_ref()
            .ok_or(anyhow!("failed to get runtime config"))?
            .clone();
        drop(runtime); // 显式释放锁

        help::save_yaml(&path, &config, Some("# Generated by Clash Verge")).await?;
        Ok(path)
    }

    /// 生成订阅存好
    pub async fn generate() -> Result<()> {
        let (config, exists_keys, logs) = enhance::enhance().await;

        *Config::runtime().await.draft_mut() = Box::new(IRuntime {
            config: Some(config),
            exists_keys,
            chain_logs: logs,
        });

        Ok(())
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
    use std::mem;

    #[test]
    #[allow(unused_variables)]
    #[allow(clippy::expect_used)]
    fn test_prfitem_from_merge_size() {
        let merge_item = PrfItem::from_merge(Some("Merge".to_string()))
            .expect("Failed to create merge item in test");
        let prfitem_size = mem::size_of_val(&merge_item);
        // Boxed version
        let boxed_merge_item = Box::new(merge_item);
        let box_prfitem_size = mem::size_of_val(&boxed_merge_item);
        // The size of Box<T> is always pointer-sized (usually 8 bytes on 64-bit)
        // assert_eq!(box_prfitem_size, mem::size_of::<Box<PrfItem>>());
        assert!(box_prfitem_size < prfitem_size);
    }

    #[test]
    #[allow(unused_variables)]
    fn test_draft_size_non_boxed() {
        let draft = Draft::from(IRuntime::new());
        let iruntime_size = std::mem::size_of_val(&draft);
        assert_eq!(iruntime_size, std::mem::size_of::<Draft<IRuntime>>());
    }

    #[test]
    #[allow(unused_variables)]
    fn test_draft_size_boxed() {
        let draft = Draft::from(Box::new(IRuntime::new()));
        let box_iruntime_size = std::mem::size_of_val(&draft);
        assert_eq!(
            box_iruntime_size,
            std::mem::size_of::<Draft<Box<IRuntime>>>()
        );
    }
}
