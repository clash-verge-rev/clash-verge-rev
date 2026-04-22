//! macOS 采样的纯函数辅助：iface_type 分类、sysctl RTF_LLINFO 解析、
//! 掩码转换、subnets 组装。
//!
//! I/O 放在 sampler.rs 的薄壳函数里（获取 sysctl bytes / getifaddrs 快照 / 调
//! SCDynamicStore），解析与分类全部抽成纯函数方便单测。
//!
//! 采样策略：enumerate 全量 service 由
//! [`super::super::context::build_context`] 统一做过滤 / 截断；平台 sampler 不
//! 负责挑 primary，因此这里没有 `is_physical_primary` 辅助。

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use network_interface::{Addr, NetworkInterface};

use crate::module::netmon::context::IfaceType;

// Apple XNU `bsd/net/if_types.h` 实际定义的 ifType（仅列出本模块使用到的）。
// libc 0.2.x 在 darwin target 下**不**导出 IFT_* 常量，本地复制作为真相源。
//
// 注意：IANA ifType 里的 `IEEE80211 = 71`（FreeBSD/NetBSD 使用）**不存在于 XNU**。
// 所有 macOS 版本上 802.11 Wi-Fi 网卡的 `if_data.ifi_type` 恒为 `IFT_ETHER`——
// Apple 内核把 Wi-Fi 注册到 `IFNET_FAMILY_ETHERNET` 以复用 L2 栈（Wi-Fi 帧桥接
// 到 802.3 后与 Ethernet 兼容）。区分 Wi-Fi / 有线必须走 CoreWLAN
// （`wifi::is_wifi_interface`），sampler 会在得到 `ethernet` 后用它二次判定升级
// 为 `wifi`。
pub const IFT_ETHER: u8 = 6;
pub const IFT_PPP: u8 = 23;
pub const IFT_LOOP: u8 = 24;
pub const IFT_TUNNEL: u8 = 131;
pub const IFT_CELLULAR: u8 = 255;

/// `ifi_type` + name 前缀 → [`IfaceType`] 语义映射。
///
/// 判定顺序（先 Type 后 name 兜底，与 Linux/Windows 对齐）：
/// 1. ifi_type 分类得到 base
/// 2. 仅当 base 是 `Other` 时才看 name 前缀（避免正常 Ethernet 被误判）
/// 3. `utun*` / `ipsec*` / `tun*` / `tap*` / `ppp*` → `Vpn`
///
/// Wi-Fi 误分类为 `Ethernet` 的修正由调用方用 `wifi::is_wifi_interface` 二次判定：
/// 在得到 `Ethernet` 后按接口名问 CoreWLAN 升级为 `Wifi`。
pub fn classify_iface_type_pure(name: &str, ifi_type: u8) -> IfaceType {
    let base = match ifi_type {
        IFT_ETHER => IfaceType::Ethernet,
        IFT_PPP => IfaceType::Vpn, // PPPoE / PPTP / L2TP 拨号
        IFT_LOOP => IfaceType::Loopback,
        IFT_TUNNEL => IfaceType::Vpn, // 通用 tunnel（含 IPsec / gif / stf）
        IFT_CELLULAR => IfaceType::Cellular,
        _ => IfaceType::Other,
    };
    if base == IfaceType::Other && is_vpn_name(name) {
        return IfaceType::Vpn;
    }
    base
}

fn is_vpn_name(name: &str) -> bool {
    name.starts_with("utun")   // Apple 内置 IPsec / WireGuard 官方 app
        || name.starts_with("ipsec") // IPsec
        || name.starts_with("tun")   // Tunnelblick / OpenVPN 第三方
        || name.starts_with("tap")   // TAP-style OpenVPN
        || name.starts_with("ppp") // PPPoE / PPTP
}

// ============================= 掩码 / subnets ===============================

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

/// 构造 subnets（网络 CIDR）。`ifaces` 由调用方（`sampler::collect_sync`）统一
/// 在外层 `NetworkInterface::show()` 一次后传引用，避免 per-iface 重复拉取整
/// 机链表。
///
/// 跳过 IPv6 link-local `fe80::/10`：matcher 语义下 link-local 对"是否在同一
/// 子网"没有意义，跨 iface 重复严重（与 Windows sampler 口径一致）。
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

// ========================= sysctl RTF_LLINFO parser =========================
//
// `sysctl` 返回一段 u8 流，由多条 `rt_msghdr` + 变长 sockaddr 数组组成。每条
// 消息：[rt_msghdr] [sockaddr for each bit set in rtm_addrs]，sockaddr 之间按
// `ROUNDUP(sa_len)` 对齐（`sa_len == 0` 视为 4）。
//
// rtm_addrs 位图：
//   RTA_DST      = 0x01
//   RTA_GATEWAY  = 0x02
//   RTA_NETMASK  = 0x04
//   RTA_GENMASK  = 0x08
//   RTA_IFP      = 0x10
//   RTA_IFA      = 0x20
//   RTA_AUTHOR   = 0x40
//   RTA_BRD      = 0x80

pub const RTA_DST: i32 = 0x01;
pub const RTA_GATEWAY: i32 = 0x02;

/// rt_msghdr 字段偏移量（来自 Darwin `<net/route.h>` `struct rt_msghdr`）：
/// - rtm_msglen   @ 0, u16
/// - rtm_version  @ 2, u8
/// - rtm_type     @ 3, u8
/// - rtm_index    @ 4, u16
/// - _rtm_pad     @ 6, 2 bytes
/// - rtm_flags    @ 8, i32
/// - rtm_addrs    @ 12, i32
/// - rtm_pid      @ 16, i32
/// - rtm_seq      @ 20, i32
/// - rtm_errno    @ 24, i32
/// - rtm_use      @ 28, i32
/// - rtm_inits    @ 32, u32
/// - rtm_rmx      @ 36, 14 * u32 = 56 bytes
///   总 header 长度 = 92 字节
pub const RT_MSGHDR_LEN: usize = 92;
const RTM_MSGLEN_OFF: usize = 0;
const RTM_ADDRS_OFF: usize = 12;

/// 一条解析后的邻居记录（ARP / NDP）：IP → MAC + device index。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArpEntry {
    pub ip: IpAddr,
    pub mac: String,
    pub if_index: u16,
}

/// 解析 `sysctl [CTL_NET, PF_ROUTE, 0, AF_INET|AF_INET6, NET_RT_FLAGS, RTF_LLINFO]`
/// 输出。调用方按 family 分别查 ARP（IPv4）与 NDP（IPv6）邻居表；parser 自身接受
/// 两种消息，通过 RTA_DST 的 sa_family 区分（AF_INET=2 / AF_INET6=30）。
///
/// 逐条读取 rt_msghdr，根据 `rtm_addrs` 位图依序取 sockaddr：
/// - RTA_DST（AF_INET sockaddr_in / AF_INET6 sockaddr_in6）
/// - RTA_GATEWAY（AF_LINK sockaddr_dl）
/// - `sa_len == 0` 视为 4，按 `ROUNDUP(sa_len)` 对齐跳过下一项
/// - MAC 全零的条目过滤（INCOMPLETE 邻居）
///
/// 解析失败（buffer 截断 / 长度异常）时返回已成功解析的部分，不 panic。
pub fn parse_sysctl_rtm_llinfo(buf: &[u8]) -> Vec<ArpEntry> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off + RT_MSGHDR_LEN <= buf.len() {
        let msglen = u16::from_ne_bytes([buf[off + RTM_MSGLEN_OFF], buf[off + RTM_MSGLEN_OFF + 1]]) as usize;
        // 防御：msglen 非 0 但小于 header 长度（内核不会这么发，但保证 parser 不 panic）
        if msglen < RT_MSGHDR_LEN || off + msglen > buf.len() {
            break;
        }
        let addrs_bytes = &buf[off + RTM_ADDRS_OFF..off + RTM_ADDRS_OFF + 4];
        let rtm_addrs = i32::from_ne_bytes([addrs_bytes[0], addrs_bytes[1], addrs_bytes[2], addrs_bytes[3]]);
        let if_index = u16::from_ne_bytes([buf[off + 4], buf[off + 5]]);

        if let Some(entry) = parse_one_llinfo(&buf[off + RT_MSGHDR_LEN..off + msglen], rtm_addrs, if_index) {
            out.push(entry);
        }
        off += msglen;
    }
    out
}

/// 解析单条消息 payload（rt_msghdr 之后的 sockaddr 序列）。
///
/// 按 rtm_addrs bitmask 依次遇到各 sockaddr；我们只要 RTA_DST（IP）+
/// RTA_GATEWAY（MAC）。其余 sockaddr 跳过。
fn parse_one_llinfo(payload: &[u8], rtm_addrs: i32, if_index: u16) -> Option<ArpEntry> {
    let mut off = 0usize;
    let mut ip: Option<IpAddr> = None;
    let mut mac: Option<String> = None;

    // sockaddr 按 bit 位从 1 << 0 到 1 << 7 的顺序出现
    for bit_idx in 0..8 {
        let bit = 1i32 << bit_idx;
        if rtm_addrs & bit == 0 {
            continue;
        }
        if off >= payload.len() {
            break;
        }
        let sa_len = payload[off] as usize;
        let rounded = roundup_sa_len(sa_len);
        if sa_len > 0 && off + rounded > payload.len() {
            break;
        }

        if sa_len > 0 {
            let sa_family = payload[off + 1]; // AF_INET = 2, AF_INET6 = 30, AF_LINK = 18
            match bit {
                RTA_DST if sa_family == 2 => {
                    if off + 8 <= payload.len() && sa_len >= 8 {
                        let octets = [payload[off + 4], payload[off + 5], payload[off + 6], payload[off + 7]];
                        ip = Some(IpAddr::V4(Ipv4Addr::from(octets)));
                    }
                }
                RTA_DST if sa_family == 30 => {
                    // sockaddr_in6 on BSD/macOS: sa_len(1) sa_family(1) sin6_port(2)
                    //                             sin6_flowinfo(4) sin6_addr[16] sin6_scope_id(4)
                    //
                    // Darwin / KAME embedded scope：kernel 把 link-local 地址的
                    // interface index 嵌入 `sin6_addr[2..4]`。SCDynamicStore 读出
                    // 的 Router 是清零版本，NDP 表里的 dst 却是嵌入版本；不归一化
                    // `find_gateway_mac` 就比不上。
                    if off + 24 <= payload.len() && sa_len >= 24 {
                        let mut octets = [0u8; 16];
                        octets.copy_from_slice(&payload[off + 8..off + 24]);
                        if has_kame_embedded_scope(&octets) {
                            octets[2] = 0;
                            octets[3] = 0;
                        }
                        ip = Some(IpAddr::V6(Ipv6Addr::from(octets)));
                    }
                }
                RTA_GATEWAY if sa_family == 18 => {
                    // sockaddr_dl: sdl_len(1) sdl_family(1) sdl_index(2) sdl_type(1)
                    //              sdl_nlen(1) sdl_alen(1) sdl_slen(1) sdl_data[...]
                    if off + 8 <= payload.len() && sa_len >= 8 {
                        let sdl_nlen = payload[off + 5] as usize;
                        let sdl_alen = payload[off + 6] as usize;
                        let mac_start = off + 8 + sdl_nlen;
                        let mac_end = mac_start + sdl_alen;
                        if sdl_alen == 6 && mac_end <= payload.len() && mac_end <= off + sa_len {
                            let mac_bytes = &payload[mac_start..mac_end];
                            if mac_bytes != [0u8; 6] {
                                mac = Some(format_mac(mac_bytes));
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        off += rounded;
    }

    match (ip, mac) {
        (Some(ip), Some(mac)) => Some(ArpEntry { ip, mac, if_index }),
        _ => None,
    }
}

/// BSD sockaddr 对齐：`ROUNDUP(sa_len) = ((sa_len - 1) | 3) + 1`；`sa_len == 0` 视为 4。
pub const fn roundup_sa_len(sa_len: usize) -> usize {
    if sa_len == 0 {
        return 4;
    }
    ((sa_len - 1) | 3) + 1
}

/// 判定 IPv6 地址是否落在"Darwin/KAME 把 interface index 嵌入
/// `sin6_addr[2..4]`"的 scope 范围里——`fe80::/10`（link-local unicast）+
/// interface-local / link-local multicast。
///
/// multicast 地址第 2 字节布局：高 4 bit 是 flags，低 4 bit 是 scope；Apple
/// `in6_embedscope` 只对 scope=1 (interface-local) / scope=2 (link-local) 做
/// embedding，覆盖 `ff?1::/16` 与 `ff?2::/16`；scope=2 还有一个子例外：
/// `IN6_IS_ADDR_MC_LINKLOCAL` 排除 flags=0x30 的 unicast-based multicast
/// （RFC 3306，`ff3x::/16`），那类地址 bytes[2..4] 是有效数据字段（plen +
/// reserved），不能误清。
const fn has_kame_embedded_scope(octets: &[u8; 16]) -> bool {
    // fe80::/10：octets[0]==0xfe 且 octets[1] 的高 2 bit 为 10
    let link_local_unicast = octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80;
    // multicast：第 2 字节 = flags<<4 | scope
    let flags = octets[1] & 0xf0;
    let scope = octets[1] & 0x0f;
    let link_scope_multicast = octets[0] == 0xff && (scope == 0x01 || (scope == 0x02 && flags != 0x30));
    link_local_unicast || link_scope_multicast
}

/// 按 iface name（通过 if_index）过滤邻居表，返回匹配 primary IP 的 MAC。
pub fn find_gateway_mac(entries: &[ArpEntry], target_ip: IpAddr, if_index: u16) -> Option<String> {
    entries
        .iter()
        .find(|e| e.ip == target_ip && e.if_index == if_index)
        .map(|e| e.mac.clone())
}

/// 格式化 6 字节 MAC 为小写冒号分隔，与 Linux / Windows 原样对齐。
pub fn format_mac(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut s = String::with_capacity(17);
    for (i, b) in bytes.iter().take(6).enumerate() {
        if i > 0 {
            s.push(':');
        }
        let _ = write!(s, "{:02x}", b);
    }
    s
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    // ---------- iface_type 分类 ----------

    #[test]
    fn classify_ethernet() {
        assert_eq!(classify_iface_type_pure("en0", IFT_ETHER), IfaceType::Ethernet);
    }

    // 注：Apple XNU 不使用 `IFT_IEEE80211`（见 const 区注释），Wi-Fi 的正确分类
    // 由 `wifi::is_wifi_interface` 在 sampler 里二次判定完成，不属于纯函数覆盖。

    #[test]
    fn classify_loopback() {
        assert_eq!(classify_iface_type_pure("lo0", IFT_LOOP), IfaceType::Loopback);
    }

    #[test]
    fn classify_ppp_is_vpn() {
        assert_eq!(classify_iface_type_pure("ppp0", IFT_PPP), IfaceType::Vpn);
    }

    #[test]
    fn classify_tunnel_is_vpn() {
        assert_eq!(classify_iface_type_pure("gif0", IFT_TUNNEL), IfaceType::Vpn);
    }

    #[test]
    fn classify_cellular() {
        assert_eq!(classify_iface_type_pure("pdp_ip0", IFT_CELLULAR), IfaceType::Cellular);
    }

    #[test]
    fn classify_utun_name_other_ifi_type_as_vpn() {
        // Apple utun 设备的 ifi_type 常为 other，name 兜底归 vpn
        assert_eq!(classify_iface_type_pure("utun5", 0), IfaceType::Vpn);
    }

    #[test]
    fn classify_ipsec_name_other_ifi_type_as_vpn() {
        assert_eq!(classify_iface_type_pure("ipsec0", 0), IfaceType::Vpn);
    }

    #[test]
    fn classify_other_when_unknown() {
        assert_eq!(classify_iface_type_pure("awdl0", 0), IfaceType::Other);
    }

    #[test]
    fn classify_ether_name_with_vpn_prefix_keeps_ethernet() {
        // 名字不会覆盖 ifi_type=ETHER 的 Ethernet 判断
        assert_eq!(classify_iface_type_pure("tun0", IFT_ETHER), IfaceType::Ethernet);
    }

    // ---------- 掩码 / 网络地址 ----------

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
        assert_eq!(prefix_from_mask_v6(Ipv6Addr::UNSPECIFIED), Some(0));
    }

    #[test]
    fn prefix_from_mask_v6_rejects_non_contiguous() {
        let mask: Ipv6Addr = "ffff:0:ffff::".parse().unwrap();
        assert_eq!(prefix_from_mask_v6(mask), None);
    }

    #[test]
    fn network_address_v4_masks_host_bits() {
        let ip: Ipv4Addr = "192.168.1.23".parse().unwrap();
        assert_eq!(
            network_address_v4(ip, 24),
            "192.168.1.0".parse::<Ipv4Addr>().unwrap()
        );
        assert_eq!(
            network_address_v4(ip, 16),
            "192.168.0.0".parse::<Ipv4Addr>().unwrap()
        );
    }

    #[test]
    fn network_address_v6_masks_host_bits() {
        let ip: Ipv6Addr = "2001:db8:abcd:1234::1".parse().unwrap();
        assert_eq!(
            network_address_v6(ip, 48),
            "2001:db8:abcd::".parse::<Ipv6Addr>().unwrap()
        );
    }

    #[test]
    fn ipv6_link_local_detected() {
        assert!(is_ipv6_link_local("fe80::1".parse().unwrap()));
        assert!(is_ipv6_link_local("fe80::abcd:1234".parse().unwrap()));
        assert!(!is_ipv6_link_local("2001:db8::1".parse().unwrap()));
        assert!(!is_ipv6_link_local("::1".parse().unwrap()));
        assert!(!is_ipv6_link_local("fec0::1".parse().unwrap()));
    }

    // ---------- roundup ----------

    #[test]
    fn roundup_sa_len_zero_is_four() {
        assert_eq!(roundup_sa_len(0), 4);
    }

    #[test]
    fn roundup_sa_len_common() {
        assert_eq!(roundup_sa_len(1), 4);
        assert_eq!(roundup_sa_len(4), 4);
        assert_eq!(roundup_sa_len(5), 8);
        assert_eq!(roundup_sa_len(8), 8);
        assert_eq!(roundup_sa_len(9), 12);
        assert_eq!(roundup_sa_len(16), 16);
        assert_eq!(roundup_sa_len(17), 20);
    }

    // ---------- sysctl parser ----------

    /// 构造一段合法的 sysctl 输出（含 1 条邻居）。
    fn build_one_entry(ip: [u8; 4], mac: [u8; 6], if_index: u16) -> Vec<u8> {
        let mut msg = vec![0u8; RT_MSGHDR_LEN];
        msg[2] = 5; // rtm_version
        msg[3] = 4; // rtm_type = RTM_GET
        msg[4..6].copy_from_slice(&if_index.to_ne_bytes());
        msg[12..16].copy_from_slice(&3i32.to_ne_bytes()); // rtm_addrs = RTA_DST | RTA_GATEWAY

        let sa_in_len: u8 = 16;
        let sa_in = {
            let mut s = vec![0u8; 16];
            s[0] = sa_in_len;
            s[1] = 2; // AF_INET
            s[4..8].copy_from_slice(&ip);
            s
        };
        let sa_dl_len: u8 = 20;
        let sa_dl = {
            let mut s = vec![0u8; 20];
            s[0] = sa_dl_len;
            s[1] = 18; // AF_LINK
            s[2..4].copy_from_slice(&if_index.to_ne_bytes());
            s[4] = 6; // sdl_type
            s[5] = 0; // sdl_nlen
            s[6] = 6; // sdl_alen
            s[7] = 0; // sdl_slen
            s[8..14].copy_from_slice(&mac);
            s
        };

        let total = RT_MSGHDR_LEN + roundup_sa_len(sa_in_len as usize) + roundup_sa_len(sa_dl_len as usize);
        msg[0..2].copy_from_slice(&(total as u16).to_ne_bytes());

        msg.extend_from_slice(&sa_in);
        msg.resize(RT_MSGHDR_LEN + roundup_sa_len(sa_in_len as usize), 0);
        msg.extend_from_slice(&sa_dl);
        msg.resize(total, 0);
        msg
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_single_entry() {
        let buf = build_one_entry([192, 168, 1, 1], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], 5);
        let entries = parse_sysctl_rtm_llinfo(&buf);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ip, "192.168.1.1".parse::<IpAddr>().unwrap());
        assert_eq!(entries[0].mac, "aa:bb:cc:dd:ee:ff");
        assert_eq!(entries[0].if_index, 5);
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_multiple_entries() {
        let mut buf = build_one_entry([192, 168, 1, 1], [0xaa; 6], 5);
        buf.extend(build_one_entry([10, 0, 0, 1], [0xbb; 6], 6));
        let entries = parse_sysctl_rtm_llinfo(&buf);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].if_index, 5);
        assert_eq!(entries[1].if_index, 6);
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_zero_mac_filtered() {
        let buf = build_one_entry([192, 168, 1, 1], [0u8; 6], 5);
        assert!(parse_sysctl_rtm_llinfo(&buf).is_empty());
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_truncated_buf_tolerated() {
        let mut buf = build_one_entry([192, 168, 1, 1], [0xaa; 6], 5);
        buf.truncate(buf.len() - 4);
        let _ = parse_sysctl_rtm_llinfo(&buf);
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_empty() {
        assert!(parse_sysctl_rtm_llinfo(&[]).is_empty());
    }

    fn build_one_entry_v6(ip: [u8; 16], mac: [u8; 6], if_index: u16) -> Vec<u8> {
        let mut msg = vec![0u8; RT_MSGHDR_LEN];
        msg[2] = 5;
        msg[3] = 4;
        msg[4..6].copy_from_slice(&if_index.to_ne_bytes());
        msg[12..16].copy_from_slice(&3i32.to_ne_bytes());

        let sa_in6_len: u8 = 28;
        let sa_in6 = {
            let mut s = vec![0u8; 28];
            s[0] = sa_in6_len;
            s[1] = 30; // AF_INET6
            s[8..24].copy_from_slice(&ip);
            s
        };
        let sa_dl_len: u8 = 20;
        let sa_dl = {
            let mut s = vec![0u8; 20];
            s[0] = sa_dl_len;
            s[1] = 18;
            s[2..4].copy_from_slice(&if_index.to_ne_bytes());
            s[4] = 6;
            s[6] = 6;
            s[8..14].copy_from_slice(&mac);
            s
        };
        let total = RT_MSGHDR_LEN + roundup_sa_len(sa_in6_len as usize) + roundup_sa_len(sa_dl_len as usize);
        msg[0..2].copy_from_slice(&(total as u16).to_ne_bytes());
        msg.extend_from_slice(&sa_in6);
        msg.resize(RT_MSGHDR_LEN + roundup_sa_len(sa_in6_len as usize), 0);
        msg.extend_from_slice(&sa_dl);
        msg.resize(total, 0);
        msg
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_ipv6_entry() {
        let v6 = [
            0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0xaa, 0xbb, 0xcc, 0xff, 0xfe, 0xdd, 0xee, 0xff,
        ];
        let buf = build_one_entry_v6(v6, [0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 7);
        let entries = parse_sysctl_rtm_llinfo(&buf);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ip, "fe80::aabb:ccff:fedd:eeff".parse::<IpAddr>().unwrap());
        assert_eq!(entries[0].mac, "11:22:33:44:55:66");
        assert_eq!(entries[0].if_index, 7);
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_strips_kame_embedded_scope() {
        // fe80:<ifindex>:: 形态的 NDP entry，清零后应与 SCDynamicStore Router 形态一致
        let mut v6 = [0xfe, 0x80, 0x00, 0x07, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01];
        let buf = build_one_entry_v6(v6, [0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 7);
        let entries = parse_sysctl_rtm_llinfo(&buf);
        assert_eq!(entries.len(), 1);
        v6[2] = 0;
        v6[3] = 0;
        assert_eq!(entries[0].ip, IpAddr::V6(Ipv6Addr::from(v6)));
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_strips_kame_scope_for_flagged_multicast() {
        // ff12 = link-local multicast with flags=1；同样做 embedded scope
        let mut v6 = [0xff, 0x12, 0x00, 0x09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01];
        let buf = build_one_entry_v6(v6, [0xcc; 6], 9);
        let entries = parse_sysctl_rtm_llinfo(&buf);
        assert_eq!(entries.len(), 1);
        v6[2] = 0;
        v6[3] = 0;
        assert_eq!(entries[0].ip, IpAddr::V6(Ipv6Addr::from(v6)));
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_preserves_unicast_based_multicast() {
        // ff32::/16 = unicast-based multicast（RFC 3306，flags=0x30），bytes[2..4] 不清零
        let v6 = [
            0xff, 0x32, 0x00, 0x40, 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0x01,
        ];
        let buf = build_one_entry_v6(v6, [0xdd; 6], 4);
        let entries = parse_sysctl_rtm_llinfo(&buf);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ip, IpAddr::V6(Ipv6Addr::from(v6)));
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_preserves_non_link_scope_address() {
        let v6 = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01];
        let buf = build_one_entry_v6(v6, [0xaa; 6], 3);
        let entries = parse_sysctl_rtm_llinfo(&buf);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ip, IpAddr::V6(Ipv6Addr::from(v6)));
    }

    #[test]
    fn parse_sysctl_rtm_llinfo_too_small_msglen_tolerated() {
        // 构造一段 RT_MSGHDR_LEN 字节但 rtm_msglen=1 的异常输入
        let mut buf = vec![0u8; RT_MSGHDR_LEN];
        buf[RTM_MSGLEN_OFF..RTM_MSGLEN_OFF + 2].copy_from_slice(&1u16.to_ne_bytes());
        assert!(parse_sysctl_rtm_llinfo(&buf).is_empty());
    }

    // ---------- find_gateway_mac ----------

    #[test]
    fn find_gateway_mac_filters_by_iface() {
        let target: IpAddr = "192.168.1.1".parse().unwrap();
        let entries = vec![
            ArpEntry {
                ip: target,
                mac: "aa:aa:aa:aa:aa:aa".into(),
                if_index: 5,
            },
            ArpEntry {
                ip: target,
                mac: "bb:bb:bb:bb:bb:bb".into(),
                if_index: 6,
            },
        ];
        assert_eq!(find_gateway_mac(&entries, target, 5), Some("aa:aa:aa:aa:aa:aa".into()));
        assert_eq!(find_gateway_mac(&entries, target, 6), Some("bb:bb:bb:bb:bb:bb".into()));
    }

    #[test]
    fn find_gateway_mac_no_match() {
        let entries = vec![ArpEntry {
            ip: "10.0.0.1".parse().unwrap(),
            mac: "aa:aa:aa:aa:aa:aa".into(),
            if_index: 5,
        }];
        assert!(find_gateway_mac(&entries, "192.168.1.1".parse().unwrap(), 5).is_none());
    }

    #[test]
    fn format_mac_lowercase_colons() {
        assert_eq!(
            format_mac(&[0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
            "aa:bb:cc:dd:ee:ff"
        );
        assert_eq!(format_mac(&[0, 0, 0, 0, 0, 0]), "00:00:00:00:00:00");
    }
}
