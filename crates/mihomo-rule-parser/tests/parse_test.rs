use std::{
    error::Error,
    io::Write,
    sync::{Arc, Mutex},
    time::Instant,
};

use mihomo_rule_parser::{RuleBehavior, RuleFormat, RuleParseError, parse};

mod common;

#[test]
fn test_public_parse_method() -> Result<(), Box<dyn Error>> {
    let rules_dir = common::init_meta_rules()?;
    let test_out_dir = rules_dir.join("test_out");
    if !test_out_dir.exists() {
        std::fs::create_dir_all(&test_out_dir)?;
    }

    // domain
    println!("\n--- parse domain file ---");
    let domain_mrs_path = rules_dir.join("geo/geosite/aliyun.mrs");
    let domain_mrs_payload = parse(&domain_mrs_path, RuleBehavior::Domain, RuleFormat::Mrs)?;
    assert_ne!(domain_mrs_payload.count, 0);
    assert_ne!(domain_mrs_payload.rules.len(), 0);
    let mrs_file_path = test_out_dir.join("domain_mrs.txt");
    let mut file = std::fs::File::create(&mrs_file_path)?;
    file.write_all(domain_mrs_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", mrs_file_path.display());

    let domain_yaml_path = rules_dir.join("geo/geosite/aliyun.yaml");
    let domain_yaml_payload = parse(&domain_yaml_path, RuleBehavior::Domain, RuleFormat::Yaml)?;
    assert_ne!(domain_yaml_payload.count, 0);
    assert_ne!(domain_yaml_payload.rules.len(), 0);
    let yaml_file_path = test_out_dir.join("domain_yaml.txt");
    let mut file = std::fs::File::create(&yaml_file_path)?;
    file.write_all(domain_yaml_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", yaml_file_path.display());

    let domain_txt_path = rules_dir.join("geo/geosite/aliyun.list");
    let domain_txt_payload = parse(&domain_txt_path, RuleBehavior::Domain, RuleFormat::Text)?;
    assert_ne!(domain_txt_payload.count, 0);
    assert_ne!(domain_txt_payload.rules.len(), 0);
    let text_file_path = test_out_dir.join("domain.txt");
    let mut file = std::fs::File::create(&text_file_path)?;
    file.write_all(domain_txt_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", text_file_path.display());

    // ipcidr
    println!("\n--- parse ipcidr file ---");
    let ipcidr_mrs_path = rules_dir.join("geo/geoip/private.mrs");
    let ipcidr_mrs_payload = parse(&ipcidr_mrs_path, RuleBehavior::IpCidr, RuleFormat::Mrs)?;
    assert_ne!(ipcidr_mrs_payload.count, 0);
    assert_ne!(ipcidr_mrs_payload.rules.len(), 0);
    let mrs_file_path = test_out_dir.join("ipcidr_mrs.txt");
    let mut file = std::fs::File::create(&mrs_file_path)?;
    file.write_all(ipcidr_mrs_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", mrs_file_path.display());

    let ipcidr_yaml_path = rules_dir.join("geo/geoip/private.yaml");
    let ipcidr_yaml_payload = parse(&ipcidr_yaml_path, RuleBehavior::IpCidr, RuleFormat::Yaml)?;
    assert_ne!(ipcidr_yaml_payload.count, 0);
    assert_ne!(ipcidr_yaml_payload.rules.len(), 0);
    let yaml_file_path = test_out_dir.join("ipcidr_yaml.txt");
    let mut file = std::fs::File::create(&yaml_file_path)?;
    file.write_all(ipcidr_yaml_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", yaml_file_path.display());

    let ipcidr_txt_path = rules_dir.join("geo/geoip/private.list");
    let ipcidr_txt_payload = parse(&ipcidr_txt_path, RuleBehavior::IpCidr, RuleFormat::Text)?;
    assert_ne!(ipcidr_txt_payload.count, 0);
    assert_ne!(ipcidr_txt_payload.rules.len(), 0);
    let text_file_path = test_out_dir.join("ipcidr.txt");
    let mut file = std::fs::File::create(&text_file_path)?;
    file.write_all(ipcidr_txt_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", text_file_path.display());

    // classical
    println!("\n--- parse classical file ---");
    let classical_yaml_path = rules_dir.join("geo/geoip/classical/ad.yaml");
    let rule_payload = parse(&classical_yaml_path, RuleBehavior::Classical, RuleFormat::Yaml)?;
    assert_ne!(rule_payload.count, 0);
    assert_ne!(rule_payload.rules.len(), 0);
    let yaml_file_path = test_out_dir.join("classical_yaml.txt");
    let mut file = std::fs::File::create(&yaml_file_path)?;
    file.write_all(rule_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", yaml_file_path.display());

    let classical_txt_path = rules_dir.join("geo/geoip/classical/ad.list");
    let rule_payload = parse(&classical_txt_path, RuleBehavior::Classical, RuleFormat::Text)?;
    assert_ne!(rule_payload.count, 0);
    assert_ne!(rule_payload.rules.len(), 0);
    let text_file_path = test_out_dir.join("classical.txt");
    let mut file = std::fs::File::create(&text_file_path)?;
    file.write_all(rule_payload.rules.join("\n").as_bytes())?;
    file.sync_all()?;
    println!("check file: {}", text_file_path.display());

    Ok(())
}

#[test]
fn check_all_mihomo_mrs() -> Result<(), Box<dyn Error>> {
    let start = Instant::now();
    let rules_dir = common::init_meta_rules()?;
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
    // let mrs_dir_path = rules_dir.join("geo/geoip");

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
                #[cfg(target_os = "windows")]
                let verge_mihomo_path = r"D:\Clash Verge\verge-mihomo.exe";
                #[cfg(target_os = "linux")]
                let verge_mihomo_path = "verge-mihomo";
                let output = std::process::Command::new(verge_mihomo_path)
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
                    if let Err(err) = common::check_diff(rust_file_path, mihomo_file_path) {
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
        println!("\n--------------- mihomo convert error files (skip use rust to convert) -------------------");
        println!("{:?}", mihomo_convert_error_file.lock().unwrap());
        println!("-----------------------------------------------------------------------------------------\n");
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
