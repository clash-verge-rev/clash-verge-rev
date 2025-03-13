use super::CmdResult;
use crate::{
    config::*,
    core::*,
    feat, log_err, ret_err,
    utils::{dirs, help},
    wrap_err,
};

/// 获取配置文件列表
#[tauri::command]
pub fn get_profiles() -> CmdResult<IProfiles> {
    let _ = tray::Tray::global().update_menu();
    Ok(Config::profiles().data().clone())
}

/// 增强配置文件
#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    match CoreManager::global().update_config().await {
        Ok((true, _)) => {
            println!("[enhance_profiles] 配置更新成功");
            log_err!(tray::Tray::global().update_tooltip());
            handle::Handle::refresh_clash();
            Ok(())
        }
        Ok((false, error_msg)) => {
            println!("[enhance_profiles] 配置验证失败: {}", error_msg);
            handle::Handle::notice_message("config_validate::error", &error_msg);
            Ok(())
        }
        Err(e) => {
            println!("[enhance_profiles] 更新过程发生错误: {}", e);
            handle::Handle::notice_message("config_validate::process_terminated", e.to_string());
            Ok(())
        }
    }
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
    println!("[cmd配置patch] 开始修改配置文件");

    // 保存当前配置，以便在验证失败时恢复
    let current_profile = Config::profiles().latest().current.clone();
    println!("[cmd配置patch] 当前配置: {:?}", current_profile);

    // 更新profiles配置
    println!("[cmd配置patch] 正在更新配置草稿");
    wrap_err!({ Config::profiles().draft().patch_config(profiles) })?;

    // 更新配置并进行验证
    match CoreManager::global().update_config().await {
        Ok((true, _)) => {
            println!("[cmd配置patch] 配置更新成功");
            handle::Handle::refresh_clash();
            let _ = tray::Tray::global().update_tooltip();
            Config::profiles().apply();
            wrap_err!(Config::profiles().data().save_file())?;
            Ok(true)
        }
        Ok((false, error_msg)) => {
            println!("[cmd配置patch] 配置验证失败: {}", error_msg);
            Config::profiles().discard();

            // 如果验证失败，恢复到之前的配置
            if let Some(prev_profile) = current_profile {
                println!("[cmd配置patch] 尝试恢复到之前的配置: {}", prev_profile);
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                // 静默恢复，不触发验证
                wrap_err!({ Config::profiles().draft().patch_config(restore_profiles) })?;
                Config::profiles().apply();
                wrap_err!(Config::profiles().data().save_file())?;
                println!("[cmd配置patch] 成功恢复到之前的配置");
            }

            // 发送验证错误通知
            handle::Handle::notice_message("config_validate::error", &error_msg);
            Ok(false)
        }
        Err(e) => {
            println!("[cmd配置patch] 更新过程发生错误: {}", e);
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
