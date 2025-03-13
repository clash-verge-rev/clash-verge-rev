use super::CmdResult;
use crate::{config::*, core::*, utils::dirs, wrap_err};
use std::fs;

/// 保存profiles的配置
#[tauri::command]
pub async fn save_profile_file(index: String, file_data: Option<String>) -> CmdResult {
    if file_data.is_none() {
        return Ok(());
    }

    // 在异步操作前完成所有文件操作
    let (file_path, original_content, is_merge_file) = {
        let profiles = Config::profiles();
        let profiles_guard = profiles.latest();
        let item = wrap_err!(profiles_guard.get_item(&index))?;
        // 确定是否为merge类型文件
        let is_merge = item.itype.as_ref().is_some_and(|t| t == "merge");
        let content = wrap_err!(item.read_file())?;
        let path = item.file.clone().ok_or("file field is null")?;
        let profiles_dir = wrap_err!(dirs::app_profiles_dir())?;
        (profiles_dir.join(path), content, is_merge)
    };

    // 保存新的配置文件
    wrap_err!(fs::write(&file_path, file_data.clone().unwrap()))?;

    let file_path_str = file_path.to_string_lossy().to_string();
    println!(
        "[cmd配置save] 开始验证配置文件: {}, 是否为merge文件: {}",
        file_path_str, is_merge_file
    );

    // 对于 merge 文件，只进行语法验证，不进行后续内核验证
    if is_merge_file {
        println!("[cmd配置save] 检测到merge文件，只进行语法验证");
        match CoreManager::global()
            .validate_config_file(&file_path_str, Some(true))
            .await
        {
            Ok((true, _)) => {
                println!("[cmd配置save] merge文件语法验证通过");
                // 成功后尝试更新整体配置
                if let Err(e) = CoreManager::global().update_config().await {
                    println!("[cmd配置save] 更新整体配置时发生错误: {}", e);
                    log::warn!(target: "app", "更新整体配置时发生错误: {}", e);
                }
                return Ok(());
            }
            Ok((false, error_msg)) => {
                println!("[cmd配置save] merge文件语法验证失败: {}", error_msg);
                // 恢复原始配置文件
                wrap_err!(fs::write(&file_path, original_content))?;
                // 发送合并文件专用错误通知
                let result = (false, error_msg.clone());
                crate::cmd::validate::handle_yaml_validation_notice(&result, "合并配置文件");
                return Ok(());
            }
            Err(e) => {
                println!("[cmd配置save] 验证过程发生错误: {}", e);
                // 恢复原始配置文件
                wrap_err!(fs::write(&file_path, original_content))?;
                return Err(e.to_string());
            }
        }
    }

    // 非merge文件使用完整验证流程
    match CoreManager::global()
        .validate_config_file(&file_path_str, None)
        .await
    {
        Ok((true, _)) => {
            println!("[cmd配置save] 验证成功");
            Ok(())
        }
        Ok((false, error_msg)) => {
            println!("[cmd配置save] 验证失败: {}", error_msg);
            // 恢复原始配置文件
            wrap_err!(fs::write(&file_path, original_content))?;

            // 智能判断错误类型
            let is_script_error = file_path_str.ends_with(".js")
                || error_msg.contains("Script syntax error")
                || error_msg.contains("Script must contain a main function")
                || error_msg.contains("Failed to read script file");

            if error_msg.contains("YAML syntax error")
                || error_msg.contains("Failed to read file:")
                || (!file_path_str.ends_with(".js") && !is_script_error)
            {
                // 普通YAML错误使用YAML通知处理
                println!("[cmd配置save] YAML配置文件验证失败，发送通知");
                let result = (false, error_msg.clone());
                crate::cmd::validate::handle_yaml_validation_notice(&result, "YAML配置文件");
            } else if is_script_error {
                // 脚本错误使用专门的通知处理
                println!("[cmd配置save] 脚本文件验证失败，发送通知");
                let result = (false, error_msg.clone());
                crate::cmd::validate::handle_script_validation_notice(&result, "脚本文件");
            } else {
                // 普通配置错误使用一般通知
                println!("[cmd配置save] 其他类型验证失败，发送一般通知");
                handle::Handle::notice_message("config_validate::error", &error_msg);
            }

            Ok(())
        }
        Err(e) => {
            println!("[cmd配置save] 验证过程发生错误: {}", e);
            // 恢复原始配置文件
            wrap_err!(fs::write(&file_path, original_content))?;
            Err(e.to_string())
        }
    }
}
