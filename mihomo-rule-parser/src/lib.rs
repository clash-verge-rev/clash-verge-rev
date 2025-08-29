#![allow(dead_code)]
use crate::error::Result;
use classical::ClassicalParseStrategy;
use domain::DomainParseStrategy;
pub use error::RuleParseError;
use ipcidr::IpCidrParseStrategy;
use serde::{Deserialize, Serialize};
use std::{fmt::Display, path::Path};

mod bitmap;
mod classical;
mod domain;
mod error;
mod ipcidr;
mod utils;

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

impl TryFrom<String> for RuleBehavior {
    type Error = RuleParseError;

    fn try_from(behavior: String) -> Result<Self> {
        match behavior.as_str() {
            "domain" => Ok(RuleBehavior::Domain),
            "ipcidr" => Ok(RuleBehavior::IpCidr),
            "classical" => Ok(RuleBehavior::Classical),
            _ => Err(RuleParseError::InvalidBehavior(behavior)),
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

impl TryFrom<String> for RuleFormat {
    type Error = RuleParseError;

    fn try_from(format: String) -> Result<Self> {
        match format.as_str() {
            "mrs" => Ok(RuleFormat::Mrs),
            "yaml" => Ok(RuleFormat::Yaml),
            "yml" => Ok(RuleFormat::Yaml),
            "text" => Ok(RuleFormat::Text),
            "txt" => Ok(RuleFormat::Text),
            _ => Err(RuleParseError::InvalidFormat(format)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
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
    fn parse(buf: &[u8], format: RuleFormat) -> Result<RulePayload>;
}

pub fn parse<P: AsRef<Path>>(file_path: P, behavior: RuleBehavior, format: RuleFormat) -> Result<RulePayload> {
    let buf = std::fs::read(file_path)?;
    match behavior {
        RuleBehavior::Domain => DomainParseStrategy::parse(&buf, format),
        RuleBehavior::IpCidr => IpCidrParseStrategy::parse(&buf, format),
        RuleBehavior::Classical => ClassicalParseStrategy::parse(&buf, format),
    }
}

#[cfg(test)]
#[allow(deprecated)] // for std::env::home_dir() method, I develop on Linux, so it can get home dir
mod tests {
    use crate::{
        RuleBehavior, RuleFormat,
        error::{Result, RuleParseError},
        parse,
    };
    use std::{
        io::{Read, Write},
        path::{Path, PathBuf},
        process::Command,
        sync::{Arc, Mutex},
        time::Instant,
    };

    fn init_meta_rules() -> Result<PathBuf> {
        let tmp_dir = std::env::temp_dir();
        let rules_dir = tmp_dir.join("meta-rules-dat");
        let exists = std::fs::exists(&rules_dir)?;
        if exists {
            // let mut child = Command::new("git")
            //     .current_dir("meta-rules-dat")
            //     .args(&["pull", "--force"])
            //     .spawn()
            //     .expect("failed to pull rules");
            // child.wait().expect("command not running");
        } else {
            let mut child = Command::new("git")
                .args(["clone", "-b", "meta", "https://github.com/MetaCubeX/meta-rules-dat.git"])
                .current_dir(&tmp_dir)
                .spawn()
                .expect("failed to clone rules");
            child.wait().expect("command not running");
        }
        Ok(rules_dir)
    }

    /// Test public parse method
    #[test]
    fn test_public_parse_method() -> Result<()> {
        let rules_dir = init_meta_rules()?;
        let test_out_dir = rules_dir.join("test_out");
        if !test_out_dir.exists() {
            std::fs::create_dir_all(&test_out_dir)?;
        }

        // domain
        let domain_mrs_path = rules_dir.join("geo/geosite/aliyun.mrs");
        let domain_mrs_payload = parse(&domain_mrs_path, RuleBehavior::Domain, RuleFormat::Mrs)?;
        assert_ne!(domain_mrs_payload.count, 0);
        assert_ne!(domain_mrs_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("domain_mrs.txt"))?;
        file.write_all(domain_mrs_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let domain_yaml_path = rules_dir.join("geo/geosite/aliyun.yaml");
        let domain_yaml_payload = parse(&domain_yaml_path, RuleBehavior::Domain, RuleFormat::Yaml)?;
        assert_ne!(domain_yaml_payload.count, 0);
        assert_ne!(domain_yaml_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("domain_yaml.txt"))?;
        file.write_all(domain_yaml_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let domain_txt_path = rules_dir.join("geo/geosite/aliyun.list");
        let domain_txt_payload = parse(&domain_txt_path, RuleBehavior::Domain, RuleFormat::Text)?;
        assert_ne!(domain_txt_payload.count, 0);
        assert_ne!(domain_txt_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("domain.txt"))?;
        file.write_all(domain_txt_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        // ipcidr
        let ipcidr_mrs_path = rules_dir.join("geo/geoip/private.mrs");
        let ipcidr_mrs_payload = parse(&ipcidr_mrs_path, RuleBehavior::IpCidr, RuleFormat::Mrs)?;
        assert_ne!(ipcidr_mrs_payload.count, 0);
        assert_ne!(ipcidr_mrs_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("ipcidr_mrs.txt"))?;
        file.write_all(ipcidr_mrs_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let ipcidr_yaml_path = rules_dir.join("geo/geoip/private.yaml");
        let ipcidr_yaml_payload = parse(&ipcidr_yaml_path, RuleBehavior::IpCidr, RuleFormat::Yaml)?;
        assert_ne!(ipcidr_yaml_payload.count, 0);
        assert_ne!(ipcidr_yaml_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("ipcidr_yaml.txt"))?;
        file.write_all(ipcidr_yaml_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let ipcidr_txt_path = rules_dir.join("geo/geoip/private.list");
        let ipcidr_txt_payload = parse(&ipcidr_txt_path, RuleBehavior::IpCidr, RuleFormat::Text)?;
        assert_ne!(ipcidr_txt_payload.count, 0);
        assert_ne!(ipcidr_txt_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("ipcidr.txt"))?;
        file.write_all(ipcidr_txt_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        // classical
        let classical_yaml_path = rules_dir.join("geo/geoip/classical/ad.yaml");
        let rule_payload = parse(&classical_yaml_path, RuleBehavior::Classical, RuleFormat::Yaml)?;
        assert_ne!(rule_payload.count, 0);
        assert_ne!(rule_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("classical_yaml.txt"))?;
        file.write_all(rule_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        let classical_txt_path = rules_dir.join("geo/geoip/classical/ad.list");
        let rule_payload = parse(&classical_txt_path, RuleBehavior::Classical, RuleFormat::Text)?;
        assert_ne!(rule_payload.count, 0);
        assert_ne!(rule_payload.rules.len(), 0);
        let mut file = std::fs::File::create(test_out_dir.join("classical.txt"))?;
        file.write_all(rule_payload.rules.join("\n").as_bytes())?;
        file.sync_all()?;

        Ok(())
    }

    /// Check if the contents of the src file are different from the contents of the target file
    fn check_diff<P: AsRef<Path>>(src_file: P, target_file: P) -> std::result::Result<(), String> {
        let mut src_str = String::new();
        std::fs::File::open(src_file)
            .map_err(|_| "src file not found".to_string())?
            .read_to_string(&mut src_str)
            .map_err(|_| "read src file error".to_string())?;
        let src_lines = src_str
            .trim()
            .split('\n')
            .map(|s| s.to_owned())
            .collect::<Vec<String>>();

        let mut target_str = String::new();
        std::fs::File::open(target_file)
            .map_err(|_| "target file not found".to_string())?
            .read_to_string(&mut target_str)
            .map_err(|_| "read target file error".to_string())?;
        let target_lines = target_str
            .trim()
            .split('\n')
            .map(|s| s.to_owned())
            .collect::<Vec<String>>();

        if src_lines.len() != target_lines.len() {
            return Err(format!(
                "content length is not the same between src and target files\n  src: {}\n  target: {}",
                src_lines.len(),
                target_lines.len()
            ));
        }

        let total = src_lines.len();
        for i in 0..total {
            let src_val = &src_lines[i];
            let target_val = &target_lines[i];
            if src_val != target_val {
                return Err(format!(
                    "the value at index {} is not the same between src and target files\n  src: {}\n  target: {}",
                    i, src_val, target_val
                ));
            }
        }
        Ok(())
    }

    #[test]
    fn check_all_mihomo_mrs() -> Result<()> {
        let start = Instant::now();
        let rules_dir = init_meta_rules()?;
        // test out dir
        let test_out_dir = rules_dir.join("test_out");
        if test_out_dir.exists() {
            std::fs::remove_dir_all(&test_out_dir)?;
        } else {
            std::fs::create_dir_all(&test_out_dir)?;
        }
        // mihomo out dir
        let mihomo_out_dir = test_out_dir.join("mihomo");
        if mihomo_out_dir.exists() {
            std::fs::remove_dir_all(&mihomo_out_dir)?;
        } else {
            std::fs::create_dir_all(&mihomo_out_dir)?;
        }
        // rust out dir
        let rust_out_dir = test_out_dir.join("rust");
        if rust_out_dir.exists() {
            std::fs::remove_dir_all(&rust_out_dir)?;
        } else {
            std::fs::create_dir_all(&rust_out_dir)?;
        }

        // domain
        let check_behavior = "domain";
        let mrs_dir_path = rules_dir.join("geo/geosite");
        // ipcidr
        // let check_behavior = "ipcidr";
        // let mrs_dir_path = base_dir.join("geo/geoip");

        let mrs_dir = std::fs::read_dir(&mrs_dir_path)?;
        let mut mrs_files = Vec::new();
        mrs_dir
            .into_iter()
            .filter(|entry| {
                let entry = entry.as_ref().expect("failed to read entry");
                entry.path().extension().is_some_and(|ext| ext == "mrs")
            })
            .for_each(|entry| {
                let entry = entry.expect("failed to read entry");
                let path = entry.path();
                let file_name = path.file_name().expect("failed to get file name");
                let file_name = file_name.to_str().expect("failed to convert file name to string");
                mrs_files.push(file_name.to_string());
            });

        let mihomo_convert_error_file = Arc::new(Mutex::new(Vec::new()));
        let check_diff_error_file = Arc::new(Mutex::new(Vec::new()));
        // starting check diff
        std::thread::scope(|s| {
            for file_name in &mrs_files {
                // use mihomo command to convert mrs files to txt files
                let mrs_file_path = mrs_dir_path.join(file_name);
                let mihomo_file_path = mihomo_out_dir.join(file_name).with_extension("txt");

                let rust_out_dir_ = rust_out_dir.clone();
                let mihomo_convert_error_file_ = mihomo_convert_error_file.clone();
                let check_diff_error_file_ = check_diff_error_file.clone();
                s.spawn(move || {
                    // let mut err_file = Vec::new();
                    let output = std::process::Command::new("verge-mihomo")
                        .args([
                            "convert-ruleset",
                            check_behavior,
                            "mrs",
                            &mrs_file_path.display().to_string(),
                            &mihomo_file_path.display().to_string(),
                        ])
                        .output()?;

                    // use rust to convert mrs files to txt files
                    if output.status.success() {
                        // println!("rust parse file name: {}", file_name);
                        let behavior = match check_behavior {
                            "domain" => RuleBehavior::Domain,
                            "ipcidr" => RuleBehavior::IpCidr,
                            _ => return Err(RuleParseError::InvalidBehavior(check_behavior.to_string())),
                        };
                        let rule_payload = parse(&mrs_file_path, behavior, RuleFormat::Mrs)?;
                        let rust_file_path = rust_out_dir_.join(file_name).with_extension("txt");
                        let mut file = std::fs::File::create(&rust_file_path)?;
                        file.write_all(rule_payload.rules.join("\n").as_bytes())?;
                        file.sync_all()?;

                        // check diff file
                        if let Err(err) = check_diff(rust_file_path, mihomo_file_path) {
                            println!("check diff [{}] error: {}", file_name, err);
                            check_diff_error_file_.lock().unwrap().push(file_name.clone());
                        } else {
                            println!("convert [{}] success", file_name);
                        }
                    } else {
                        println!("mihomo convert [{}] error, output: {:?}", file_name, output);
                        mihomo_convert_error_file_.lock().unwrap().push(file_name.clone());
                    }
                    Result::Ok(())
                });
            }
        });
        if !mihomo_convert_error_file.lock().unwrap().is_empty() {
            println!(
                "\n--------------------- mihomo convert error files (skip use rust to convert) -------------------------"
            );
            println!("{:?}", mihomo_convert_error_file.lock().unwrap());
            println!(
                "-----------------------------------------------------------------------------------------------------\n"
            );
        }
        if check_diff_error_file.lock().unwrap().is_empty() {
            println!("\n✅ all convert success!!!");
        } else {
            println!("\n------------------- ❌ check diff error files -----------------------");
            println!("{:?}", check_diff_error_file.lock().unwrap());
            println!("----------------------------------------------------------------------");
        }

        println!("cost time: {}ms", start.elapsed().as_millis());

        Ok(())
    }
}
