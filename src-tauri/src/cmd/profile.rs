use super::CmdResult;
use super::StringifyErr as _;
use crate::{
    config::{
        Config, IProfiles, PrfItem, PrfOption,
        profiles::{
            profiles_append_item_with_filedata_safe, profiles_delete_item_safe, profiles_patch_item_safe,
            profiles_reorder_safe, profiles_save_file_safe,
        },
        profiles_append_item_safe,
    },
    core::{CoreManager, handle, timer::Timer, tray::Tray},
    feat,
    module::auto_backup::{AutoBackupManager, AutoBackupTrigger},
    process::AsyncHandler,
    ret_err,
    utils::{dirs, help},
};
use clash_verge_draft::SharedBox;
use clash_verge_logging::{Type, logging};
use scopeguard::defer;
use smartstring::alias::String;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static CURRENT_SWITCHING_PROFILE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn get_profiles() -> CmdResult<SharedBox<IProfiles>> {
    logging!(debug, Type::Cmd, "获取配置文件列表");
    let draft = Config::profiles().await;
    let data = draft.data_arc();
    Ok(data)
}

/// 增强配置文件
#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    match feat::enhance_profiles().await {
        Ok((true, _)) => {
            handle::Handle::refresh_clash();
            Ok(())
        }
        Ok((false, msg)) => {
            let message: String = if msg.is_empty() {
                "Failed to reactivate profiles".into()
            } else {
                msg
            };
            logging!(
                warn,
                Type::Cmd,
                "Reactivate profiles command failed validation: {}",
                message.as_str()
            );
            Err(message)
        }
        Err(e) => {
            logging!(error, Type::Cmd, "{}", e);
            Err(e.to_string().into())
        }
    }
}

/// 导入配置文件
#[tauri::command]
pub async fn import_profile(url: std::string::String, option: Option<PrfOption>) -> CmdResult {
    logging!(info, Type::Cmd, "[导入订阅] 开始导入: {}", url);

    // 直接依赖 PrfItem::from_url 自身的超时/重试逻辑，不再使用 tokio::time::timeout 包裹
    let item = &mut match PrfItem::from_url(&url, None, None, option.as_ref()).await {
        Ok(it) => {
            logging!(info, Type::Cmd, "[导入订阅] 下载完成，开始保存配置");
            it
        }
        Err(e) => {
            logging!(error, Type::Cmd, "[导入订阅] 下载失败: {}", e);
            return Err(format!("导入订阅失败: {}", e).into());
        }
    };

    match profiles_append_item_safe(item).await {
        Ok(_) => match profiles_save_file_safe().await {
            Ok(_) => {
                logging!(info, Type::Cmd, "[导入订阅] 配置文件保存成功");
            }
            Err(e) => {
                logging!(error, Type::Cmd, "[导入订阅] 保存配置文件失败: {}", e);
            }
        },
        Err(e) => {
            logging!(error, Type::Cmd, "[导入订阅] 保存配置失败: {}", e);
            return Err(format!("导入订阅失败: {}", e).into());
        }
    }

    if let Some(uid) = &item.uid {
        logging!(info, Type::Cmd, "[导入订阅] 发送配置变更通知: {}", uid);
        handle::Handle::notify_profile_changed(uid.clone());
    }

    // 异步保存配置文件并发送全局通知
    let uid_clone = item.uid.clone();
    if let Some(uid) = uid_clone {
        // 延迟发送，确保文件已完全写入
        tokio::time::sleep(Duration::from_millis(100)).await;
        logging!(info, Type::Cmd, "[导入订阅] 发送配置变更通知: {}", uid);
        handle::Handle::notify_profile_changed(uid);
    }

    logging!(info, Type::Cmd, "[导入订阅] 导入完成: {}", url);
    AutoBackupManager::trigger_backup(AutoBackupTrigger::ProfileChange);
    Ok(())
}

/// 调整profile的顺序
#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    match profiles_reorder_safe(&active_id, &over_id).await {
        Ok(_) => {
            logging!(info, Type::Cmd, "重新排序配置文件");
            Config::profiles().await.apply();
            Ok(())
        }
        Err(err) => {
            Config::profiles().await.discard();
            logging!(error, Type::Cmd, "重新排序配置文件失败: {}", err);
            Err(format!("重新排序配置文件失败: {}", err).into())
        }
    }
}

/// 创建新的profile
/// 创建一个新的配置文件
#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    match profiles_append_item_with_filedata_safe(&item, file_data).await {
        Ok(_) => {
            // 发送配置变更通知
            if let Some(uid) = item.uid.clone() {
                logging!(info, Type::Cmd, "[创建订阅] 发送配置变更通知: {}", uid);
                handle::Handle::notify_profile_changed(uid);
            }
            Config::profiles().await.apply();
            AutoBackupManager::trigger_backup(AutoBackupTrigger::ProfileChange);
            Ok(())
        }
        Err(err) => {
            Config::profiles().await.discard();
            match err.to_string().as_str() {
                "the file already exists" => Err("the file already exists".into()),
                _ => Err(format!("add profile error: {err}").into()),
            }
        }
    }
}

/// 更新配置文件
#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
    match feat::update_profile(&index, option.as_ref(), true, true).await {
        Ok(_) => {
            let _: () = Config::profiles().await.apply();
            Ok(())
        }
        Err(e) => {
            Config::profiles().await.discard();
            logging!(error, Type::Cmd, "{}", e);
            Err(e.to_string().into())
        }
    }
}

/// 删除配置文件
#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    // 使用Send-safe helper函数
    let should_update = profiles_delete_item_safe(&index).await.stringify_err()?;
    profiles_save_file_safe().await.stringify_err()?;
    if should_update {
        Config::profiles().await.apply();
        match CoreManager::global().update_config().await {
            Ok(_) => {
                handle::Handle::refresh_clash();
                // 发送配置变更通知
                logging!(info, Type::Cmd, "[删除订阅] 发送配置变更通知: {}", index);
                handle::Handle::notify_profile_changed(index);
                AutoBackupManager::trigger_backup(AutoBackupTrigger::ProfileChange);
            }
            Err(e) => {
                logging!(error, Type::Cmd, "{}", e);
                return Err(e.to_string().into());
            }
        }
    }
    Ok(())
}

/// 验证新配置文件的语法
async fn validate_new_profile(new_profile: &String) -> Result<(), ()> {
    logging!(info, Type::Cmd, "正在切换到新配置: {}", new_profile);

    // 获取目标配置文件路径
    let config_file_result = {
        let profiles_config = Config::profiles().await;
        let profiles_data = profiles_config.latest_arc();
        match profiles_data.get_item(new_profile) {
            Ok(item) => {
                if let Some(file) = &item.file {
                    let path = dirs::app_profiles_dir().map(|dir| dir.join(file.as_str()));
                    path.ok()
                } else {
                    None
                }
            }
            Err(e) => {
                logging!(error, Type::Cmd, "获取目标配置信息失败: {}", e);
                None
            }
        }
    };

    // 如果获取到文件路径，检查YAML语法
    if let Some(file_path) = config_file_result {
        if !file_path.exists() {
            logging!(error, Type::Cmd, "目标配置文件不存在: {}", file_path.display());
            handle::Handle::notice_message("config_validate::file_not_found", format!("{}", file_path.display()));
            return Err(());
        }

        // 超时保护
        let file_read_result =
            tokio::time::timeout(Duration::from_secs(5), tokio::fs::read_to_string(&file_path)).await;

        match file_read_result {
            Ok(Ok(content)) => {
                let yaml_parse_result =
                    AsyncHandler::spawn_blocking(move || serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&content))
                        .await;

                match yaml_parse_result {
                    Ok(Ok(_)) => {
                        logging!(info, Type::Cmd, "目标配置文件语法正确");
                        Ok(())
                    }
                    Ok(Err(err)) => {
                        let error_msg = format!(" {err}");
                        logging!(error, Type::Cmd, "目标配置文件存在YAML语法错误:{}", error_msg);
                        handle::Handle::notice_message("config_validate::yaml_syntax_error", error_msg);
                        Err(())
                    }
                    Err(join_err) => {
                        let error_msg = format!("YAML解析任务失败: {join_err}");
                        logging!(error, Type::Cmd, "{}", error_msg);
                        handle::Handle::notice_message("config_validate::yaml_parse_error", error_msg);
                        Err(())
                    }
                }
            }
            Ok(Err(err)) => {
                let error_msg = format!("无法读取目标配置文件: {err}");
                logging!(error, Type::Cmd, "{}", error_msg);
                handle::Handle::notice_message("config_validate::file_read_error", error_msg);
                Err(())
            }
            Err(_) => {
                let error_msg = "读取配置文件超时(5秒)".to_string();
                logging!(error, Type::Cmd, "{}", error_msg);
                handle::Handle::notice_message("config_validate::file_read_timeout", error_msg);
                Err(())
            }
        }
    } else {
        Ok(())
    }
}

/// 执行配置更新并处理结果
async fn restore_previous_profile(prev_profile: &String) -> CmdResult<()> {
    logging!(info, Type::Cmd, "尝试恢复到之前的配置: {}", prev_profile);
    let restore_profiles = IProfiles {
        current: Some(prev_profile.to_owned()),
        items: None,
    };
    Config::profiles()
        .await
        .edit_draft(|d| d.patch_config(&restore_profiles));
    Config::profiles().await.apply();
    crate::process::AsyncHandler::spawn(|| async move {
        if let Err(e) = profiles_save_file_safe().await {
            logging!(warn, Type::Cmd, "Warning: 异步保存恢复配置文件失败: {e}");
        }
    });
    logging!(info, Type::Cmd, "成功恢复到之前的配置");
    Ok(())
}

async fn handle_success(current_value: Option<&String>) -> CmdResult<bool> {
    Config::profiles().await.apply();
    handle::Handle::refresh_clash();

    if let Err(e) = Tray::global().update_tooltip().await {
        logging!(warn, Type::Cmd, "Warning: 异步更新托盘提示失败: {e}");
    }

    if let Err(e) = Tray::global().update_menu().await {
        logging!(warn, Type::Cmd, "Warning: 异步更新托盘菜单失败: {e}");
    }

    if let Err(e) = profiles_save_file_safe().await {
        logging!(warn, Type::Cmd, "Warning: 异步保存配置文件失败: {e}");
    }

    if let Some(current) = current_value {
        logging!(info, Type::Cmd, "向前端发送配置变更事件: {}", current);
        handle::Handle::notify_profile_changed(current.to_owned());
    }

    Ok(true)
}

async fn handle_validation_failure(error_msg: String, current_profile: Option<&String>) -> CmdResult<bool> {
    logging!(warn, Type::Cmd, "配置验证失败: {}", error_msg);
    Config::profiles().await.discard();
    if let Some(prev_profile) = current_profile {
        restore_previous_profile(prev_profile).await?;
    }
    handle::Handle::notice_message("config_validate::error", error_msg);
    Ok(false)
}

async fn handle_update_error<E: std::fmt::Display>(e: E) -> CmdResult<bool> {
    logging!(warn, Type::Cmd, "更新过程发生错误: {}", e,);
    Config::profiles().await.discard();
    handle::Handle::notice_message("config_validate::boot_error", e.to_string());
    Ok(false)
}

async fn handle_timeout(current_profile: Option<&String>) -> CmdResult<bool> {
    let timeout_msg = "配置更新超时(30秒)，可能是配置验证或核心通信阻塞";
    logging!(error, Type::Cmd, "{}", timeout_msg);
    Config::profiles().await.discard();
    if let Some(prev_profile) = current_profile {
        restore_previous_profile(prev_profile).await?;
    }
    handle::Handle::notice_message("config_validate::timeout", timeout_msg);
    Ok(false)
}

async fn perform_config_update(current_value: Option<&String>, current_profile: Option<&String>) -> CmdResult<bool> {
    defer! {
        CURRENT_SWITCHING_PROFILE.store(false, Ordering::Release);
    }
    let update_result = tokio::time::timeout(Duration::from_secs(30), CoreManager::global().update_config()).await;

    match update_result {
        Ok(Ok((true, _))) => handle_success(current_value).await,
        Ok(Ok((false, error_msg))) => handle_validation_failure(error_msg, current_profile).await,
        Ok(Err(e)) => handle_update_error(e).await,
        Err(_) => handle_timeout(current_profile).await,
    }
}

/// 修改profiles的配置
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    if CURRENT_SWITCHING_PROFILE
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        logging!(info, Type::Cmd, "当前正在切换配置，放弃请求");
        return Ok(false);
    }

    let target_profile = profiles.current.as_ref();

    logging!(info, Type::Cmd, "开始修改配置文件，目标profile: {:?}", target_profile);

    // 保存当前配置，以便在验证失败时恢复
    let previous_profile = Config::profiles().await.data_arc().current.clone();
    logging!(info, Type::Cmd, "当前配置: {:?}", previous_profile);

    // 如果要切换配置，先检查目标配置文件是否有语法错误
    if let Some(switch_to_profile) = target_profile
        && previous_profile.as_ref() != Some(switch_to_profile)
        && validate_new_profile(switch_to_profile).await.is_err()
    {
        CURRENT_SWITCHING_PROFILE.store(false, Ordering::Release);
        return Ok(false);
    }
    Config::profiles().await.edit_draft(|d| d.patch_config(&profiles));

    perform_config_update(target_profile, previous_profile.as_ref()).await
}

/// 根据profile name修改profiles
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(profile_index: String) -> CmdResult<bool> {
    logging!(info, Type::Cmd, "切换配置到: {}", profile_index);

    let profiles = IProfiles {
        current: Some(profile_index),
        items: None,
    };
    patch_profiles_config(profiles).await
}

/// 修改某个profile item的
#[tauri::command]
pub async fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    // 保存修改前检查是否有更新 update_interval
    let profiles = Config::profiles().await;
    let should_refresh_timer = if let Ok(old_profile) = profiles.latest_arc().get_item(&index)
        && let Some(new_option) = profile.option.as_ref()
    {
        let old_interval = old_profile.option.as_ref().and_then(|o| o.update_interval);
        let new_interval = new_option.update_interval;
        let old_allow_auto_update = old_profile.option.as_ref().and_then(|o| o.allow_auto_update);
        let new_allow_auto_update = new_option.allow_auto_update;
        (old_interval != new_interval) || (old_allow_auto_update != new_allow_auto_update)
    } else {
        false
    };

    profiles_patch_item_safe(&index, &profile).await.stringify_err()?;

    // 如果更新间隔或允许自动更新变更，异步刷新定时器
    if should_refresh_timer {
        crate::process::AsyncHandler::spawn(move || async move {
            logging!(info, Type::Timer, "定时器更新间隔已变更，正在刷新定时器...");
            if let Err(e) = crate::core::Timer::global().refresh().await {
                logging!(error, Type::Timer, "刷新定时器失败: {}", e);
            } else {
                // 刷新成功后发送自定义事件，不触发配置重载
                crate::core::handle::Handle::notify_timer_updated(index);
            }
        });
    }

    AutoBackupManager::trigger_backup(AutoBackupTrigger::ProfileChange);
    Ok(())
}

/// 查看配置文件
#[tauri::command]
pub async fn view_profile(index: String) -> CmdResult {
    let profiles = Config::profiles().await;
    let profiles_ref = profiles.latest_arc();
    let file = profiles_ref
        .get_item(&index)
        .stringify_err()?
        .file
        .as_ref()
        .ok_or("the file field is null")?;

    let path = dirs::app_profiles_dir().stringify_err()?.join(file.as_str());
    if !path.exists() {
        ret_err!("the file not found");
    }

    help::open_file(path).stringify_err()
}

/// 读取配置文件内容
#[tauri::command]
pub async fn read_profile_file(index: String) -> CmdResult<String> {
    let item = {
        let profiles = Config::profiles().await;
        let profiles_ref = profiles.latest_arc();
        PrfItem {
            file: profiles_ref.get_item(&index).stringify_err()?.file.to_owned(),
            ..Default::default()
        }
    };
    let data = item.read_file().await.stringify_err()?;
    Ok(data)
}

/// 获取下一次更新时间
#[tauri::command]
pub async fn get_next_update_time(uid: String) -> CmdResult<Option<i64>> {
    let timer = Timer::global();
    let next_time = timer.get_next_update_time(&uid).await;
    Ok(next_time)
}
