use crate::RuleBehavior;
use std::io;
use thiserror::Error;

// 错误类型定义
#[derive(Debug, Error)]
pub enum RuleParseError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("invalid magic number")]
    InvalidMagic,
    #[error("invalid behavior")]
    InvalidBehavior,
    #[error("invalid version")]
    InvalidVersion,
    #[error("invalid length: {0}")]
    InvalidLength(i64),
    #[error("invalid format")]
    InvalidRuleFormat,
    #[error("behavior mismatch (expected {expected}, got {actual})")]
    RuleBehaviorMismatch {
        expected: RuleBehavior,
        actual: RuleBehavior,
    },
}
