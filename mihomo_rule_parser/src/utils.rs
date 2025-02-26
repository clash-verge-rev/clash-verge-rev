use std::io::Read;

use anyhow::Result;
use byteorder::{BigEndian, ReadBytesExt};

use crate::{error::RuleParseError, RuleBehavior};

/// MRSv1
const MRS_MAGIC: [u8; 4] = [b'M', b'R', b'S', 1];

/// Get the rule behavior based on the given behavior byte.
fn get_rule_behavior(behavior: u8) -> RuleBehavior {
    match behavior {
        0 => RuleBehavior::Domain,
        1 => RuleBehavior::IpCidr,
        _ => panic!("unknown behavior"),
    }
}

/// Validate MRS format and return the count of rules.
pub fn validate_mrs<R: Read>(
    reader: &mut R,
    expected_behavior: RuleBehavior,
) -> Result<i64, RuleParseError> {
    // 读取并校验 Magic Number
    let mut magic = [0u8; 4];
    reader.read_exact(&mut magic)?;
    if magic != MRS_MAGIC {
        return Err(RuleParseError::InvalidMagic);
    }

    // 读取并校验 Behavior
    let mut behavior = [0u8; 1];
    reader.read_exact(&mut behavior)?;
    let actual_behavior = get_rule_behavior(behavior[0]);
    if actual_behavior != expected_behavior {
        return Err(RuleParseError::BehaviorMismatch {
            expected: expected_behavior,
            actual: actual_behavior,
        });
    }

    // 读取 Count
    let count = reader.read_i64::<BigEndian>()?;

    // 读取 Extra 数据
    let extra_length = reader.read_i64::<BigEndian>()?;
    if extra_length < 0 {
        return Err(RuleParseError::InvalidLength(extra_length));
    }

    // for future use
    let _extra_data = if extra_length > 0 {
        let mut data = [0u8, extra_length as u8];
        reader.read_exact(&mut data)?;
        Some(data)
    } else {
        None
    };

    Ok(count)
}
