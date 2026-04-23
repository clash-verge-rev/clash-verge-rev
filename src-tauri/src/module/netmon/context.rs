//! Raw sampler 结果 → 归一化 [`NetworkContext`] 的翻译层。
//!
//! 执行顺序与 mihomo 侧 `component/networkpolicy` 的 normalize 在每条具体规则上
//! 字节级对齐——host 与 kernel 双端的 byte-for-byte normalize 是 [`fingerprint`]
//! 能跨端对拍的前提（`fingerprint` 模块注释已经声明："调用方保证 ctx.interfaces
//! 已按 name 升序 + 每张 iface 的 subnets 已 sort+dedup"；该保证由本模块的
//! [`build_context`] 兑现）。
//!
//! # 流程（7 步）
//!
//! 1. **tun_filter**：按 [`SelfTunSnapshot::Known`] 过滤 mihomo 自身的 TUN iface
//! 2. **virtual_bridge_filter**：按正则 `^(docker|br-|veth|vmnet|vEthernet|virbr|vnic)`
//!    过滤虚拟桥，除非 `enable_virtual_iface_reporting = true`
//! 3. **per-iface canonicalize**（详见 [`canonicalize_iface`]）：
//!    - `iface_type` 小写化
//!    - `bssid` / `gateway_mac` 小写 + `:` 分隔规范化；非法值丢字段
//!    - `gateway_ip` parse → 去 IPv6 zone → canonical string
//!    - `gateway_mac` / `gateway_ip` 配对约束：任一为空则两者都清
//!    - `subnets`：drop 空串 + network-address(mask) + sort + dedup
//!    - `ssid`：UTF-8 lossy 并强制 ≤ 32 字节（IEEE 802.11 上限）
//!    - `name`：空或 > 255 字节 → 丢弃该 iface
//! 4. **同名 iface 降级为 [`None`]**（Sample::Unknown，mihomo 返回
//!    `duplicate_iface_name`，host 必须前置检测让这个 bug 显性化）
//! 5. **按 name 升序 sort interfaces**
//! 6. **truncate_if_over_32**（确定性优先级：physical > vpn > other > loopback；
//!    physical 族内 `has_default_route` 优先；vpn 族**不**按 default route 降级，
//!    因为 wg-quick 风格的 wg0 在 Linux policy routing 下 gateway_ip 持续为空，
//!    按 default-route 会错误降级最重要的 VPN iface）
//! 7. **dns_suffix normalize**：drop 含逗号/空白/控制字符的条目 → 小写 →
//!    sort → dedup
//!
//! 出口处显式把 `NetworkContext.version` 置 `1`（plugin `NetworkContext::version: u32`
//! 默认 0，对 mihomo 来说是 `invalid_version`）。

use std::collections::HashSet;

use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use regex::Regex;
use tauri_plugin_mihomo::models::{InterfaceContext, NetworkContext};

use super::self_tun_filter::SelfTunSnapshot;

/// kernel 硬上限；sampler 过滤后若仍然超出，[`truncate_if_over_32`] 按优先级保留前 32 张。
const MAX_INTERFACES: usize = 32;

/// IEEE 802.11 SSID 上限 32 字节（`ssid` field 是 octet string）。
const SSID_MAX_BYTES: usize = 32;

/// iface `name` 上限 255 字节（mihomo `context.go` 同步约束）。
const NAME_MAX_BYTES: usize = 255;

/// 虚拟桥默认过滤正则（`enable_virtual_iface_reporting = false` 时生效）。
/// 精确前缀匹配（`^`）避免把 "main-docker0" 这类用户命名误过滤。
/// overlay VPN (tailscale / zerotier / warp) 不在此列，它们是用户真实会 match 的
/// VPN iface，保留上报。
///
/// 覆盖常见虚拟化 / 桥接设备：Linux docker / bridge `br-*` / veth / libvirt `virbr`、
/// VMware Workstation `vmnet` / Fusion / Parallels `vnic`、Hyper-V `vEthernet`。
// 编译期常量 pattern，`Regex::new` 在此处不可能失败；`expect` 的 panic message
// 仅作为"永不触发"的防御性描述，不是运行时错误处理。用 `#[expect]` 在出现运行时
// 错误路径（意味 pattern 被人误改）时由 clippy 再次报警。
#[expect(clippy::expect_used, reason = "compile-time constant regex")]
static VIRTUAL_BRIDGE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(docker|br-|veth|vmnet|vEthernet|virbr|vnic)")
        .expect("virtual bridge regex compiles")
});

/// iface 类型枚举。与 wire 上的 `iface_type` 字符串一一对应。
///
/// 各平台 sampler 通过 `classify_iface_type` / `classify_iface_type_pure` 构造
/// 这些 variant，与 mihomo 内核 matcher 识别的 `iface_type` 值保持一致。部分
/// variant 只在特定 target 下被构造（例如 `Cellular` 仅 macOS），`#[allow(dead_code)]`
/// 用于在其它 target 下压住 dead_code lint。
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IfaceType {
    Wifi,
    Ethernet,
    Cellular,
    Wwan,
    Vpn,
    Loopback,
    Other,
}

impl IfaceType {
    /// wire 上对应的小写字符串。
    pub const fn as_wire_str(self) -> &'static str {
        match self {
            Self::Wifi => "wifi",
            Self::Ethernet => "ethernet",
            Self::Cellular => "cellular",
            Self::Wwan => "wwan",
            Self::Vpn => "vpn",
            Self::Loopback => "loopback",
            Self::Other => "other",
        }
    }

    /// 截断优先级：`0` = 最高（最先保留），`3` = 最低（最先砍）。
    /// 次序：physical > vpn > other > loopback。
    pub const fn truncation_priority(self) -> u8 {
        match self {
            Self::Wifi | Self::Ethernet | Self::Cellular | Self::Wwan => 0, // physical
            Self::Vpn => 1,
            Self::Other => 2,
            Self::Loopback => 3,
        }
    }

    /// 是否为物理接口（用于截断策略内的次级排序）。
    pub const fn is_physical(self) -> bool {
        matches!(self, Self::Wifi | Self::Ethernet | Self::Cellular | Self::Wwan)
    }
}

/// 平台 sampler 输出的 raw 结果：未归一化的 iface 集合 + DNS search list。
#[derive(Debug, Clone, Default)]
pub struct RawIfaceInventory {
    pub interfaces: Vec<RawIface>,
    /// DNS search list（任意顺序，未去重），由 [`build_context`] 归一化。
    pub dns_suffix: Vec<String>,
}

/// Raw per-iface 描述（未归一化）。由三平台 sampler 产出；字段对应 plugin 的
/// [`InterfaceContext`] 但类型更宽松。
#[derive(Debug, Clone)]
pub struct RawIface {
    /// iface 名（non-empty）。空 / 超长 → [`build_context`] 丢弃该 iface。
    pub name: String,
    pub iface_type: IfaceType,
    pub ssid: Option<String>,
    /// 原始 BSSID（任意大小写，可含 `-` 分隔）；[`build_context`] 归一化为小写冒号分隔
    pub bssid: Option<String>,
    /// 原始 gateway IP（可含 IPv6 zone `%eth0` 后缀）；[`build_context`] 剥 zone + canonical
    pub gateway_ip: Option<String>,
    /// 原始 gateway MAC；归一化同 `bssid`。
    /// 规则：若与 `gateway_ip` 未配对（一空一不空），[`build_context`] 会把两者都清。
    pub gateway_mac: Option<String>,
    /// 接口本地地址前缀（不含路由表 next-hop CIDR）。字符串格式 `A.B.C.D/N`。
    pub subnets: Vec<String>,
    /// tri-state metered（null / true / false）。
    pub metered: Option<bool>,
    /// 是否承担 default route（供截断策略 tie-break）。不上 wire。
    pub has_default_route: bool,
}

/// 把 raw sampler 结果归一化为 plugin 的 [`NetworkContext`]。
///
/// **返回 [`None`]** 当 step 4 检测到同名 iface（sampler bug）—— service loop 将
/// 降级为 `Sample::Unknown` 跳过本次 PUT 而非"静默合并"（mihomo 侧会返回
/// `duplicate_iface_name`，host 前置拦截让 bug 显性化）。
///
/// **返回 [`Some`]** 表示归一化成功，调用方可直接传给 [`fingerprint::compute`] 或
/// plugin `put_network_context`。返回值的 `interfaces` 已按 name 升序、每张
/// iface 的 `subnets` 已 sort+dedup、`dns_suffix` 已 lower+dedup+sort、
/// `version` 已置 `1`。
pub fn build_context(
    raw: RawIfaceInventory,
    self_tun: SelfTunSnapshot,
    enable_virtual: bool,
) -> Option<NetworkContext> {
    // step 0: 最早阶段把 name trim 成 owned 形式，后续所有 name-based 决策（self-TUN
    // 过滤、虚拟桥过滤、同名 dedup、sort、truncate、canonicalize）全部基于这个
    // canonical name。否则 step 5 的 `sort_by(a.name.cmp(&b.name))` 用 untrimmed
    // 排，step 7 的 canonicalize 又 trim 一次——两端就会违反 `fingerprint::compute`
    // 声明的"调用方保证 ctx.interfaces 按 name 升序"契约，双端 hash 直接发散。
    let tun_name: Option<&str> = match &self_tun {
        SelfTunSnapshot::Known(n) => Some(n.as_str()),
        SelfTunSnapshot::NoFilter => None,
    };
    let mut filtered: Vec<RawIface> = raw
        .interfaces
        .into_iter()
        .filter_map(|mut i| {
            let trimmed = i.name.trim();
            if trimmed.is_empty() || trimmed.len() > NAME_MAX_BYTES {
                return None;
            }
            if i.name != trimmed {
                i.name = trimmed.to_string();
            }
            Some(i)
        })
        // step 1: mihomo 自身 TUN 过滤（基于已 trim 的 canonical name）
        .filter(|i| tun_name.is_none_or(|n| i.name != n))
        // step 2: 虚拟桥过滤（同上）
        .filter(|i| enable_virtual || !VIRTUAL_BRIDGE_RE.is_match(&i.name))
        .collect();

    // step 4（前置到 filter 之后）：同名 iface 降级为 None（sampler bug）
    let mut seen: HashSet<String> = HashSet::with_capacity(filtered.len());
    for i in &filtered {
        if !seen.insert(i.name.clone()) {
            // sampler bug 显性化：不静默合并，warn log 让它在生产中可见；
            // 返回 None 让 service.rs 降级为 Sample::Unknown
            logging!(
                warn,
                Type::Network,
                "netmon: duplicate iface name '{}' in sampler output, skipping this sample (sampler bug)",
                i.name
            );
            return None;
        }
    }

    // step 5: 按 name 升序
    filtered.sort_by(|a, b| a.name.cmp(&b.name));

    // step 6: 截断到 32（RawIface 阶段做，`IfaceType` / `has_default_route` 还在）
    let truncated = truncate_if_over_32(filtered);

    // step 3: per-iface canonicalize —— 放在 truncate 之后以避免为被截断的 iface
    // 浪费计算
    let interfaces: Vec<InterfaceContext> = truncated.into_iter().filter_map(canonicalize_iface).collect();

    // step 7: dns_suffix normalize
    let dns_suffix = normalize_dns_suffix(raw.dns_suffix);

    Some(NetworkContext {
        version: 1,
        interfaces,
        dns_suffix: if dns_suffix.is_empty() { None } else { Some(dns_suffix) },
        ttl: None,
    })
}

/// 对单张 raw iface 做 step 3 的完整 canonicalize。
///
/// 调用方（[`build_context`]）已在 step 0 把 `raw.name` 保证为 trim 后非空且
/// ≤ [`NAME_MAX_BYTES`]，因此这里直接使用，不再重复守护。返回 `Option` 是为
/// 未来可能引入"字段级 canonicalize 失败也 drop 整张 iface"的场景预留——目前
/// 当前实现只会走 `Some(...)` 出口。
#[expect(
    clippy::unnecessary_wraps,
    reason = "Option<_> return reserved for future field-level canonicalize drop paths"
)]
fn canonicalize_iface(raw: RawIface) -> Option<InterfaceContext> {
    let name = raw.name;

    // iface_type：小写字符串（enum → wire 映射）
    let iface_type = Some(raw.iface_type.as_wire_str().to_string());

    // ssid：UTF-8 lossy + 截断 ≤ 32 字节（IEEE 802.11）；空串 → None，语义上
    // `Option::None = 未采到` 比 `Some("") = 采到了空字符串` 更准确，避免前端
    // 诊断面板误读
    let ssid = raw.ssid.and_then(|s| {
        let t = truncate_utf8_bytes(&s, SSID_MAX_BYTES);
        if t.is_empty() { None } else { Some(t) }
    });

    // bssid / gateway_mac：小写 + `:` 分隔；非法值 → drop
    let bssid = raw.bssid.and_then(|s| canonicalize_mac(&s));
    let mut gateway_mac = raw.gateway_mac.and_then(|s| canonicalize_mac(&s));

    // gateway_ip：parse → 去 v6 zone → canonical string
    let gateway_ip = raw.gateway_ip.and_then(|s| canonicalize_ip(&s));

    // gateway_mac / gateway_ip 配对：mihomo 会对 "gateway_mac 有值而 gateway_ip 为空"
    // 判 `invalid_gateway_combo`。host 前置：gateway_ip 为 None 时清 gateway_mac。
    // 反向是允许的（per-iface sampler ARP 查 miss 时 gateway_ip 有值 / gateway_mac 空）。
    if gateway_ip.is_none() {
        gateway_mac = None;
    }

    // subnets：drop empty → network-address(mask) → sort → dedup
    let mut subnets: Vec<String> = raw
        .subnets
        .into_iter()
        .filter(|s| !s.is_empty())
        .filter_map(|s| canonicalize_cidr(&s))
        .collect();
    subnets.sort_unstable();
    subnets.dedup();

    Some(InterfaceContext {
        name,
        iface_type,
        ssid,
        bssid,
        gateway_ip,
        gateway_mac,
        subnets: if subnets.is_empty() { None } else { Some(subnets) },
        metered: raw.metered,
    })
}

/// step 6：若超过 [`MAX_INTERFACES`]，按 [`IfaceType::truncation_priority`] 次序保留
/// 前 32 张。同优先级内：physical 族按 "has_default_route 优先"；vpn 族**不**按
/// default route 降级（wg-quick 风格的 WireGuard 在 Linux policy routing 下 wg0 的
/// gateway_ip 持续为空，按
/// default-route 会错误降级 wg0），直接按 name 字典序；其他族按 name。
/// 最终按 name 升序返回。
fn truncate_if_over_32(mut interfaces: Vec<RawIface>) -> Vec<RawIface> {
    if interfaces.len() <= MAX_INTERFACES {
        return interfaces;
    }
    interfaces.sort_by(|a, b| {
        let pa = a.iface_type.truncation_priority();
        let pb = b.iface_type.truncation_priority();
        pa.cmp(&pb).then_with(|| {
            // physical 族优先保留 has_default_route = true 的（true < false，反排）
            if a.iface_type.is_physical() && b.iface_type.is_physical() {
                b.has_default_route
                    .cmp(&a.has_default_route)
                    .then_with(|| a.name.cmp(&b.name))
            } else {
                a.name.cmp(&b.name)
            }
        })
    });
    interfaces.truncate(MAX_INTERFACES);
    interfaces.sort_by(|a, b| a.name.cmp(&b.name));
    interfaces
}

/// step 7: dns_suffix normalize。drop 含逗号/空白/控制字符的条目（mihomo 会拒绝）
/// + Unicode-aware 小写 + drop 空 + sort + dedup。
///
/// **注意**：forbidden char 检查**不能** trim 后做——`" corp "` 的空白本来就应该
/// 让条目被 drop；先 trim 会把非法输入洗成合法值，与 mihomo 侧的 normalize 语义
/// 不一致。
fn normalize_dns_suffix(raw: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = raw
        .into_iter()
        .filter_map(|s| {
            if s.is_empty() || s.chars().any(dns_forbidden_char) {
                return None;
            }
            // 用 Unicode-aware `to_lowercase` 对齐 Go `strings.ToLower`
            // （`to_ascii_lowercase` 只覆盖 ASCII A-Z，会让 IDN 未 punycode 化的
            // 域名在 host / kernel 两端产生不同的 fingerprint 输入）。
            Some(s.to_lowercase())
        })
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

fn dns_forbidden_char(c: char) -> bool {
    // 必须用 `is_ascii_whitespace` 而非 `is_whitespace`：后者按 Unicode 定义覆盖
    // NBSP / 零宽 whitespace / U+2028 等大范围字符，而 mihomo 侧（Go `strings.
    // ContainsAny`）目前只按 ASCII `\t\n\v\f\r ` 过滤 dns_suffix。双端语义不一致
    // 会让 host 侧过滤掉的条目 mihomo 认为合法 → fingerprint 反复漂移，每次
    // sample 都触发一次 PUT。`is_control` 覆盖 `\0`-`\x1f` / `\x7f`，与 Go 侧
    // `unicode.IsControl` 同义，双端一致。
    c == ',' || c.is_ascii_whitespace() || c.is_control()
}

/// UTF-8 safe 截断：找不超过 `max_bytes` 的最大字符边界。
fn truncate_utf8_bytes(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// MAC 规范化为 `aa:bb:cc:dd:ee:ff` 格式。支持三种输入形式（与 mihomo 侧
/// `normalizeMAC` 对齐）：
/// - `:` 分隔：`aa:bb:cc:dd:ee:ff`
/// - `-` 分隔：`aa-bb-cc-dd-ee-ff`
/// - 无分隔符 12 hex chars：`aabbccddeeff`
///
/// **拒绝** 混合分隔符（`aa:bb-cc:dd...`）——mihomo 会判 invalid，host 不能"偷偷修好"
/// 让真正的 sampler bug 被隐藏。非法形式返回 `None`（调用方按"字段缺失"处理）。
fn canonicalize_mac(s: &str) -> Option<String> {
    let has_colon = s.contains(':');
    let has_dash = s.contains('-');
    if has_colon && has_dash {
        return None; // mixed separators → invalid
    }
    if !has_colon && !has_dash {
        // 无分隔符形式：必须正好 12 hex chars
        if s.len() != 12 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let lower = s.to_ascii_lowercase();
        let mut out = String::with_capacity(17);
        for i in 0..6 {
            if i > 0 {
                out.push(':');
            }
            out.push_str(&lower[i * 2..i * 2 + 2]);
        }
        return Some(out);
    }
    let sep = if has_colon { ':' } else { '-' };
    let parts: Vec<&str> = s.split(sep).collect();
    if parts.len() != 6 {
        return None;
    }
    let mut out = String::with_capacity(17);
    for (i, p) in parts.iter().enumerate() {
        if p.len() != 2 || !p.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        if i > 0 {
            out.push(':');
        }
        out.push_str(&p.to_ascii_lowercase());
    }
    Some(out)
}

/// IP 规范化：剥 IPv6 zone 后缀（`%eth0`）→ parse → to_string。
/// 非法 IP 返回 `None`。
///
/// **空 zone 拒绝**：形如 `"fe80::1%"`（`%` 后为空串）是语法上可疑的输入——
/// 调用者要么没有 zone，要么应该写明具体的 `%eth0`。`split_once('%')` 会
/// 把它剥成 `"fe80::1"` 并静默解析成功，等于默默接受了 sampler bug。显式返
/// `None` 把"双端 fingerprint 收敛不了"之类的故障暴露出来，而不是偷偷修好。
fn canonicalize_ip(s: &str) -> Option<String> {
    let (no_zone, zone) = s.split_once('%').unwrap_or((s, ""));
    if s.contains('%') && zone.is_empty() {
        return None;
    }
    let addr: std::net::IpAddr = no_zone.parse().ok()?;
    Some(addr.to_string())
}

/// CIDR 规范化：`A.B.C.D/N` 或 `v6addr/N`（可含 `%scope`）→ network address（mask）+ prefix。
/// 例 `192.168.1.5/24` → `192.168.1.0/24`；`fe80::1%eth0/128` → `fe80::1/128`。
/// 非法返回 `None`。
///
/// 与 `canonicalize_ip` 对齐：`"fe80::1%/64"`（`%` 后空 zone）语法可疑，显式
/// 拒绝而非静默接受，把 sampler 的输入验证 bug 暴露出来。
fn canonicalize_cidr(s: &str) -> Option<String> {
    let (addr_str, prefix_str) = s.split_once('/')?;
    let prefix: u8 = prefix_str.parse().ok()?;
    let (no_zone, zone) = addr_str.split_once('%').unwrap_or((addr_str, ""));
    if addr_str.contains('%') && zone.is_empty() {
        return None;
    }
    let addr: std::net::IpAddr = no_zone.parse().ok()?;
    match addr {
        std::net::IpAddr::V4(v4) => {
            if prefix > 32 {
                return None;
            }
            let bits = u32::from(v4);
            let mask = if prefix == 0 { 0u32 } else { !0u32 << (32 - prefix) };
            let masked = std::net::Ipv4Addr::from(bits & mask);
            Some(format!("{}/{}", masked, prefix))
        }
        std::net::IpAddr::V6(v6) => {
            if prefix > 128 {
                return None;
            }
            let bits = u128::from(v6);
            let mask = if prefix == 0 { 0u128 } else { !0u128 << (128 - prefix) };
            let masked = std::net::Ipv6Addr::from(bits & mask);
            Some(format!("{}/{}", masked, prefix))
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::vec_init_then_push)]
mod tests {
    use super::*;

    fn raw_iface(name: &str, iface_type: IfaceType) -> RawIface {
        RawIface {
            name: name.to_string(),
            iface_type,
            ssid: None,
            bssid: None,
            gateway_ip: None,
            gateway_mac: None,
            subnets: Vec::new(),
            metered: None,
            has_default_route: false,
        }
    }

    fn inv(interfaces: Vec<RawIface>) -> RawIfaceInventory {
        RawIfaceInventory {
            interfaces,
            dns_suffix: Vec::new(),
        }
    }

    // -------- MAC / IP / CIDR 规范化 --------

    #[test]
    fn mac_uppercase_to_lowercase() {
        assert_eq!(canonicalize_mac("AA:BB:CC:DD:EE:FF"), Some("aa:bb:cc:dd:ee:ff".into()));
    }

    #[test]
    fn mac_dash_separator_normalized_to_colon() {
        assert_eq!(canonicalize_mac("AA-BB-CC-DD-EE-FF"), Some("aa:bb:cc:dd:ee:ff".into()));
    }

    #[test]
    fn mac_too_short_returns_none() {
        assert_eq!(canonicalize_mac("aa:bb:cc:dd:ee"), None);
    }

    #[test]
    fn mac_non_hex_returns_none() {
        assert_eq!(canonicalize_mac("aa:bb:cc:dd:ee:zz"), None);
    }

    #[test]
    fn ip_v6_zone_stripped() {
        assert_eq!(canonicalize_ip("fe80::1%eth0"), Some("fe80::1".into()));
    }

    #[test]
    fn ip_v4_canonical_unchanged() {
        assert_eq!(canonicalize_ip("192.168.1.1"), Some("192.168.1.1".into()));
    }

    #[test]
    fn ip_invalid_returns_none() {
        assert_eq!(canonicalize_ip("not-an-ip"), None);
    }

    #[test]
    fn cidr_v4_masked_to_network_address() {
        // 192.168.1.5/24 → 192.168.1.0/24
        assert_eq!(canonicalize_cidr("192.168.1.5/24"), Some("192.168.1.0/24".into()));
    }

    #[test]
    fn cidr_v6_masked_with_zone_stripped() {
        // fe80::1%eth0/64 → fe80::/64
        assert_eq!(canonicalize_cidr("fe80::1%eth0/64"), Some("fe80::/64".into()));
    }

    #[test]
    fn cidr_prefix_zero_yields_zero_address() {
        assert_eq!(canonicalize_cidr("10.0.0.5/0"), Some("0.0.0.0/0".into()));
    }

    #[test]
    fn cidr_prefix_out_of_range_returns_none() {
        assert_eq!(canonicalize_cidr("192.168.1.5/33"), None);
        assert_eq!(canonicalize_cidr("fe80::/129"), None);
    }

    #[test]
    fn cidr_empty_zone_rejected() {
        // 与 canonicalize_ip 的空 zone 拒绝对齐，避免静默接受可疑输入
        assert_eq!(canonicalize_cidr("fe80::1%/64"), None);
        assert_eq!(canonicalize_cidr("192.168.1.5%/24"), None);
        // 带 zone 的合法形式仍被接受
        assert_eq!(canonicalize_cidr("fe80::1%eth0/64"), Some("fe80::/64".into()));
    }

    // -------- UTF-8 截断 --------

    #[test]
    fn ssid_ascii_under_limit_unchanged() {
        let raw = raw_iface("wlan0", IfaceType::Wifi);
        let r = RawIface {
            ssid: Some("office-5g".into()),
            ..raw
        };
        let ctx = build_context(inv(vec![r]), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces[0].ssid.as_deref(), Some("office-5g"));
    }

    #[test]
    fn ssid_multibyte_truncated_at_char_boundary() {
        // "办公室" = 9 bytes (UTF-8)；重复到 > 32 字节
        let long = "办公室".repeat(5); // 45 bytes
        let raw = RawIface {
            ssid: Some(long),
            ..raw_iface("wlan0", IfaceType::Wifi)
        };
        let ctx = build_context(inv(vec![raw]), SelfTunSnapshot::NoFilter, false).unwrap();
        let ssid = ctx.interfaces[0].ssid.as_deref().unwrap();
        assert!(ssid.len() <= SSID_MAX_BYTES, "len = {}", ssid.len());
        // 必须在字符边界截断
        assert!(std::str::from_utf8(ssid.as_bytes()).is_ok());
    }

    // -------- name 约束 --------

    #[test]
    fn empty_name_iface_dropped() {
        let raws = vec![
            raw_iface("", IfaceType::Ethernet),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 1);
        assert_eq!(ctx.interfaces[0].name, "en0");
    }

    #[test]
    fn overlong_name_iface_dropped() {
        let long = "x".repeat(NAME_MAX_BYTES + 1);
        let raws = vec![
            raw_iface(&long, IfaceType::Ethernet),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 1);
        assert_eq!(ctx.interfaces[0].name, "en0");
    }

    // -------- gateway 配对 --------

    #[test]
    fn gateway_mac_without_ip_is_cleared() {
        // Linux policy-routing 场景：wg0 有 MAC 但没 default route → gateway_ip 为 None
        let r = RawIface {
            gateway_ip: None,
            gateway_mac: Some("aa:bb:cc:dd:ee:ff".into()),
            ..raw_iface("wg0", IfaceType::Vpn)
        };
        let ctx = build_context(inv(vec![r]), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces[0].gateway_ip, None);
        assert_eq!(
            ctx.interfaces[0].gateway_mac, None,
            "gateway_mac must be cleared when gateway_ip is None (mihomo invalid_gateway_combo)"
        );
    }

    #[test]
    fn gateway_ip_without_mac_is_allowed() {
        // per-iface sampler 可能只读到 IP 而没查到 MAC（ARP miss）
        let r = RawIface {
            gateway_ip: Some("10.0.0.1".into()),
            gateway_mac: None,
            ..raw_iface("en0", IfaceType::Ethernet)
        };
        let ctx = build_context(inv(vec![r]), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces[0].gateway_ip.as_deref(), Some("10.0.0.1"));
        assert_eq!(ctx.interfaces[0].gateway_mac, None);
    }

    // -------- subnets --------

    #[test]
    fn subnets_drop_empty_and_dedup_and_sort() {
        let r = RawIface {
            subnets: vec![
                "".into(),
                "192.168.1.5/24".into(),
                "10.0.0.0/8".into(),
                "192.168.1.0/24".into(), // dup with first（after masking）
            ],
            ..raw_iface("en0", IfaceType::Ethernet)
        };
        let ctx = build_context(inv(vec![r]), SelfTunSnapshot::NoFilter, false).unwrap();
        let subnets = ctx.interfaces[0].subnets.as_ref().unwrap();
        assert_eq!(subnets, &vec!["10.0.0.0/8".to_string(), "192.168.1.0/24".to_string()]);
    }

    #[test]
    fn subnets_all_invalid_becomes_none() {
        let r = RawIface {
            subnets: vec!["garbage".into(), "also-bad".into()],
            ..raw_iface("en0", IfaceType::Ethernet)
        };
        let ctx = build_context(inv(vec![r]), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces[0].subnets, None);
    }

    // -------- 同名 iface 降级 --------

    #[test]
    fn duplicate_iface_name_returns_none() {
        let raws = vec![
            raw_iface("en0", IfaceType::Ethernet),
            raw_iface("en0", IfaceType::Wifi), // 同名不同 type → sampler bug
        ];
        let result = build_context(inv(raws), SelfTunSnapshot::NoFilter, false);
        assert!(result.is_none(), "duplicate iface name must trigger Sample::Unknown");
    }

    // -------- 按 name 升序 --------

    #[test]
    fn interfaces_sorted_by_name_ascending() {
        let raws = vec![
            raw_iface("wg0", IfaceType::Vpn),
            raw_iface("en0", IfaceType::Ethernet),
            raw_iface("wlan0", IfaceType::Wifi),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        let names: Vec<&str> = ctx.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, vec!["en0", "wg0", "wlan0"]);
    }

    // -------- 过滤 --------

    #[test]
    fn self_tun_known_is_filtered_out() {
        let raws = vec![
            raw_iface("utun3", IfaceType::Vpn),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::Known("utun3".into()), false).unwrap();
        assert_eq!(ctx.interfaces.len(), 1);
        assert_eq!(ctx.interfaces[0].name, "en0");
    }

    #[test]
    fn self_tun_no_filter_keeps_all() {
        let raws = vec![
            raw_iface("utun3", IfaceType::Vpn),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 2);
    }

    #[test]
    fn virtual_bridge_filtered_by_default() {
        let raws = vec![
            raw_iface("docker0", IfaceType::Other),
            raw_iface("br-abc123", IfaceType::Other),
            raw_iface("veth1234", IfaceType::Other),
            raw_iface("vEthernet (WSL)", IfaceType::Other),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        let names: Vec<&str> = ctx.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, vec!["en0"]);
    }

    #[test]
    fn virtual_bridge_retained_when_enable_virtual() {
        let raws = vec![
            raw_iface("docker0", IfaceType::Other),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, true).unwrap();
        assert_eq!(ctx.interfaces.len(), 2);
    }

    #[test]
    fn overlay_vpn_names_not_filtered_as_virtual_bridge() {
        // tailscale / zerotier / warp 不在默认 deny list
        let raws = vec![
            raw_iface("tailscale0", IfaceType::Vpn),
            raw_iface("zerotier0", IfaceType::Vpn),
            raw_iface("warp0", IfaceType::Vpn),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 4);
    }

    #[test]
    fn custom_name_prefixed_with_bridge_keyword_not_filtered() {
        // "main-docker0" 不该被 `^docker` 误匹配（我们用 ^ 锚定）
        let raws = vec![raw_iface("main-docker0", IfaceType::Other)];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 1);
    }

    // -------- 截断 --------

    #[test]
    fn truncate_respects_priority_order() {
        let mut raws: Vec<RawIface> = Vec::new();
        // 2 physical + 1 vpn + 31 loopback → 共 34，超过 32；应该保留 physical + vpn + 29 loopback
        raws.push(raw_iface("en0", IfaceType::Ethernet));
        raws.push(raw_iface("wlan0", IfaceType::Wifi));
        raws.push(raw_iface("wg0", IfaceType::Vpn));
        for i in 0..31 {
            raws.push(raw_iface(&format!("lo{:02}", i), IfaceType::Loopback));
        }
        assert_eq!(raws.len(), 34);
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 32);
        // physical / vpn 必须都保留
        let names: HashSet<&str> = ctx.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains("en0"));
        assert!(names.contains("wlan0"));
        assert!(names.contains("wg0"));
    }

    // -------- dns_suffix --------

    #[test]
    fn dns_suffix_lowercased_sorted_deduped_and_drops_forbidden_chars() {
        let raw_inv = RawIfaceInventory {
            interfaces: Vec::new(),
            dns_suffix: vec![
                "Corp.Example.Com".into(),
                "corp.example.com".into(), // dup after lowercase
                "Other.example.com".into(),
                "".into(),
                "has space".into(),    // 含空白 → drop
                "has,comma".into(),    // 含逗号 → drop
                "has\tcontrol".into(), // 含控制字符 → drop
            ],
        };
        let ctx = build_context(raw_inv, SelfTunSnapshot::NoFilter, false).unwrap();
        let dns = ctx.dns_suffix.as_ref().unwrap();
        assert_eq!(
            dns,
            &vec!["corp.example.com".to_string(), "other.example.com".to_string()]
        );
    }

    #[test]
    fn empty_dns_suffix_becomes_none() {
        let raw_inv = RawIfaceInventory {
            interfaces: Vec::new(),
            dns_suffix: vec!["".into(), "  ".into()],
        };
        let ctx = build_context(raw_inv, SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.dns_suffix, None);
    }

    // -------- 出口 --------

    #[test]
    fn output_version_always_one() {
        let ctx = build_context(inv(Vec::new()), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.version, 1);
    }

    #[test]
    fn empty_input_produces_empty_ctx_with_version() {
        let ctx = build_context(inv(Vec::new()), SelfTunSnapshot::NoFilter, false).unwrap();
        assert!(ctx.interfaces.is_empty());
        assert_eq!(ctx.dns_suffix, None);
        assert_eq!(ctx.version, 1);
    }

    // -------- round 1 修复补充：MAC 规则对齐 mihomo normalizeMAC --------

    #[test]
    fn mac_mixed_separators_rejected() {
        assert_eq!(canonicalize_mac("aa:bb-cc:dd-ee:ff"), None);
        assert_eq!(canonicalize_mac("AA-BB:CC-DD:EE-FF"), None);
    }

    #[test]
    fn mac_no_separator_twelve_hex_accepted() {
        assert_eq!(canonicalize_mac("aabbccddeeff"), Some("aa:bb:cc:dd:ee:ff".into()));
        assert_eq!(canonicalize_mac("AABBCCDDEEFF"), Some("aa:bb:cc:dd:ee:ff".into()));
    }

    #[test]
    fn mac_no_separator_wrong_length_rejected() {
        assert_eq!(canonicalize_mac("aabbccddeef"), None); // 11 chars
        assert_eq!(canonicalize_mac("aabbccddeeff00"), None); // 14 chars
    }

    #[test]
    fn mac_no_separator_non_hex_rejected() {
        assert_eq!(canonicalize_mac("zzbbccddeeff"), None);
    }

    // -------- round 1 修复补充：dns_suffix forbidden char 先于 trim --------

    #[test]
    fn dns_suffix_leading_trailing_whitespace_rejected_not_trimmed() {
        // `" corp.example.com "` 前后有空白 → 含 is_whitespace 字符 → drop
        // 而不是先 trim 再接受成 "corp.example.com"（会让非法输入洗白）
        let raw_inv = RawIfaceInventory {
            interfaces: Vec::new(),
            dns_suffix: vec![" corp.example.com ".into(), "clean.example.com".into()],
        };
        let ctx = build_context(raw_inv, SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.dns_suffix.as_ref().unwrap(), &vec!["clean.example.com".to_string()]);
    }

    #[test]
    fn dns_suffix_unicode_lowercase_covers_non_ascii() {
        // IDN 未 punycode 化的大写：`to_ascii_lowercase` 只处理 ASCII A-Z，
        // 'Я' 会留存大写，与 mihomo `strings.ToLower` 发散；`to_lowercase` 全 Unicode
        let raw_inv = RawIfaceInventory {
            interfaces: Vec::new(),
            dns_suffix: vec!["МойДомен.рф".into()],
        };
        let ctx = build_context(raw_inv, SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.dns_suffix.as_ref().unwrap(), &vec!["мойдомен.рф".to_string()]);
    }

    // -------- round 1 修复补充：空 SSID → None --------

    #[test]
    fn empty_ssid_becomes_none() {
        let r = RawIface {
            ssid: Some("".into()),
            ..raw_iface("wlan0", IfaceType::Wifi)
        };
        let ctx = build_context(inv(vec![r]), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces[0].ssid, None);
    }

    // -------- round 1 修复补充：vnic 虚拟桥过滤 --------

    #[test]
    fn vnic_filtered_as_virtual_bridge() {
        let raws = vec![
            raw_iface("vnic0", IfaceType::Other),
            raw_iface("vnic1", IfaceType::Other),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        let names: Vec<&str> = ctx.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, vec!["en0"]);
    }

    // -------- round 1 修复补充：truncate 细粒度策略 --------

    #[test]
    fn physical_with_default_route_preferred_over_physical_without() {
        // 33 张 physical：1 张 has_default_route=true + 32 张 false
        // 33 > 32，truncate 必须保留那张带 default_route 的
        let mut raws: Vec<RawIface> = Vec::new();
        raws.push(RawIface {
            has_default_route: true,
            ..raw_iface("priority0", IfaceType::Ethernet)
        });
        for i in 0..32 {
            raws.push(raw_iface(&format!("en{:02}", i), IfaceType::Ethernet));
        }
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 32);
        let names: HashSet<&str> = ctx.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(
            names.contains("priority0"),
            "physical with default_route must be retained"
        );
    }

    #[test]
    fn vpn_not_demoted_by_missing_default_route() {
        // wg-quick 场景：wg0 的 gateway_ip 在 Linux policy routing
        // 下持续为空 (has_default_route=false)。与其他 default_route=true 的 vpn
        // 并列，**不应**被 has_default_route 降级（vpn 族内不按 default_route 排序）。
        //
        // 构造：2 张 physical + 2 张 vpn + 30 张 loopback → 34 张，超过 32，
        // loopback 先被砍。两张 vpn 都必须保留。
        let mut raws: Vec<RawIface> = Vec::new();
        raws.push(raw_iface("en0", IfaceType::Ethernet));
        raws.push(raw_iface("wlan0", IfaceType::Wifi));
        raws.push(RawIface {
            has_default_route: false,
            gateway_ip: None,
            ..raw_iface("wg0", IfaceType::Vpn)
        });
        raws.push(RawIface {
            has_default_route: true,
            gateway_ip: Some("10.99.0.1".into()),
            ..raw_iface("tailscale0", IfaceType::Vpn)
        });
        for i in 0..30 {
            raws.push(raw_iface(&format!("lo{:02}", i), IfaceType::Loopback));
        }
        assert_eq!(raws.len(), 34);
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        assert_eq!(ctx.interfaces.len(), 32);
        let names: HashSet<&str> = ctx.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(
            names.contains("wg0"),
            "wg0 (default_route=false) must not be demoted within vpn family"
        );
        assert!(names.contains("tailscale0"));
    }

    // -------- round 1 修复补充：iface_type wire 映射 --------

    #[test]
    fn iface_type_wire_strings_match_contract() {
        assert_eq!(IfaceType::Wifi.as_wire_str(), "wifi");
        assert_eq!(IfaceType::Ethernet.as_wire_str(), "ethernet");
        assert_eq!(IfaceType::Cellular.as_wire_str(), "cellular");
        assert_eq!(IfaceType::Wwan.as_wire_str(), "wwan");
        assert_eq!(IfaceType::Vpn.as_wire_str(), "vpn");
        assert_eq!(IfaceType::Loopback.as_wire_str(), "loopback");
        assert_eq!(IfaceType::Other.as_wire_str(), "other");
    }

    // -------- round 1 修复补充：name trim 前置保证 sort 契约 --------

    #[test]
    fn leading_whitespace_name_trimmed_then_sorted_correctly() {
        // 如果 trim 发生在 canonicalize 而 sort 用 raw name，这里 "  z" 会排在 "a"
        // 之前（0x20 < 0x61），但 canonicalize 后输出 ["z", "a"] 违反 fingerprint
        // "按 name 升序"的契约。修复后：trim 前置 → sort 用 trimmed "z"/"a" → 最终
        // interfaces 正确按 ["a", "z"] 升序。
        let raws = vec![
            raw_iface("  z", IfaceType::Ethernet),
            raw_iface("a", IfaceType::Ethernet),
        ];
        let ctx = build_context(inv(raws), SelfTunSnapshot::NoFilter, false).unwrap();
        let names: Vec<&str> = ctx.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, vec!["a", "z"]);
    }

    #[test]
    fn self_tun_filter_uses_trimmed_name() {
        // sampler 给 "  utun3"（带前导空格），self_tun::Known("utun3")
        // 修复前：filter 用 raw name "  utun3" ≠ "utun3" → utun3 漏过滤
        // 修复后：name 前置 trim 后 == "utun3" → 正确过滤
        let raws = vec![
            raw_iface("  utun3", IfaceType::Vpn),
            raw_iface("en0", IfaceType::Ethernet),
        ];
        let ctx = build_context(raw_inv_owning(raws), SelfTunSnapshot::Known("utun3".into()), false).unwrap();
        assert_eq!(ctx.interfaces.len(), 1);
        assert_eq!(ctx.interfaces[0].name, "en0");
    }

    fn raw_inv_owning(interfaces: Vec<RawIface>) -> RawIfaceInventory {
        RawIfaceInventory {
            interfaces,
            dns_suffix: Vec::new(),
        }
    }
}
