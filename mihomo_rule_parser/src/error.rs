use std::io;

use thiserror::Error;

use crate::{RuleBehavior, RuleFormat};

// 错误类型定义
#[derive(Debug, Error)]
pub enum RuleParseError {
    #[error("invalid behavior")]
    InvalidBehavior,
    #[error("invalid format")]
    InvalidFormat,
    #[error("invalid magic number")]
    InvalidMagic,
    #[error("behavior mismatch (expected {expected}, got {actual})")]
    BehaviorMismatch {
        expected: RuleBehavior,
        actual: RuleBehavior,
    },
    #[error("invalid length: {0}")]
    InvalidLength(i64),
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("strategy error: {0}")]
    StrategyError(String),
    #[error("invalid version")]
    InvalidVersion,
    #[error("unsupported format: {0}")]
    UnsupportedFormat(RuleFormat),
}
