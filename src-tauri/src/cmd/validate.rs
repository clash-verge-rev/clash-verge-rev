use super::CmdResult;
use crate::core::{
    handle,
    validate::{CoreConfigValidator, ValidationErrorKind, ValidationOutcome},
};
use clash_verge_logging::{Type, logging};
use smartstring::alias::String;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationNoticeTarget {
    Runtime,
    Merge,
    Script,
}

/// 发送脚本验证通知消息
#[tauri::command]
pub async fn script_validate_notice(status: String, msg: String) -> CmdResult {
    handle::Handle::notice_message(status.as_str(), msg.as_str());
    Ok(())
}

/// 验证指定脚本文件
#[tauri::command]
pub async fn validate_script_file(file_path: String) -> CmdResult<ValidationOutcome> {
    logging!(info, Type::Config, "验证脚本文件: {}", file_path);

    match CoreConfigValidator::validate_config_file_outcome(&file_path, None).await {
        Ok(outcome) => {
            handle_validation_notice(&outcome, ValidationNoticeTarget::Script, "脚本文件");
            Ok(outcome)
        }
        Err(e) => {
            let error_msg = e.to_string();
            logging!(error, Type::Config, "验证脚本文件过程发生错误: {}", error_msg);
            handle::Handle::notice_message("config_validate::process_terminated", &error_msg);
            Ok(ValidationOutcome::invalid(
                ValidationErrorKind::ProcessTerminated,
                error_msg,
            ))
        }
    }
}

const fn notice_key(kind: ValidationErrorKind, target: ValidationNoticeTarget) -> &'static str {
    match kind {
        ValidationErrorKind::FileMissing => "config_validate::file_not_found",
        ValidationErrorKind::FileRead => match target {
            ValidationNoticeTarget::Script => "config_validate::script_error",
            _ => "config_validate::yaml_read_error",
        },
        ValidationErrorKind::YamlSyntax => match target {
            ValidationNoticeTarget::Merge => "config_validate::merge_syntax_error",
            ValidationNoticeTarget::Script => "config_validate::script_error",
            ValidationNoticeTarget::Runtime => "config_validate::yaml_syntax_error",
        },
        ValidationErrorKind::YamlMapping => match target {
            ValidationNoticeTarget::Merge => "config_validate::merge_mapping_error",
            ValidationNoticeTarget::Script => "config_validate::script_error",
            ValidationNoticeTarget::Runtime => "config_validate::yaml_mapping_error",
        },
        ValidationErrorKind::ScriptSyntax => "config_validate::script_syntax_error",
        ValidationErrorKind::ScriptMissingMain => "config_validate::script_missing_main",
        ValidationErrorKind::ProcessTerminated => "config_validate::process_terminated",
        ValidationErrorKind::CoreRejected | ValidationErrorKind::Timeout => "config_validate::error",
    }
}

pub fn handle_validation_notice(outcome: &ValidationOutcome, target: ValidationNoticeTarget, file_type: &str) {
    match outcome {
        ValidationOutcome::Invalid { kind, message } => {
            let status = notice_key(*kind, target);
            logging!(warn, Type::Config, "{} 验证失败: {}", file_type, message);
            handle::Handle::notice_message(status, message.to_owned());
        }
        ValidationOutcome::Busy | ValidationOutcome::Skipped { .. } => {
            let message = outcome.to_string();
            logging!(warn, Type::Config, "{} 验证跳过: {}", file_type, message);
            handle::Handle::notice_message("config_validate::error", message);
        }
        ValidationOutcome::Valid => {}
    }
}
