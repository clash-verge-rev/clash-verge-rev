use crate::{
    Parser, RuleBehavior, RuleFormat,
    error::{Result, RuleParseError},
    utils,
};

/// classical parse strategy
pub(crate) struct ClassicalParseStrategy;

impl Parser for ClassicalParseStrategy {
    fn parse(buf: &[u8], format: crate::RuleFormat) -> Result<crate::RulePayload> {
        match format {
            RuleFormat::Mrs => Err(RuleParseError::UnsupportedFormat(
                RuleBehavior::Classical,
                RuleFormat::Mrs,
            )),
            RuleFormat::Yaml => utils::parse_from_yaml(buf),
            RuleFormat::Text => utils::parse_from_text(buf),
        }
    }
}

#[cfg(test)]
#[allow(deprecated)]
mod tests {

    use std::{io::Read, path::PathBuf, process::Command};

    use super::*;

    fn init_meta_rules() -> Result<PathBuf> {
        let tmp_dir = std::env::temp_dir();
        let rules_dir = tmp_dir.join("meta-rules-dat");
        let exists = std::fs::exists(&rules_dir)?;
        if exists {
            let commands: Vec<Vec<&str>> = vec![vec!["restore", "."], vec!["clean", "-fd"], vec!["pull"]];
            commands.iter().for_each(|args| {
                Command::new("git")
                    .args(args)
                    .current_dir(&rules_dir)
                    .spawn()
                    .expect("failed to spawn command")
                    .wait()
                    .expect("command not running");
            });
        } else {
            Command::new("git")
                .args(["clone", "-b", "meta", "https://github.com/MetaCubeX/meta-rules-dat.git"])
                .current_dir(&tmp_dir)
                .spawn()
                .expect("failed to clone rules")
                .wait()
                .expect("command not running");
        }
        Ok(rules_dir)
    }

    #[test]
    fn test_classical_parse_from_mrs() -> Result<()> {
        let rules_dir = init_meta_rules()?;
        let mut file = std::fs::File::open(rules_dir.join("geo/geoip/ad.mrs"))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        let payload = ClassicalParseStrategy::parse(&buf, RuleFormat::Mrs);
        assert!(matches!(
            payload,
            Err(RuleParseError::UnsupportedFormat(
                RuleBehavior::Classical,
                RuleFormat::Mrs
            ))
        ));
        Ok(())
    }

    #[test]
    fn test_classical_parse_from_yaml() -> Result<()> {
        let rules_dir = init_meta_rules()?;
        let mut file = std::fs::File::open(rules_dir.join("geo/geoip/classical/ad.yaml"))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        let payload = ClassicalParseStrategy::parse(&buf, RuleFormat::Yaml)?;
        println!("payload: {:?}", payload);
        Ok(())
    }

    #[test]
    fn test_classical_parse_from_text() -> Result<()> {
        let rules_dir = init_meta_rules()?;
        let mut file = std::fs::File::open(rules_dir.join("geo/geoip/classical/ad.list"))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        let payload = ClassicalParseStrategy::parse(&buf, RuleFormat::Text)?;
        println!("payload: {:?}", payload);
        Ok(())
    }
}
