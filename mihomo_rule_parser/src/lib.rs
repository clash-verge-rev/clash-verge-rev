#![allow(dead_code)]
use anyhow::Result;
use classical::ClassicalParseStrategy;
use domain::DomainParseStrategy;
use error::RuleParseError;
use ipcidr::IpCidrParseStrategy;
use serde::{Deserialize, Serialize};
use std::{fmt::Display, path::Path};

mod bitmap;
mod utils;

mod classical;
mod domain;
pub mod error;
mod ipcidr;

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
    fn parse(buf: &[u8], format: RuleFormat) -> Result<RulePayload, RuleParseError>;
}

/// public rule parser
pub struct RuleParser;

impl RuleParser {
    pub fn parse<P: AsRef<Path>>(
        file_path: P,
        behavior: RuleBehavior,
        format: RuleFormat,
    ) -> Result<RulePayload, RuleParseError> {
        let buf = std::fs::read(file_path)?;
        match behavior {
            RuleBehavior::Domain => DomainParseStrategy::parse(&buf, format),
            RuleBehavior::IpCidr => IpCidrParseStrategy::parse(&buf, format),
            RuleBehavior::Classical => ClassicalParseStrategy::parse(&buf, format),
        }
    }
}

#[cfg(test)]
#[allow(deprecated)] // for std::env::home_dir() method, I develop on Linux, so it can get home dir
mod tests {
    use crate::{error::RuleParseError, RuleBehavior, RuleFormat, RuleParser};
    use anyhow::{bail, Result};
    use std::io::{Read, Write};

    /// Test public parse method
    #[test]
    fn test_public_parse_method() -> Result<(), RuleParseError> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");

        // domain
        let domain_mrs_path = home_dir.join("Downloads/meta-rules-dat/geo/geosite/aliyun.mrs");
        let domain_mrs_payload =
            RuleParser::parse(&domain_mrs_path, RuleBehavior::Domain, RuleFormat::Mrs)?;
        assert_ne!(domain_mrs_payload.count, 0);
        assert_ne!(domain_mrs_payload.rules.len(), 0);
        let mut file = std::fs::File::create("domain_mrs.txt")?;
        file.write_all(domain_mrs_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let domain_yaml_path = home_dir.join("Downloads/meta-rules-dat/geo/geosite/aliyun.yaml");
        let domain_yaml_payload =
            RuleParser::parse(&domain_yaml_path, RuleBehavior::Domain, RuleFormat::Yaml)?;
        assert_ne!(domain_yaml_payload.count, 0);
        assert_ne!(domain_yaml_payload.rules.len(), 0);
        let mut file = std::fs::File::create("domain_yaml.txt")?;
        file.write_all(domain_yaml_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let domain_txt_path = home_dir.join("Downloads/meta-rules-dat/geo/geosite/aliyun.txt");
        let domain_txt_payload =
            RuleParser::parse(&domain_txt_path, RuleBehavior::Domain, RuleFormat::Text)?;
        assert_ne!(domain_txt_payload.count, 0);
        assert_ne!(domain_txt_payload.rules.len(), 0);
        let mut file = std::fs::File::create("domain.txt")?;
        file.write_all(domain_txt_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        // ipcidr
        let ipcidr_mrs_path = home_dir.join("Downloads/meta-rules-dat/geo/geoip/private.mrs");
        let ipcidr_mrs_payload =
            RuleParser::parse(&ipcidr_mrs_path, RuleBehavior::IpCidr, RuleFormat::Mrs)?;
        assert_ne!(ipcidr_mrs_payload.count, 0);
        assert_ne!(ipcidr_mrs_payload.rules.len(), 0);
        let mut file = std::fs::File::create("ipcidr_mrs.txt")?;
        file.write_all(ipcidr_mrs_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let ipcidr_yaml_path = home_dir.join("Downloads/meta-rules-dat/geo/geoip/private.yaml");
        let ipcidr_yaml_payload =
            RuleParser::parse(&ipcidr_yaml_path, RuleBehavior::IpCidr, RuleFormat::Yaml)?;
        assert_ne!(ipcidr_yaml_payload.count, 0);
        assert_ne!(ipcidr_yaml_payload.rules.len(), 0);
        let mut file = std::fs::File::create("ipcidr_yaml.txt")?;
        file.write_all(ipcidr_yaml_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let ipcidr_txt_path = home_dir.join("Downloads/meta-rules-dat/geo/geoip/private.txt");
        let ipcidr_txt_payload =
            RuleParser::parse(&ipcidr_txt_path, RuleBehavior::IpCidr, RuleFormat::Text)?;
        assert_ne!(ipcidr_txt_payload.count, 0);
        assert_ne!(ipcidr_txt_payload.rules.len(), 0);
        let mut file = std::fs::File::create("ipcidr.txt")?;
        file.write_all(ipcidr_txt_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        // classical
        let classical_yaml_path =
            home_dir.join("Downloads/meta-rules-dat/geo/geoip/classical/ad.yaml");
        let rule_payload = RuleParser::parse(
            &classical_yaml_path,
            RuleBehavior::Classical,
            RuleFormat::Yaml,
        )?;
        assert_ne!(rule_payload.count, 0);
        assert_ne!(rule_payload.rules.len(), 0);
        let mut file = std::fs::File::create("classical_yaml.txt")?;
        file.write_all(rule_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let classical_txt_path =
            home_dir.join("Downloads/meta-rules-dat/geo/geoip/classical/ad.list");
        let rule_payload = RuleParser::parse(
            &classical_txt_path,
            RuleBehavior::Classical,
            RuleFormat::Text,
        )?;
        assert_ne!(rule_payload.count, 0);
        assert_ne!(rule_payload.rules.len(), 0);
        let mut file = std::fs::File::create("classical.txt")?;
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
        let mihomo_file_path = home_dir.join("Downloads/meta-rules-dat/geo/geoip/private.txt");

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
        let mut mihomo_convert_error_file: Vec<String> = vec![];
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
            let behavior = match check_behavior {
                "domain" => RuleBehavior::Domain,
                "ipcidr" => RuleBehavior::IpCidr,
                _ => bail!("Invalid test behavior"),
            };
            let rule_payload = RuleParser::parse(&mrs_file_path, behavior, RuleFormat::Mrs)?;

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
