use crate::core::notify::NoticeStatus;
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

const fn notice_key(kind: ValidationErrorKind, target: ValidationNoticeTarget) -> NoticeStatus {
    match kind {
        ValidationErrorKind::FileMissing => NoticeStatus::ConfigValidateFileNotFound,
        ValidationErrorKind::FileRead => match target {
            ValidationNoticeTarget::Script => NoticeStatus::ConfigValidateScriptError,
            _ => NoticeStatus::ConfigValidateYamlReadError,
        },
        ValidationErrorKind::YamlSyntax => match target {
            ValidationNoticeTarget::Merge => NoticeStatus::ConfigValidateMergeSyntaxError,
            ValidationNoticeTarget::Script => NoticeStatus::ConfigValidateScriptError,
            ValidationNoticeTarget::Runtime => NoticeStatus::ConfigValidateYamlSyntaxError,
        },
        ValidationErrorKind::YamlMapping => match target {
            ValidationNoticeTarget::Merge => NoticeStatus::ConfigValidateMergeMappingError,
            ValidationNoticeTarget::Script => NoticeStatus::ConfigValidateScriptError,
            ValidationNoticeTarget::Runtime => NoticeStatus::ConfigValidateYamlMappingError,
        },
        ValidationErrorKind::ScriptSyntax => NoticeStatus::ConfigValidateScriptSyntaxError,
        ValidationErrorKind::ScriptMissingMain => NoticeStatus::ConfigValidateScriptMissingMain,
        ValidationErrorKind::ProcessTerminated => NoticeStatus::ConfigValidateProcessTerminated,
        ValidationErrorKind::CoreRejected | ValidationErrorKind::Timeout => NoticeStatus::ConfigValidateError,
    }
}

pub fn handle_validation_notice(outcome: &ValidationOutcome, target: ValidationNoticeTarget, file_type: &str) {
    match outcome {
        ValidationOutcome::Invalid { kind, message } => {
            let status = notice_key(*kind, target);
            logging!(warn, Type::Config, "{} 验证失败: {}", file_type, message);
            handle::Handle::notice(status, message.as_str());
        }
        ValidationOutcome::Busy | ValidationOutcome::Skipped { .. } => {
            let message = outcome.to_string();
            logging!(warn, Type::Config, "{} 验证跳过: {}", file_type, message);
            handle::Handle::notice(NoticeStatus::ConfigValidateError, message.as_str());
        }
        ValidationOutcome::Valid => {}
    }
}
