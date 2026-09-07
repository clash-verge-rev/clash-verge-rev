use crate::core::{
    handle,
    validate::{ValidationErrorKind, ValidationOutcome},
};
use clash_verge_logging::{Type, logging};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationNoticeTarget {
    Runtime,
    Merge,
    Script,
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
