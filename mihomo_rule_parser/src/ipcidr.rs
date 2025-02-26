use crate::{error::RuleParseError, utils, Parser, RuleBehavior, RuleFormat, RulePayload};
use byteorder::{BigEndian, ReadBytesExt};
use std::io::{Cursor, Read};
use std::{
    fmt::{Debug, Display},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpRange {
    from: IpAddr,
    to: IpAddr,
}

impl IpRange {
    /// 创建 IP 范围并自动验证有效性
    pub fn new(from: IpAddr, to: IpAddr) -> Self {
        Self { from, to }
    }

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

/// 将 IPv4 地址转换为 u128 整数
fn ip_to_u128(ip: Ipv6Addr) -> u128 {
    u128::from_be_bytes(ip.octets())
}

/// 将 u128 整数转换为 IPv6 地址
fn u128_to_ip(num: u128) -> IpAddr {
    IpAddr::V6(Ipv6Addr::from(num.to_be_bytes()))
}

// fn ipv4_prefixes(from: Ipv4Addr, to: Ipv4Addr) -> Vec<Prefix> {
//     let mut start = ip_to_u32(from);
//     let end = ip_to_u32(to);
//     let mut cidrs = Vec::new();
//     while start <= end {
//         // 计算当前地址的最大可能前缀长度（最小掩码）
//         let max_prefix_len = 32 - (start.trailing_zeros().min(31) as u8);
//         let mut prefix_len = max_prefix_len;
//         let mut block_size: u32;
//         let mut block_start: u32;
//         let mut block_end: u32;

//         loop {
//             block_size = 1 << (32 - prefix_len);
//             block_start = start & (!(block_size - 1));
//             block_end = block_start + block_size - 1;

//             if block_start >= start && block_end <= end {
//                 break;
//             }

//             prefix_len += 1; // 增大前缀长度（缩小块）
//             if prefix_len > 32 {
//                 prefix_len = 32;
//                 break;
//             }
//         }

//         // 添加CIDR块
//         cidrs.push(Prefix {
//             addr: u32_to_ip(block_start),
//             prefix_len,
//         });

//         // 处理下一个块
//         start = block_end + 1;
//     }
//     cidrs
// }

// fn ipv6_prefixes(from: Ipv6Addr, to: Ipv6Addr) -> Vec<Prefix> {
//     let mut start = ip_to_u128(from);
//     let end = ip_to_u128(to);
//     let mut cidrs = Vec::new();
//     while start <= end {
//         // 计算当前地址的最大可能前缀长度（最小掩码）
//         let max_prefix_len = 128 - (start.trailing_zeros().min(127) as u8);
//         let mut prefix_len = max_prefix_len;
//         let mut block_size: u128;
//         let mut block_start: u128;
//         let mut block_end: u128;

//         loop {
//             block_size = 1 << (128 - prefix_len);
//             block_start = start & (!(block_size - 1));
//             block_end = block_start + block_size - 1;

//             if block_start >= start && block_end <= end {
//                 break;
//             }

//             prefix_len += 1; // 增大前缀长度（缩小块）
//             if prefix_len > 128 {
//                 prefix_len = 128;
//                 break;
//             }
//         }

//         // 添加CIDR块
//         cidrs.push(Prefix {
//             addr: u128_to_ip(block_start),
//             prefix_len,
//         });

//         // 处理下一个块
//         start = block_end + 1;
//     }
//     cidrs
// }

/// IPv4 专用处理
fn ipv4_prefixes(start: Ipv4Addr, end: Ipv4Addr) -> Vec<Prefix> {
    let mut start = u32::from(start);
    let mut end = u32::from(end);

    if start > end {
        std::mem::swap(&mut start, &mut end);
    }

    let mut cidrs = Vec::new();

    while start <= end {
        let max_prefix = 32 - start.trailing_zeros().min(31) as u8;
        let mut prefix = max_prefix;
        let (block_start, block_size) = loop {
            let mask = u32::MAX << (32 - prefix);
            let block_start = start & mask;
            let block_size = 1 << (32 - prefix);
            let block_end = block_start + block_size - 1;

            if block_start >= start && block_end <= end {
                break (block_start, block_size);
            }

            prefix += 1;
            if prefix > 32 {
                prefix = 32;
                break (start, 1);
            }
        };

        cidrs.push(Prefix::new(u32_to_ip(block_start), prefix));

        start = block_start + block_size;
    }

    cidrs
}

/// IPv6 专用处理（128位实现）
fn ipv6_prefixes(start: Ipv6Addr, end: Ipv6Addr) -> Vec<Prefix> {
    let mut start = u128::from(start);
    let mut end = u128::from(end);

    if start > end {
        std::mem::swap(&mut start, &mut end);
    }

    let mut cidrs = Vec::new();

    while start <= end {
        let trailing_zeros = start.trailing_zeros().min(127) as u8;
        let mut prefix = 128 - trailing_zeros;
        let (block_start, block_size) = loop {
            let mask = u128::MAX << (128 - prefix);
            let block_start = start & mask;
            let block_size = 1u128 << (128 - prefix);
            let block_end = block_start + block_size - 1;

            if block_start >= start && block_end <= end {
                break (block_start, block_size);
            }

            prefix += 1;
            if prefix > 128 {
                prefix = 128;
                break (start, 1);
            }
        };

        cidrs.push(Prefix::new(u128_to_ip(block_start), prefix));

        start = block_start + block_size;
    }

    cidrs
}

pub trait IpcidrTransform {
    fn addr_from_16(a16: [u8; 16]) -> IpAddr;
    fn unmap(&self) -> IpAddr;
    fn ip_range(from: IpAddr, to: IpAddr) -> IpRange;
}

impl IpcidrTransform for IpAddr {
    // 将 16 字节数组转换为 IPv6 地址
    fn addr_from_16(a16: [u8; 16]) -> IpAddr {
        IpAddr::V6(Ipv6Addr::from(a16))
    }

    // 解映射 IPv4 映射的 IPv6 地址
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

    fn ip_range(from: IpAddr, to: IpAddr) -> IpRange {
        IpRange { from, to }
    }
}

pub(crate) struct IpCidrParseStrategy;

impl Parser for IpCidrParseStrategy {
    fn parse(buf: &[u8], format: RuleFormat) -> Result<RulePayload, RuleParseError> {
        match format {
            RuleFormat::Mrs => Ok(parse_from_mrs(buf)?),
            RuleFormat::Yaml => todo!(),
            RuleFormat::Text => todo!(),
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
        let range = IpRange::new(from_addr, to_addr);
        let prefixes = range.prefixes();
        for prefix in prefixes {
            rules.push(prefix.to_string());
        }
    }

    Ok(RulePayload { count, rules })
}
