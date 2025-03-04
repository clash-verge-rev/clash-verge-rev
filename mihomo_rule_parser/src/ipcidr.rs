use crate::{error::RuleParseError, utils, Parser, RuleBehavior, RuleFormat, RulePayload};
use byteorder::{BigEndian, ReadBytesExt};
use std::io::{Cursor, Read};
use std::{
    fmt::{Debug, Display},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct IpRange {
    from: IpAddr,
    to: IpAddr,
}

impl IpRange {
    pub fn prefixes(&self) -> Vec<Prefix> {
        match (self.from, self.to) {
            (IpAddr::V4(from), IpAddr::V4(to)) => ipv4_prefixes(from, to),
            (IpAddr::V6(from), IpAddr::V6(to)) => ipv6_prefixes(from, to),
            _ => panic!("IP version mismatch between from and to addresses"),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Prefix {
    addr: IpAddr,
    prefix_len: u8,
}

impl Prefix {
    fn new(addr: IpAddr, prefix_len: u8) -> Self {
        Self { addr, prefix_len }
    }
}

impl Display for Prefix {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.addr, self.prefix_len)
    }
}

/// 将 IPv4 地址转换为 u32 整数
fn ip_to_u32(ip: Ipv4Addr) -> u32 {
    u32::from_be_bytes(ip.octets())
}

/// 将 u32 整数转换为 IPv4 地址
fn u32_to_ip(num: u32) -> IpAddr {
    IpAddr::V4(Ipv4Addr::from(num.to_be_bytes()))
}

/// 将 IPv6 地址转换为 u128 整数
fn ip_to_u128(ip: Ipv6Addr) -> u128 {
    u128::from_be_bytes(ip.octets())
}

/// 将 u128 整数转换为 IPv6 地址
fn u128_to_ip(num: u128) -> IpAddr {
    IpAddr::V6(Ipv6Addr::from(num.to_be_bytes()))
}

/// IPv4 处理
fn ipv4_prefixes(from: Ipv4Addr, to: Ipv4Addr) -> Vec<Prefix> {
    let mut from = ip_to_u32(from);
    let mut to = ip_to_u32(to);

    if from > to {
        std::mem::swap(&mut from, &mut to);
    }

    let mut cidrs = Vec::new();

    while from <= to {
        let trailing_zeros = from.trailing_zeros().min(31) as u8;
        let mut prefix = 32 - trailing_zeros;
        let (block_start, block_size) = loop {
            let mask = u32::MAX << (32 - prefix);
            let block_start = from & mask;
            let block_size = 1u32 << (32 - prefix);
            let block_end = match block_start.checked_add(block_size - 1) {
                Some(e) => e,
                None => u32::MAX,
            };

            if block_start >= from && block_end <= to {
                break (block_start, block_size);
            }

            prefix += 1;
            if prefix > 32 {
                prefix = 32;
                break (from, 1);
            }
        };

        cidrs.push(Prefix::new(u32_to_ip(block_start), prefix));

        from = match block_start.checked_add(block_size) {
            Some(s) => s,
            None => break,
        };
    }

    cidrs
}

/// IPv6 处理（128位实现）
fn ipv6_prefixes(from: Ipv6Addr, to: Ipv6Addr) -> Vec<Prefix> {
    let mut from = ip_to_u128(from);
    let mut to = ip_to_u128(to);

    if from > to {
        std::mem::swap(&mut from, &mut to);
    }

    let mut prefixes = Vec::new();

    while from <= to {
        let trailing_zeros = from.trailing_zeros().min(127) as u8;
        let mut prefix = 128 - trailing_zeros;
        let (block_start, block_size) = loop {
            let mask = u128::MAX << (128 - prefix);
            let block_start = from & mask;
            let block_size = match 1u128.checked_shl((128 - prefix) as u32) {
                Some(s) => s,
                None => {
                    prefix = 128;
                    break (from, 1);
                }
            };
            let block_end = match block_start.checked_add(block_size.checked_sub(1).unwrap_or(0)) {
                Some(e) => e,
                None => u128::MAX,
            };

            if block_start >= from && block_end <= to {
                break (block_start, block_size);
            }

            prefix += 1;
            if prefix > 128 {
                prefix = 128;
                break (from, 1);
            }
        };

        prefixes.push(Prefix::new(u128_to_ip(block_start), prefix));

        from = match block_start.checked_add(block_size) {
            Some(s) => s,
            None => break,
        };
    }

    prefixes
}

trait IpCidrTransform {
    fn addr_from_16(a16: [u8; 16]) -> IpAddr;
    fn unmap(&self) -> IpAddr;
    fn ip_range(from: IpAddr, to: IpAddr) -> IpRange;
}

impl IpCidrTransform for IpAddr {
    /// 将 16 字节数组转换为 IPv6 地址
    fn addr_from_16(a16: [u8; 16]) -> IpAddr {
        IpAddr::V6(Ipv6Addr::from(a16))
    }

    /// 解映射 IPv4 映射的 IPv6 地址
    fn unmap(&self) -> IpAddr {
        if let IpAddr::V6(v6) = self {
            let octets = v6.octets();

            // 检查是否是 IPv4 映射地址 (::ffff:0:0/96)
            if octets[0..10].iter().all(|&b| b == 0) && octets[10] == 0xff && octets[11] == 0xff {
                // 提取最后 4 个字节作为 IPv4 地址
                let v4_bytes = [octets[12], octets[13], octets[14], octets[15]];
                return IpAddr::V4(Ipv4Addr::from(v4_bytes));
            }
            IpAddr::V6(v6.clone())
        } else {
            self.clone()
        }
    }

    /// 创建一个 IP 地址范围
    fn ip_range(from: IpAddr, to: IpAddr) -> IpRange {
        IpRange { from, to }
    }
}

pub(crate) struct IpCidrParseStrategy;

impl Parser for IpCidrParseStrategy {
    fn parse(buf: &[u8], format: RuleFormat) -> Result<RulePayload, RuleParseError> {
        match format {
            RuleFormat::Mrs => parse_from_mrs(buf),
            RuleFormat::Yaml => utils::parse_from_yaml(buf),
            RuleFormat::Text => utils::parse_from_text(buf),
        }
    }
}

fn parse_from_mrs(buf: &[u8]) -> Result<RulePayload, RuleParseError> {
    // create ZSTD decoder
    let mut reader = zstd::Decoder::new(Cursor::new(buf))?;

    // validate mrs file
    let count = utils::validate_mrs(&mut reader, RuleBehavior::IpCidr)?;

    // version
    let mut version = [0u8; 1];
    reader.read_exact(&mut version)?;
    if version[0] != 1 {
        return Err(RuleParseError::InvalidVersion);
    }

    // length
    let length = reader.read_i64::<BigEndian>()?;
    if length < 1 {
        return Err(RuleParseError::InvalidLength(length));
    }

    let mut rules = Vec::<String>::with_capacity(length as usize);
    for _ in 0..length {
        // println!("------------------------------");
        let mut from = [0u8; 16];
        reader.read_exact(&mut from)?;
        let from_addr = IpAddr::addr_from_16(from).unmap();
        // println!("from: {:?}", from_addr);

        let mut to = [0u8; 16];
        reader.read_exact(&mut to)?;
        let to_addr = IpAddr::addr_from_16(to).unmap();
        // println!("to: {:?}", to_addr);

        // generate Ip range
        let range = IpAddr::ip_range(from_addr, to_addr);
        let prefixes = range.prefixes();
        for prefix in prefixes {
            // println!("prefix: {:?}", prefix);
            rules.push(prefix.to_string());
        }
    }

    Ok(RulePayload { count, rules })
}

#[cfg(test)]
#[allow(deprecated)]
mod tests {
    use anyhow::Result;

    use super::*;

    #[test]
    fn test_ipcidr_parse_from_mrs() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = format!(
            "{}/Downloads/meta-rules-dat/geo/geoip/ad.mrs",
            home_dir.display()
        );
        let buf = std::fs::read(path)?;
        let payload = IpCidrParseStrategy::parse(&buf, RuleFormat::Mrs)?;
        println!("payload: {:?}", payload);
        Ok(())
    }

    #[test]
    fn test_ipcidr_parse_from_yaml() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = format!(
            "{}/Downloads/meta-rules-dat/geo/geoip/ad.yaml",
            home_dir.display()
        );
        let buf = std::fs::read(path)?;
        let payload = IpCidrParseStrategy::parse(&buf, RuleFormat::Yaml)?;
        println!("payload: {:?}", payload);
        Ok(())
    }

    #[test]
    fn test_ipcidr_parse_from_text() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = format!(
            "{}/Downloads/meta-rules-dat/geo/geoip/ad.txt",
            home_dir.display()
        );
        let buf = std::fs::read(path)?;
        let payload = IpCidrParseStrategy::parse(&buf, RuleFormat::Text)?;
        println!("payload: {:?}", payload);
        Ok(())
    }
}
