use crate::{Parser, RuleFormat};

pub(crate) struct ClassicalParseStrategy;

impl Parser for ClassicalParseStrategy {
    fn parse(
        _buf: &[u8],
        format: crate::RuleFormat,
    ) -> anyhow::Result<crate::RulePayload, crate::error::RuleParseError> {
        match format {
            RuleFormat::Mrs => todo!(),
            RuleFormat::Yaml => todo!(),
            RuleFormat::Text => todo!(),
        }
    }
}
