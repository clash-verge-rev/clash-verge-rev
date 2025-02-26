#![allow(dead_code)]
use anyhow::Result;
use domain::DomainParseStrategy;
use error::RuleParseError;
use ipcidr::IpCidrParseStrategy;
use std::fmt::Display;

mod bitmap;
mod utils;

pub mod classical;
pub mod domain;
pub mod error;
pub mod ipcidr;

#[derive(Debug, PartialEq, Eq)]
pub enum RuleBehavior {
    Domain,
    IpCidr,
    Classical,
}

impl Display for RuleBehavior {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RuleBehavior::Domain => write!(f, "Domain"),
            RuleBehavior::IpCidr => write!(f, "Ipcidr"),
            RuleBehavior::Classical => write!(f, "Classical"),
        }
    }
}

#[derive(Debug)]
pub enum RuleFormat {
    Mrs,
    Yaml,
    Text,
}

impl Display for RuleFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RuleFormat::Mrs => write!(f, "MrsRule"),
            RuleFormat::Yaml => write!(f, "YamlRule"),
            RuleFormat::Text => write!(f, "TextRule"),
        }
    }
}

#[derive(Debug)]
pub struct RulePayload {
    count: i64,
    rules: Vec<String>,
}

trait Parser {
    fn parse(buf: &[u8], format: RuleFormat) -> Result<RulePayload, RuleParseError>;
}

pub struct RuleParser;
impl RuleParser {
    pub fn parse(
        file_path: &std::path::Path,
        behavior: &str,
        format: &str,
    ) -> Result<RulePayload, RuleParseError> {
        let buf = std::fs::read(file_path)?;
        let behavior = match behavior {
            "domain" => RuleBehavior::Domain,
            "ipcidr" => RuleBehavior::IpCidr,
            "classical" => RuleBehavior::Classical,
            _ => return Err(RuleParseError::InvalidBehavior),
        };
        let format = match format {
            "mrs" => RuleFormat::Mrs,
            "yaml" => RuleFormat::Yaml,
            "text" => RuleFormat::Text,
            _ => return Err(RuleParseError::InvalidRuleFormat),
        };
        match behavior {
            RuleBehavior::Domain => DomainParseStrategy::parse(&buf, format),
            RuleBehavior::IpCidr => IpCidrParseStrategy::parse(&buf, format),
            RuleBehavior::Classical => todo!(),
        }
    }
}

#[cfg(test)]
#[allow(deprecated)] // for std::env::home_dir() method, I code in Linux, so it is can get home dir
mod tests {
    use crate::{
        domain::DomainParseStrategy, error::RuleParseError, ipcidr::IpCidrParseStrategy, Parser,
        RuleFormat, RuleParser,
    };
    use anyhow::Result;
    use std::io::{Read, Write};

    /// Test parse domain from mrs file
    #[test]
    fn test_domain_mrs_parse() -> Result<(), RuleParseError> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let file_path = home_dir.join("Downloads/aliyun.mrs");
        let buf = std::fs::read(file_path)?;
        let format = RuleFormat::Mrs;
        let rule_payload = DomainParseStrategy::parse(&buf, format)?;

        assert_ne!(rule_payload.count, 0);
        assert_ne!(rule_payload.rules.len(), 0);
        // println!("rule payload: {:?}", rule_payload);

        let mut file = std::fs::File::create("domain.txt")?;
        file.write_all(rule_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;
        Ok(())
    }

    /// Test parse ipcidr from mrs file
    #[test]
    fn test_ipcidr_mrs_parse() -> Result<(), RuleParseError> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let file_path = home_dir.join("Downloads/ad.mrs");
        let buf = std::fs::read(file_path)?;
        let format = RuleFormat::Mrs;
        let rule_payload = IpCidrParseStrategy::parse(&buf, format)?;

        assert_ne!(rule_payload.count, 0);
        assert_ne!(rule_payload.rules.len(), 0);
        // println!("rule payload: {:?}", rule_payload);

        let mut file = std::fs::File::create("ipcidr.txt")?;
        file.write_all(rule_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;
        Ok(())
    }

    /// Test public parse method
    #[test]
    fn test_public_parse_method() -> Result<(), RuleParseError> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let file_path = home_dir.join("Downloads/ad.mrs");
        let rule_payload = RuleParser::parse(&file_path, "ipcidr", "mrs")?;
        assert_ne!(rule_payload.count, 0);
        assert_ne!(rule_payload.rules.len(), 0);
        let mut file = std::fs::File::create("ipcidr.txt")?;
        file.write_all(rule_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;
        Ok(())
    }

    /// Check if the contents of the rust cover file are different from the contents of the mihomo cover file
    #[test]
    fn check_diff() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let current_dir = std::env::current_dir()?;

        // domain
        // let rust_file_path = current_dir.join("domain.txt");
        // let mihomo_file_path = home_dir.join("Downloads/aliyun.txt");
        //
        // ipcidr
        let rust_file_path = current_dir.join("ipcidr.txt");
        let mihomo_file_path = home_dir.join("Downloads/ad.txt");

        let mut rust_cover_file = std::fs::File::open(rust_file_path)?;
        let mut rust_str = String::new();
        rust_cover_file.read_to_string(&mut rust_str)?;
        let rust_ips = rust_str
            .trim()
            .split('\n')
            .map(|s| s.to_owned())
            .collect::<Vec<String>>();

        let mut mihomo_cover_file = std::fs::File::open(mihomo_file_path)?;
        let mut mihomo_str = String::new();
        mihomo_cover_file.read_to_string(&mut mihomo_str)?;
        let mihomo_ips = mihomo_str
            .trim()
            .split('\n')
            .map(|s| s.to_owned())
            .collect::<Vec<String>>();

        assert_eq!(
            rust_ips.len(),
            mihomo_ips.len(),
            "content length is not the same between rust and mihomo cover files"
        );

        let total = rust_ips.len();
        for i in 0..total {
            let rust_val = &rust_ips[i];
            let mihomo_val = &mihomo_ips[i];
            assert_eq!(
                rust_val, mihomo_val,
                "the value at index {} is not the same between rust and mihomo cover files",
                i
            );
        }
        Ok(())
    }
}
