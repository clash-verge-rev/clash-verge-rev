use std::{
    env::current_dir,
    io::{Read, Write},
};

use anyhow::Result;
use mihomo_config::config::raw_config::RawConfig;
use serde_yaml_ng::Value;

#[test]
fn test_parse_config() -> Result<()> {
    let file = current_dir()?.join("tests/example.yaml");
    let mut file = std::fs::File::open(file)?;
    let mut config = String::new();
    file.read_to_string(&mut config)?;
    let mut value = serde_yaml_ng::from_str::<Value>(&config)?;
    value.apply_merge()?;
    let config = serde_yaml_ng::from_str::<RawConfig>(&serde_yaml_ng::to_string(&value)?)?;
    let mut out_file = std::fs::File::create("tests/example-out.yaml")?;
    let res_str = serde_yaml_ng::to_string(&config)?;
    out_file.write_all(res_str.as_bytes())?;

    Ok(())
}
