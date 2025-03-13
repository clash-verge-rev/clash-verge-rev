use super::CmdResult;
use crate::core::*;

/// 发送脚本验证通知消息
#[tauri::command]
pub async fn script_validate_notice(status: String, msg: String) -> CmdResult {
    handle::Handle::notice_message(&status, &msg);
    Ok(())
}

/// 处理脚本验证相关的所有消息通知
/// 统一通知接口，保持消息类型一致性
pub fn handle_script_validation_notice(result: &(bool, String), file_type: &str) {
    if !result.0 {
        let error_msg = &result.1;

        // 根据错误消息内容判断错误类型
        let status = if error_msg.starts_with("File not found:") {
            "config_validate::file_not_found"
        } else if error_msg.starts_with("Failed to read script file:") {
            "config_validate::script_error"
        } else if error_msg.starts_with("Script syntax error:") {
            "config_validate::script_syntax_error"
        } else if error_msg == "Script must contain a main function" {
            "config_validate::script_missing_main"
        } else {
            // 如果是其他类型错误，作为一般脚本错误处理
            "config_validate::script_error"
        };

        log::warn!(target: "app", "{} 验证失败: {}", file_type, error_msg);
        handle::Handle::notice_message(status, error_msg);
    }
}

/// 验证指定脚本文件
#[tauri::command]
pub async fn validate_script_file(file_path: String) -> CmdResult<bool> {
    log::info!(target: "app", "验证脚本文件: {}", file_path);

    match CoreManager::global()
        .validate_config_file(&file_path, None)
        .await
    {
        Ok(result) => {
            handle_script_validation_notice(&result, "脚本文件");
            Ok(result.0) // 返回验证结果布尔值
        }
        Err(e) => {
            let error_msg = e.to_string();
            log::error!(target: "app", "验证脚本文件过程发生错误: {}", error_msg);
            handle::Handle::notice_message("config_validate::process_terminated", &error_msg);
            Ok(false)
        }
    }
}

/// 处理YAML验证相关的所有消息通知
/// 统一通知接口，保持消息类型一致性
pub fn handle_yaml_validation_notice(result: &(bool, String), file_type: &str) {
    if !result.0 {
        let error_msg = &result.1;
        println!("[通知] 处理{}验证错误: {}", file_type, error_msg);

        // 检查是否为merge文件
        let is_merge_file = file_type.contains("合并");

        // 根据错误消息内容判断错误类型
        let status = if error_msg.starts_with("File not found:") {
            "config_validate::file_not_found"
        } else if error_msg.starts_with("Failed to read file:") {
            "config_validate::yaml_read_error"
        } else if error_msg.starts_with("YAML syntax error:") {
            if is_merge_file {
                "config_validate::merge_syntax_error"
            } else {
                "config_validate::yaml_syntax_error"
            }
        } else if error_msg.contains("mapping values are not allowed") {
            if is_merge_file {
                "config_validate::merge_mapping_error"
            } else {
                "config_validate::yaml_mapping_error"
            }
        } else if error_msg.contains("did not find expected key") {
            if is_merge_file {
                "config_validate::merge_key_error"
            } else {
                "config_validate::yaml_key_error"
            }
        } else {
            // 如果是其他类型错误，根据文件类型作为一般错误处理
            if is_merge_file {
                "config_validate::merge_error"
            } else {
                "config_validate::yaml_error"
            }
        };

        log::warn!(target: "app", "{} 验证失败: {}", file_type, error_msg);
        println!("[通知] 发送通知: status={}, msg={}", status, error_msg);
        handle::Handle::notice_message(status, error_msg);
    }
}
