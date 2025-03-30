use super::CmdResult;
use crate::{
    config::{Config, IProfiles, PrfItem, PrfOption},
    core::{handle, tray::Tray, CoreManager},
    feat, logging, ret_err,
    utils::{dirs, help, logging::Type},
    wrap_err,
};

/// 获取配置文件列表
#[tauri::command]
pub fn get_profiles() -> CmdResult<IProfiles> {
    let _ = Tray::global().update_menu();
    Ok(Config::profiles().data().clone())
}

/// 增强配置文件
#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    wrap_err!(feat::enhance_profiles().await)?;
    handle::Handle::refresh_clash();
    Ok(())
}

/// 导入配置文件
#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> CmdResult {
    let item = wrap_err!(PrfItem::from_url(&url, None, None, option).await)?;
    wrap_err!(Config::profiles().data().append_item(item))
}

/// 重新排序配置文件
#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    wrap_err!(Config::profiles().data().reorder(active_id, over_id))
}

/// 创建配置文件
#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    let item = wrap_err!(PrfItem::from(item, file_data).await)?;
    wrap_err!(Config::profiles().data().append_item(item))
}

/// 更新配置文件
#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
    wrap_err!(feat::update_profile(index, option).await)
}

/// 删除配置文件
#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    let should_update = wrap_err!({ Config::profiles().data().delete_item(index) })?;
    if should_update {
        wrap_err!(CoreManager::global().update_config().await)?;
        handle::Handle::refresh_clash();
    }
    Ok(())
}

/// 修改profiles的配置
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    logging!(info, Type::Cmd, true, "开始修改配置文件");

    // 保存当前配置，以便在验证失败时恢复
    let current_profile = Config::profiles().latest().current.clone();
    logging!(info, Type::Cmd, true, "当前配置: {:?}", current_profile);

    // 如果要切换配置，先检查目标配置文件是否有语法错误
    if let Some(new_profile) = profiles.current.as_ref() {
        if current_profile.as_ref() != Some(new_profile) {
            logging!(info, Type::Cmd, true, "正在切换到新配置: {}", new_profile);

            // 获取目标配置文件路径
            let profiles_config = Config::profiles();
            let profiles_data = profiles_config.latest();
            let config_file_result = match profiles_data.get_item(new_profile) {
                Ok(item) => {
                    if let Some(file) = &item.file {
                        let path = dirs::app_profiles_dir().map(|dir| dir.join(file));
                        path.ok()
                    } else {
                        None
                    }
                }
                Err(e) => {
                    logging!(error, Type::Cmd, true, "获取目标配置信息失败: {}", e);
                    None
                }
            };

            // 如果获取到文件路径，检查YAML语法
            if let Some(file_path) = config_file_result {
                if !file_path.exists() {
                    logging!(
                        error,
                        Type::Cmd,
                        true,
                        "目标配置文件不存在: {}",
                        file_path.display()
                    );
                    handle::Handle::notice_message(
                        "config_validate::file_not_found",
                        &format!("{}", file_path.display()),
                    );
                    return Ok(false);
                }

                match std::fs::read_to_string(&file_path) {
                    Ok(content) => match serde_yaml::from_str::<serde_yaml::Value>(&content) {
                        Ok(_) => {
                            logging!(info, Type::Cmd, true, "目标配置文件语法正确");
                        }
                        Err(err) => {
                            let error_msg = format!(" {}", err);
                            logging!(
                                error,
                                Type::Cmd,
                                true,
                                "目标配置文件存在YAML语法错误:{}",
                                error_msg
                            );
                            handle::Handle::notice_message(
                                "config_validate::yaml_syntax_error",
                                &error_msg,
                            );
                            return Ok(false);
                        }
                    },
                    Err(err) => {
                        let error_msg = format!("无法读取目标配置文件: {}", err);
                        logging!(error, Type::Cmd, true, "{}", error_msg);
                        handle::Handle::notice_message(
                            "config_validate::file_read_error",
                            &error_msg,
                        );
                        return Ok(false);
                    }
                }
            }
        }
    }

    // 更新profiles配置
    logging!(info, Type::Cmd, true, "正在更新配置草稿");
    let _ = Config::profiles().draft().patch_config(profiles);

    // 更新配置并进行验证
    match CoreManager::global().update_config().await {
        Ok((true, _)) => {
            logging!(info, Type::Cmd, true, "配置更新成功");
            handle::Handle::refresh_clash();
            let _ = Tray::global().update_tooltip();
            Config::profiles().apply();
            wrap_err!(Config::profiles().data().save_file())?;
            Ok(true)
        }
        Ok((false, error_msg)) => {
            logging!(warn, Type::Cmd, true, "配置验证失败: {}", error_msg);
            Config::profiles().discard();
            // 如果验证失败，恢复到之前的配置
            if let Some(prev_profile) = current_profile {
                logging!(
                    info,
                    Type::Cmd,
                    true,
                    "尝试恢复到之前的配置: {}",
                    prev_profile
                );
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                // 静默恢复，不触发验证
                wrap_err!({ Config::profiles().draft().patch_config(restore_profiles) })?;
                Config::profiles().apply();
                wrap_err!(Config::profiles().data().save_file())?;
                logging!(info, Type::Cmd, true, "成功恢复到之前的配置");
            }

            // 发送验证错误通知
            handle::Handle::notice_message("config_validate::error", &error_msg);
            Ok(false)
        }
        Err(e) => {
            logging!(warn, Type::Cmd, true, "更新过程发生错误: {}", e);
            Config::profiles().discard();
            handle::Handle::notice_message("config_validate::boot_error", e.to_string());
            Ok(false)
        }
    }
}

/// 根据profile name修改profiles
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(
    _app_handle: tauri::AppHandle,
    profile_index: String,
) -> CmdResult<bool> {
    logging!(info, Type::Cmd, true, "切换配置到: {}", profile_index);

    let profiles = IProfiles {
        current: Some(profile_index),
        items: None,
    };
    patch_profiles_config(profiles).await
}

/// 修改某个profile item的
#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    wrap_err!(Config::profiles().data().patch_item(index, profile))?;
    Ok(())
}

/// 查看配置文件
#[tauri::command]
pub fn view_profile(app_handle: tauri::AppHandle, index: String) -> CmdResult {
    let file = {
        wrap_err!(Config::profiles().latest().get_item(&index))?
            .file
            .clone()
            .ok_or("the file field is null")
    }?;

    let path = wrap_err!(dirs::app_profiles_dir())?.join(file);
    if !path.exists() {
        ret_err!("the file not found");
    }

    wrap_err!(help::open_file(app_handle, path))
}

/// 读取配置文件内容
#[tauri::command]
pub fn read_profile_file(index: String) -> CmdResult<String> {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let item = wrap_err!(profiles.get_item(&index))?;
    let data = wrap_err!(item.read_file())?;
    Ok(data)
}
