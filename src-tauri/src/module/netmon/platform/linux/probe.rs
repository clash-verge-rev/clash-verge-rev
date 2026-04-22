//! Linux 采样的纯函数辅助模块：sysfs / procfs 解析、iface_type 分类、subnets 组装。
//!
//! I/O 放在 `read_*` / `build_*` 等薄壳函数里（只做路径拼接 + 读文件 + 解析），
//! 解析逻辑与分类判断全部抽为纯函数方便单测。
//!
//! 采样策略：enumerate 全量 admin-up link 后由
//! [`super::super::context::build_context`] 统一做过滤 / 截断；平台 sampler 不
//! 负责挑 primary。`classify_iface_type` 返回 [`IfaceType`] 枚举，与 Windows /
//! macOS 对齐。

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::Path;

use anyhow::{Context as _, Result};
use network_interface::{Addr, NetworkInterface};

use crate::module::netmon::context::IfaceType;

/// Linux 侧 iface 分类：sysfs I/O 版。返回 [`IfaceType`] 枚举（对应 mihomo
/// `iface_type` wire 字符串）。
pub fn classify_iface_type(name: &str) -> IfaceType {
    let base = format!("/sys/class/net/{name}");
    let wireless = Path::new(&format!("{base}/wireless")).exists();
    let tun_flags = Path::new(&format!("{base}/tun_flags")).exists();
    let sysfs_type = std::fs::read_to_string(format!("{base}/type"))
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok());
    classify_iface_type_pure(name, wireless, tun_flags, sysfs_type)
}

/// 纯函数版，接受"已读出的 sysfs 状态"作为输入，便于单测。
///
/// 判定顺序：
/// 1. `wireless/` 存在 → `Wifi`
/// 2. `tun_flags` 存在 → `Vpn`
/// 3. 名字 `wg*` / `ppp*` → `Vpn`（WireGuard 不走 TUN 子系统、PPP 多为拨号 VPN）
/// 4. 名字 `wwan*` / `wwp*` → `Wwan`（**早于** sysfs type=1 的 ethernet 判定，
///    避免 USB tethering / RNDIS 的 ARPHRD_ETHER 被误判为以太网）
/// 5. sysfs type == 772 → `Loopback`
/// 6. sysfs type == 1 (ARPHRD_ETHER) → `Ethernet`
/// 7. 其他 → `Other`
///
/// Linux 侧不区分 cellular vs wwan，统一归 `Wwan`。
pub fn classify_iface_type_pure(
    name: &str,
    wireless_exists: bool,
    tun_flags_exists: bool,
    sysfs_type: Option<u32>,
) -> IfaceType {
    if wireless_exists {
        return IfaceType::Wifi;
    }
    if tun_flags_exists {
        return IfaceType::Vpn;
    }
    if name.starts_with("wg") || name.starts_with("ppp") {
        return IfaceType::Vpn;
    }
    if name.starts_with("wwan") || name.starts_with("wwp") {
        return IfaceType::Wwan;
    }
    match sysfs_type {
        Some(772) => IfaceType::Loopback,
        Some(1) => IfaceType::Ethernet,
        _ => IfaceType::Other,
    }
}

/// 一条 `/proc/net/arp` 记录。
#[derive(Debug, PartialEq, Eq)]
pub struct ArpEntry {
    pub ip: IpAddr,
    pub mac: String,
    pub device: String,
}

/// 解析 `/proc/net/arp` 文本，返回记录列表；过滤全零（未解析）MAC。
///
/// `/proc/net/arp` 列：`IP address | HW type | Flags | HW address | Mask | Device`
pub fn parse_proc_arp(text: &str) -> Vec<ArpEntry> {
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if i == 0 {
            continue; // header
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 6 {
            continue;
        }
        if cols[3] == "00:00:00:00:00:00" {
            continue;
        }
        let Ok(ip) = cols[0].parse::<IpAddr>() else {
            continue;
        };
        out.push(ArpEntry {
            ip,
            mac: cols[3].to_string(),
            device: cols[5].to_string(),
        });
    }
    out
}

/// 查 `/proc/net/arp` 得到指定接口上 IPv4 gateway 对应 MAC。
///
/// 多网卡场景下相同 IP 可能出现在多条记录中（如公司 VPN 与家庭路由都用
/// 192.168.1.1），因此必须把接口名纳入匹配，避免把其他接口的 MAC 误当成
/// primary 的 gateway。
pub fn read_gateway_mac_v4(ip: Ipv4Addr, iface: &str) -> Result<String> {
    let text = std::fs::read_to_string("/proc/net/arp").context("read /proc/net/arp")?;
    let target = IpAddr::V4(ip);
    parse_proc_arp(&text)
        .into_iter()
        .find(|e| e.ip == target && e.device == iface)
        .map(|e| e.mac)
        .with_context(|| format!("gateway {} on {} not in arp cache", ip, iface))
}

/// 把 IPv4 子网掩码转成前缀长度；合法掩码必须是"前 N 个 1 + 剩余全 0"。
pub fn prefix_from_mask_v4(mask: Ipv4Addr) -> Option<u8> {
    let bits = u32::from(mask);
    let leading = bits.leading_ones() as u8;
    if leading == 32 {
        return Some(32);
    }
    let rest = bits << leading;
    if rest != 0 {
        return None;
    }
    Some(leading)
}

/// 把 IPv6 子网掩码转成前缀长度。同样要求前缀 1 + 后缀 0。
pub fn prefix_from_mask_v6(mask: Ipv6Addr) -> Option<u8> {
    let bits = u128::from(mask);
    let leading = bits.leading_ones() as u8;
    if leading == 128 {
        return Some(128);
    }
    let rest = bits << leading;
    if rest != 0 {
        return None;
    }
    Some(leading)
}

/// 把 IPv4 地址 mask 到网络地址。
pub fn network_address_v4(ip: Ipv4Addr, prefix: u8) -> Ipv4Addr {
    if prefix >= 32 {
        return ip;
    }
    if prefix == 0 {
        return Ipv4Addr::UNSPECIFIED;
    }
    let bits = u32::from(ip);
    let mask = u32::MAX << (32 - prefix);
    Ipv4Addr::from(bits & mask)
}

/// 把 IPv6 地址 mask 到网络地址。
pub fn network_address_v6(ip: Ipv6Addr, prefix: u8) -> Ipv6Addr {
    if prefix >= 128 {
        return ip;
    }
    if prefix == 0 {
        return Ipv6Addr::UNSPECIFIED;
    }
    let bits = u128::from(ip);
    let mask = u128::MAX << (128 - prefix);
    Ipv6Addr::from(bits & mask)
}

/// 构造 subnets（**网络 CIDR** 形式，如 `192.168.1.0/24`）。`ifaces` 由调用方
/// （`sampler::collect`）统一在外层 `NetworkInterface::show()` 一次后传引用，
/// 避免 per-iface 重复拉取整机链表（与 macOS sampler 口径一致）。
///
/// 跳过 IPv6 link-local `fe80::/10`：matcher 语义下 link-local 对"是否在同一
/// 子网"没有意义，跨 iface 重复严重（与 Windows / macOS sampler 口径一致）。
pub fn build_subnets_from(ifaces: &[NetworkInterface], iface_name: &str) -> Vec<String> {
    ifaces
        .iter()
        .filter(|i| i.name == iface_name)
        .flat_map(|i| i.addr.iter())
        .filter_map(addr_to_network_cidr)
        .collect()
}

fn addr_to_network_cidr(addr: &Addr) -> Option<String> {
    match addr {
        Addr::V4(v) => {
            let mask = v.netmask?;
            let prefix = prefix_from_mask_v4(mask)?;
            // 0.0.0.0/0 作为 subnet 会对 matcher 表现为通配，拒绝
            if prefix == 0 {
                return None;
            }
            let net = network_address_v4(v.ip, prefix);
            Some(format!("{}/{}", net, prefix))
        }
        Addr::V6(v) => {
            let mask = v.netmask?;
            let prefix = prefix_from_mask_v6(mask)?;
            if prefix == 0 {
                return None;
            }
            if is_ipv6_link_local(v.ip) {
                return None;
            }
            let net = network_address_v6(v.ip, prefix);
            Some(format!("{}/{}", net, prefix))
        }
    }
}

const fn is_ipv6_link_local(ip: Ipv6Addr) -> bool {
    let seg = ip.segments()[0];
    (seg & 0xffc0) == 0xfe80
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    // ---------- iface_type 分类 ----------

    #[test]
    fn classify_wifi() {
        assert_eq!(
            classify_iface_type_pure("wlan0", true, false, None),
            IfaceType::Wifi
        );
    }

    #[test]
    fn classify_tun_as_vpn() {
        assert_eq!(
            classify_iface_type_pure("tun0", false, true, Some(65534)),
            IfaceType::Vpn
        );
    }

    #[test]
    fn classify_wireguard_by_name() {
        // wg0 在 4.12+ 内核里不走 TUN 子系统，没有 tun_flags；按名字兜底为 vpn
        assert_eq!(
            classify_iface_type_pure("wg0", false, false, Some(65534)),
            IfaceType::Vpn
        );
    }

    #[test]
    fn classify_ppp_as_vpn() {
        assert_eq!(
            classify_iface_type_pure("ppp0", false, false, Some(512)),
            IfaceType::Vpn
        );
    }

    #[test]
    fn classify_wwan_name_overrides_ether() {
        // USB tethering / RNDIS 的 ARPHRD_ETHER=1，但名字是 wwan*
        assert_eq!(
            classify_iface_type_pure("wwan0", false, false, Some(1)),
            IfaceType::Wwan
        );
        assert_eq!(
            classify_iface_type_pure("wwp5s0", false, false, Some(1)),
            IfaceType::Wwan
        );
    }

    #[test]
    fn classify_loopback() {
        assert_eq!(
            classify_iface_type_pure("lo", false, false, Some(772)),
            IfaceType::Loopback
        );
    }

    #[test]
    fn classify_ethernet() {
        assert_eq!(
            classify_iface_type_pure("eth0", false, false, Some(1)),
            IfaceType::Ethernet
        );
    }

    #[test]
    fn classify_other() {
        assert_eq!(
            classify_iface_type_pure("br0", false, false, Some(1)),
            IfaceType::Ethernet // 注：桥接口报 ARPHRD_ETHER=1，分类成 ethernet；虚拟桥
                                // 过滤由 build_context 的正则负责
        );
        assert_eq!(
            classify_iface_type_pure("foo", false, false, None),
            IfaceType::Other
        );
    }

    // ---------- /proc/net/arp ----------

    #[test]
    fn parse_proc_arp_skips_zero_mac() {
        let text = "IP address       HW type     Flags       HW address            Mask     Device\n\
            192.168.1.1      0x1         0x2         aa:bb:cc:dd:ee:ff     *        wlan0\n\
            10.0.0.2         0x1         0x0         00:00:00:00:00:00     *        eth0\n";
        let entries = parse_proc_arp(text);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ip, "192.168.1.1".parse::<IpAddr>().unwrap());
        assert_eq!(entries[0].mac, "aa:bb:cc:dd:ee:ff");
        assert_eq!(entries[0].device, "wlan0");
    }

    #[test]
    fn parse_proc_arp_skips_short_lines() {
        let text = "IP address       HW type     Flags       HW address            Mask     Device\n\
            192.168.1.1      0x1\n";
        assert!(parse_proc_arp(text).is_empty());
    }

    // ---------- 掩码 / network address ----------

    #[test]
    fn prefix_from_mask_v4_common() {
        assert_eq!(prefix_from_mask_v4(Ipv4Addr::new(255, 255, 255, 0)), Some(24));
        assert_eq!(prefix_from_mask_v4(Ipv4Addr::new(255, 255, 255, 255)), Some(32));
        assert_eq!(prefix_from_mask_v4(Ipv4Addr::new(0, 0, 0, 0)), Some(0));
    }

    #[test]
    fn prefix_from_mask_v4_rejects_non_contiguous() {
        assert_eq!(prefix_from_mask_v4(Ipv4Addr::new(255, 0, 255, 0)), None);
    }

    #[test]
    fn prefix_from_mask_v6_common() {
        assert_eq!(
            prefix_from_mask_v6("ffff:ffff:ffff:ffff::".parse().unwrap()),
            Some(64)
        );
    }

    #[test]
    fn network_address_v4_masks_host_bits() {
        let ip: Ipv4Addr = "192.168.1.23".parse().unwrap();
        assert_eq!(
            network_address_v4(ip, 24),
            "192.168.1.0".parse::<Ipv4Addr>().unwrap()
        );
    }

    #[test]
    fn ipv6_link_local_detected() {
        assert!(is_ipv6_link_local("fe80::1".parse().unwrap()));
        assert!(!is_ipv6_link_local("2001:db8::1".parse().unwrap()));
        assert!(!is_ipv6_link_local("fec0::1".parse().unwrap()));
    }
}
