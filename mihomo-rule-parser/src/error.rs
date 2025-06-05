use crate::{RuleBehavior, RuleFormat};
use std::io;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, RuleParseError>;

// 错误类型定义
#[derive(Debug, Error)]
pub enum RuleParseError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("invalid magic number")]
    InvalidMagic,
    #[error("invalid version")]
    InvalidVersion,
    #[error("invalid length: {0}")]
    InvalidLength(i64),
    #[error("invalid rule behavior: {0}")]
    InvalidBehavior(String),
    #[error("invalid rule format: {0}")]
    InvalidFormat(String),
    #[error("behavior mismatch (expected {expected}, got {actual})")]
    BehaviorMismatch {
        expected: RuleBehavior,
        actual: RuleBehavior,
    },
    #[error("yaml parse error: {0}")]
    YamlParseError(#[from] serde_yaml::Error),
    #[error("current {0} unsupported format: {1}")]
    UnsupportedFormat(RuleBehavior, RuleFormat),
}
