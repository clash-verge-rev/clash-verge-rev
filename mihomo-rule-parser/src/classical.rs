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

    use super::*;

    #[test]
    fn test_classical_parse_from_mrs() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = home_dir.join("Downloads/meta-rules-dat/geo/geoip/ad.mrs");
        let buf = std::fs::read(path)?;
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
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = home_dir.join("Downloads/meta-rules-dat/geo/geoip/classical/ad.yaml");
        let buf = std::fs::read(path)?;
        let payload = ClassicalParseStrategy::parse(&buf, RuleFormat::Yaml)?;
        println!("payload: {:?}", payload);
        Ok(())
    }

    #[test]
    fn test_classical_parse_from_text() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = home_dir.join("Downloads/meta-rules-dat/geo/geoip/classical/ad.list");
        let buf = std::fs::read(path)?;
        let payload = ClassicalParseStrategy::parse(&buf, RuleFormat::Text)?;
        println!("payload: {:?}", payload);
        Ok(())
    }
}
