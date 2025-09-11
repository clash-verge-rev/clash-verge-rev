#![allow(dead_code)]
use std::{fmt::Display, path::Path};

use classical::ClassicalParseStrategy;
use domain::DomainParseStrategy;
pub use error::RuleParseError;
use ipcidr::IpCidrParseStrategy;
use serde::{Deserialize, Serialize};

use crate::error::Result;

mod bitmap;
mod classical;
mod domain;
mod error;
mod ipcidr;
mod utils;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuleBehavior {
    Domain,
    #[serde(rename = "IPCIDR")]
    IpCidr,
    Classical,
}

impl Display for RuleBehavior {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RuleBehavior::Domain => write!(f, "Domain"),
            RuleBehavior::IpCidr => write!(f, "IPCIDR"),
            RuleBehavior::Classical => write!(f, "Classical"),
        }
    }
}

impl TryFrom<String> for RuleBehavior {
    type Error = RuleParseError;

    fn try_from(behavior: String) -> Result<Self> {
        match behavior.as_str() {
            "domain" | "Domain" => Ok(RuleBehavior::Domain),
            "ipcidr" | "IPCIDR" => Ok(RuleBehavior::IpCidr),
            "classical" | "Classical" => Ok(RuleBehavior::Classical),
            _ => Err(RuleParseError::InvalidBehavior(behavior)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum RuleFormat {
    #[serde(rename = "YamlRule")]
    Yaml,
    #[serde(rename = "TextRule")]
    Text,
    #[serde(rename = "MrsRule")]
    Mrs,
}

impl Display for RuleFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RuleFormat::Yaml => write!(f, "YamlRule"),
            RuleFormat::Text => write!(f, "TextRule"),
            RuleFormat::Mrs => write!(f, "MrsRule"),
        }
    }
}

impl TryFrom<String> for RuleFormat {
    type Error = RuleParseError;

    fn try_from(format: String) -> Result<Self> {
        match format.as_str() {
            "yaml" | "yml" => Ok(RuleFormat::Yaml),
            "text" | "txt" => Ok(RuleFormat::Text),
            "mrs" => Ok(RuleFormat::Mrs),
            _ => Err(RuleParseError::InvalidFormat(format)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RulePayload {
    pub count: i64,
    pub rules: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct YamlPayload {
    payload: Vec<String>,
}

impl From<YamlPayload> for RulePayload {
    fn from(payload: YamlPayload) -> Self {
        RulePayload {
            count: payload.payload.len() as i64,
            rules: payload.payload,
        }
    }
}

trait Parser {
    fn parse(buf: &[u8], format: RuleFormat) -> Result<RulePayload>;
}

pub fn parse<P: AsRef<Path>>(file_path: P, behavior: RuleBehavior, format: RuleFormat) -> Result<RulePayload> {
    let buf = std::fs::read(file_path)?;
    let rule = match behavior {
        RuleBehavior::Domain => DomainParseStrategy::parse(&buf, format)?,
        RuleBehavior::IpCidr => IpCidrParseStrategy::parse(&buf, format)?,
        RuleBehavior::Classical => ClassicalParseStrategy::parse(&buf, format)?,
    };
    drop(buf);
    Ok(rule)
}
