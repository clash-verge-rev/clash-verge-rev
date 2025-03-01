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
            _ => return Err(RuleParseError::InvalidFormat),
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
        let file_path = home_dir.join("Downloads/private.mrs");
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

    /// use git clone [mihomo rules](https://github.com/MetaCubeX/meta-rules-dat) and then checkout `meta` branch
    #[test]
    fn check_all_mihomo_mrs() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        // domain
        let check_behavior = "domain";
        let mrs_dir_path = home_dir.join("Downloads/meta-rules-dat/geo/geosite");
        // ipcidr
        // let check_behavior = "ipcidr";
        // let mrs_dir_path = home_dir.join("Downloads/meta-rules-dat/geo/geoip");

        let mrs_dir = std::fs::read_dir(&mrs_dir_path)?;
        let mut mrs_files = Vec::new();
        mrs_dir
            .into_iter()
            .filter(|entry| {
                let entry = entry.as_ref().expect("failed to read entry");
                entry.path().extension().map_or(false, |ext| ext == "mrs")
            })
            .for_each(|entry| {
                let entry = entry.expect("failed to read entry");
                let path = entry.path();
                let file_name = path.file_name().expect("failed to get file name");
                let file_name = file_name
                    .to_str()
                    .expect("failed to convert file name to string");
                mrs_files.push(file_name.to_string());
            });

        // starting check diff
        let mut mihomo_convert_error_file = vec![];
        for file_name in &mrs_files {
            // use mihomo command to convert mrs files to txt files
            let mrs_file_path = mrs_dir_path.join(file_name);
            let txt_file_path = mrs_file_path.with_extension("txt");
            let output = std::process::Command::new("verge-mihomo")
                .args([
                    "convert-ruleset",
                    check_behavior,
                    "mrs",
                    &mrs_file_path.display().to_string(),
                    &txt_file_path.display().to_string(),
                ])
                .output()?;

            // use rust to convert mrs files to txt files
            println!("rust parse file name: {}", file_name);
            if !output.status.success() {
                println!("mihomo convert error, output: {:?}", output);
                mihomo_convert_error_file.push(file_name.clone());
                continue;
            }
            let rule_payload = RuleParser::parse(&mrs_file_path, check_behavior, "mrs")?;

            // check file content diff
            let content_r_items = rule_payload.rules;
            let content_m = std::fs::read_to_string(&txt_file_path)?;
            let content_m_items = content_m
                .trim()
                .split('\n')
                .map(|line| line.trim().to_string())
                .collect::<Vec<String>>();
            assert_eq!(
                content_r_items.len(),
                content_m_items.len(),
                "[{}] content length is not the same between rust and mihomo cover files",
                file_name
            );
            // iterate all items and compare
            let total = content_r_items.len();
            for i in 0..total {
                let rust_val = &content_r_items[i];
                let mihomo_val = &content_m_items[i];
                assert_eq!(
                    rust_val, mihomo_val,
                    "the value at index {} is not the same between rust and mihomo cover files",
                    i
                );
            }
        }

        if !mihomo_convert_error_file.is_empty() {
            println!(
                "mihomo convert error files: {:?}",
                mihomo_convert_error_file
            );
        }

        Ok(())
    }
}
