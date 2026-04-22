//! Windows 采样的纯函数辅助模块：iface_type 分类、掩码转换、subnets 组装、
//! UTF-16 PWSTR → String 等。
//!
//! I/O 放在 sampler.rs 的薄壳函数里（只做 FFI 调用 + 解析），解析逻辑与分类
//! 判断全部抽为纯函数方便单测。
//!
//! 采样策略：enumerate 全量 adapter 集合后由
//! [`super::super::context::build_context`] 统一做过滤 / 截断，平台 sampler 不负责
//! 挑 primary；因此这里没有 `is_physical_primary` 或 `select_best_default` 辅助。

use std::net::{Ipv4Addr, Ipv6Addr};

use crate::module::netmon::context::IfaceType;

/// `MIB_IF_ROW2.Type` → [`IfaceType`] 语义映射。
///
/// Type 值来自 IANAifType-MIB（Windows IP Helper 原样透传）。常见值：
///   6  IF_TYPE_ETHERNET_CSMACD
///  23  IF_TYPE_PPP
///  24  IF_TYPE_SOFTWARE_LOOPBACK
///  71  IF_TYPE_IEEE80211
/// 131  IF_TYPE_TUNNEL
/// 243  IF_TYPE_WWANPP
/// 244  IF_TYPE_WWANPP2
///
/// 判定顺序（先 Type 后 alias 兜底）：
/// 1. Type 映射得到基础类型
/// 2. 仅当基础类型是 `Ethernet` 或 `Other` 时，才检查 alias 是否含 VPN 供应商
///    特征（WireGuard-NT 注册为 other / TAP-Windows6 注册为 ethernet 等），命中
///    则覆盖为 `Vpn`
///
/// PPPoE 家宽拨号在 Windows 上通常为 Type=23 PPP，会被直接归 Vpn——与 Linux
/// `name.starts_with("ppp") → vpn` 的取舍对齐。
pub fn classify_iface_type_pure(alias: &str, if_type: u32) -> IfaceType {
    let base = match if_type {
        6 => IfaceType::Ethernet,
        23 => IfaceType::Vpn, // PPP（含 PPPoE 家宽）
        24 => IfaceType::Loopback,
        71 => IfaceType::Wifi,
        131 => IfaceType::Vpn, // Tunnel
        243 | 244 => IfaceType::Wwan,
        _ => IfaceType::Other,
    };

    // 名字兜底：仅覆盖 Ethernet / Other，防止把物理网卡误判
    if matches!(base, IfaceType::Ethernet | IfaceType::Other) && is_vpn_alias(alias) {
        return IfaceType::Vpn;
    }
    base
}

/// 判断 alias 是否带有典型 VPN 适配器供应商标识。
///
/// 使用具体 token（完整单词 / 独特前缀），避免 `contains("wg")` / `contains("tun")`
/// 这类过短子串误伤物理网卡。
fn is_vpn_alias(alias: &str) -> bool {
    let lower = alias.to_ascii_lowercase();
    const TOKENS: &[&str] = &[
        "wireguard",
        "wintun",
        "tap-windows",
        "openvpn",
        "zerotier",
        "tailscale",
        "cloudflare warp",
        "cisco anyconnect",
        "fortinet",
        "pulse secure",
    ];
    TOKENS.iter().any(|t| lower.contains(t))
}

/// 把 NUL-terminated UTF-16 缓冲转成 String。
///
/// 遇到第一个 `\0` 即截断；没有 `\0` 时用整段。非法 code unit 用 U+FFFD 替换。
pub fn pwstr_to_string(buf: &[u16]) -> String {
    let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..n])
}

/// 从 `*const u16` PWSTR 读取 NUL 终结的 UTF-16 并转 String。
///
/// 扫描上限 [`MAX_WIN32_PWSTR_LEN`] u16 防御异常指针。Windows 的 `FriendlyName`
/// (`IF_MAX_STRING_SIZE = 256`) / `DnsSuffix`
/// (`MAX_DNS_SUFFIX_STRING_LENGTH = 256`) 文档约束都远小于此上限，同时
/// defense-in-depth——上限从 65535 降到 1024 把 "意外越界读" 的最坏情况从
/// ~130KB 收到 ~2KB。null 返回空串。
///
/// # Safety
/// `ptr` 必须满足以下任一：
/// - 为 null
/// - 指向有效且以 NUL 终结的 UTF-16 缓冲（至少 [`MAX_WIN32_PWSTR_LEN`] u16 内存可读）
pub unsafe fn pwstr_ptr_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: 调用者保证 ptr 指向 NUL 终结的 UTF-16 缓冲
    unsafe {
        let mut len = 0usize;
        while len < MAX_WIN32_PWSTR_LEN && *ptr.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        pwstr_to_string(slice)
    }
}

/// PWSTR 扫描上限。Windows IP Helper 的 `FriendlyName` / `DnsSuffix` 文档约束
/// 都在 256 u16 以内；取 1024 留足 padding 且把异常情况下的越界读控制到 ~2KB。
const MAX_WIN32_PWSTR_LEN: usize = 1024;

/// 申请一个满足 `IP_ADAPTER_ADDRESSES_LH` 8-byte 对齐的可写字节缓冲，用于传给
/// `GetAdaptersAddresses`。
///
/// `Vec<u8>` 只保证 1 字节对齐，直接把 `u8*` cast 为
/// `*mut IP_ADAPTER_ADDRESSES_LH` 再 deref 在严格对齐规则下是 UB；用
/// `Vec<u64>` 作底层存储可以让起始地址天然 8 字节对齐，`align_of::<u64>() >=
/// align_of::<IP_ADAPTER_ADDRESSES_LH>()`。调用方通过 [`GaaBuffer::as_mut_u8_ptr`] /
/// [`GaaBuffer::as_ptr`] / [`GaaBuffer::byte_capacity`] 与 Win32 API 交互。
pub struct GaaBuffer {
    storage: Vec<u64>,
}

impl GaaBuffer {
    /// 按需要的字节数申请缓冲（向上取整到 8）。`bytes` 必须不超过 `u32::MAX`
    /// （Win32 `ULONG` 上界），超出会在 debug 构建 panic。
    pub fn new(bytes: usize) -> Self {
        debug_assert!(
            bytes <= u32::MAX as usize,
            "GaaBuffer::new bytes > u32::MAX not supported by Win32 ULONG"
        );
        let words = bytes.div_ceil(8).max(1);
        Self {
            storage: vec![0u64; words],
        }
    }

    /// 以字节数为单位的 capacity；等价于传入的 `bytes` 向上取整到 8。
    pub fn byte_capacity(&self) -> u32 {
        u32::try_from(self.storage.len().saturating_mul(8)).unwrap_or(u32::MAX)
    }

    /// 给 Win32 API 的 `*mut u8`（底层 u64 storage 满足 8 字节对齐）。
    pub const fn as_mut_u8_ptr(&mut self) -> *mut u8 {
        self.storage.as_mut_ptr().cast::<u8>()
    }

    /// 用于 Win32 成功返回后的只读遍历；保证非 null，对齐上界为
    /// `align_of::<u64>() == 8`。
    ///
    /// 对齐不足的 T 会在 **monomorphization 期** 通过 `const {}` assert 编译
    /// 失败——不需要等到 runtime 触发 debug_assert，也不需要 release 才暴露。
    /// 这让 `GaaBuffer` 唯一的对齐契约从注释 / 文档提升为类型系统强制。
    pub const fn as_ptr<T>(&self) -> *const T {
        const {
            assert!(
                std::mem::align_of::<T>() <= std::mem::align_of::<u64>(),
                "GaaBuffer only guarantees 8-byte alignment; T requires higher"
            );
        }
        self.storage.as_ptr().cast::<T>()
    }

    /// 重新按新字节数申请（用于 ERROR_BUFFER_OVERFLOW 扩容重试）。
    pub fn resize(&mut self, bytes: usize) {
        debug_assert!(
            bytes <= u32::MAX as usize,
            "GaaBuffer::resize bytes > u32::MAX not supported by Win32 ULONG"
        );
        let words = bytes.div_ceil(8).max(1);
        self.storage = vec![0u64; words];
    }
}

/// IPv4 地址按前缀 mask 到网络地址。
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

/// IPv6 地址按前缀 mask 到网络地址。
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

/// 格式化 MAC 地址（6 字节）为小写冒号分隔字符串，与 Linux `/proc/net/arp` 原样格式对齐。
pub fn format_mac(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(17);
    for (i, b) in bytes.iter().take(6).enumerate() {
        if i > 0 {
            s.push(':');
        }
        use std::fmt::Write as _;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn classify_ethernet_common() {
        assert_eq!(classify_iface_type_pure("Ethernet", 6), IfaceType::Ethernet);
        assert_eq!(classify_iface_type_pure("以太网", 6), IfaceType::Ethernet);
        assert_eq!(classify_iface_type_pure("以太网 2", 6), IfaceType::Ethernet);
    }

    #[test]
    fn classify_wifi_via_type() {
        assert_eq!(classify_iface_type_pure("Wi-Fi", 71), IfaceType::Wifi);
    }

    #[test]
    fn classify_loopback() {
        assert_eq!(
            classify_iface_type_pure("Loopback Pseudo-Interface 1", 24),
            IfaceType::Loopback
        );
    }

    #[test]
    fn classify_tunnel_is_vpn() {
        assert_eq!(
            classify_iface_type_pure("Teredo Tunneling Pseudo-Interface", 131),
            IfaceType::Vpn
        );
    }

    #[test]
    fn classify_ppp_is_vpn() {
        // PPPoE 家宽在 Windows 上 Type=23；归 vpn 是与 Linux 对齐的折衷
        assert_eq!(classify_iface_type_pure("宽带连接", 23), IfaceType::Vpn);
    }

    #[test]
    fn classify_wwan() {
        assert_eq!(classify_iface_type_pure("Cellular", 243), IfaceType::Wwan);
        assert_eq!(classify_iface_type_pure("Mobile", 244), IfaceType::Wwan);
    }

    #[test]
    fn classify_wireguard_alias_over_ethernet_type() {
        // WireGuard-NT 有时注册为 Type=6 ethernet，需要 alias 兜底覆盖为 vpn
        assert_eq!(classify_iface_type_pure("WireGuard Tunnel", 6), IfaceType::Vpn);
        assert_eq!(classify_iface_type_pure("Wintun Adapter", 6), IfaceType::Vpn);
    }

    #[test]
    fn classify_tap_windows_over_ethernet() {
        // OpenVPN TAP-Windows6 注册为 Type=6
        assert_eq!(classify_iface_type_pure("TAP-Windows Adapter V9", 6), IfaceType::Vpn);
        assert_eq!(
            classify_iface_type_pure("OpenVPN Data Channel Offload", 6),
            IfaceType::Vpn
        );
    }

    #[test]
    fn classify_wsl_vethernet_not_vpn() {
        // WSL Hyper-V 虚拟交换机注册为 Type=6 ethernet，alias 含 "vEthernet"；
        // 不应被误判为 vpn（由 build_context 的虚拟桥正则统一过滤）
        assert_eq!(
            classify_iface_type_pure("vEthernet (WSL)", 6),
            IfaceType::Ethernet
        );
        assert_eq!(
            classify_iface_type_pure("vEthernet (Default Switch)", 6),
            IfaceType::Ethernet
        );
    }

    #[test]
    fn classify_ethernet_alias_not_hit_by_tap_substr() {
        // "Ethernet adapter" 不应被匹配 "tap"（单测防御 contains("tap") 过宽的回归）
        assert_eq!(
            classify_iface_type_pure("Ethernet adapter 3", 6),
            IfaceType::Ethernet
        );
    }

    #[test]
    fn classify_other_when_unknown() {
        assert_eq!(classify_iface_type_pure("Virtual Device", 999), IfaceType::Other);
    }

    #[test]
    fn pwstr_to_string_ascii_null_terminated() {
        let mut buf = [0u16; 16];
        for (i, c) in "Wi-Fi".encode_utf16().enumerate() {
            buf[i] = c;
        }
        assert_eq!(pwstr_to_string(&buf), "Wi-Fi");
    }

    #[test]
    fn pwstr_to_string_chinese() {
        let mut buf = [0u16; 16];
        for (i, c) in "以太网 2".encode_utf16().enumerate() {
            buf[i] = c;
        }
        assert_eq!(pwstr_to_string(&buf), "以太网 2");
    }

    #[test]
    fn pwstr_to_string_no_null() {
        let buf: Vec<u16> = "Full".encode_utf16().collect();
        assert_eq!(pwstr_to_string(&buf), "Full");
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
    fn format_mac_lowercase_colons() {
        assert_eq!(format_mac(&[0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]), "aa:bb:cc:dd:ee:ff");
        assert_eq!(format_mac(&[0, 0, 0, 0, 0, 0]), "00:00:00:00:00:00");
    }
}
