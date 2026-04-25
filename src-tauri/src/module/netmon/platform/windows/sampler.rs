//! Windows 平台 netmon 采集。
//!
//! 用 `GetAdaptersAddresses` 枚举所有 admin-up 适配器 → 为每张 iface 构造
//! [`RawIface`]；`GetIpForwardTable2` 用于标注 `has_default_route` 并选择多
//! default 场景的 metric / next_hop 给 per-iface gateway_ip / gateway_mac 填充。
//!
//! 所有 Win32 调用同步阻塞，`collect_raw()` 用 `spawn_blocking` 包起来避免阻塞
//! tokio runtime。

use std::collections::HashMap;
use std::ffi::c_void;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::ptr;

use anyhow::{Context as _, Result};
use async_trait::async_trait;
use clash_verge_logging::{Type, logging};
use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_NOT_FOUND, ERROR_NOT_SUPPORTED, NO_ERROR};
use windows::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GAA_FLAG_INCLUDE_PREFIX, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
    GAA_FLAG_SKIP_MULTICAST, GetAdaptersAddresses, GetIpForwardTable2, GetIpInterfaceEntry,
    GetIpNetTable2, IP_ADAPTER_ADDRESSES_LH, IP_ADAPTER_UNICAST_ADDRESS_LH, MIB_IPFORWARD_TABLE2,
    MIB_IPINTERFACE_ROW, MIB_IPNET_TABLE2,
};
use windows::Win32::NetworkManagement::Ndis::{IfOperStatusUp, NET_LUID_LH};
use windows::Win32::Networking::WinSock::{ADDRESS_FAMILY, AF_INET, AF_INET6, AF_UNSPEC, SOCKADDR_INET};

use crate::module::netmon::context::{IfaceType, RawIface, RawIfaceInventory};
use crate::module::netmon::sampler::Sampler;
use crate::module::netmon::wifi_detection_enabled;

use super::{probe, wifi};

pub struct WindowsSampler;

#[async_trait]
impl Sampler for WindowsSampler {
    async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>> {
        tokio::task::spawn_blocking(collect_sync)
            .await
            .context("join spawn_blocking for windows sampler")
    }
}

/// 实际同步采集入口。失败 → `None`（sampler 不可用），成功 → `Some(inv)`
/// 即便 adapters 为空（离线场景走 `PUT { interfaces: [] }`）。
/// 所有 Win32 失败路径都在函数内部 warn 后降级为 `None`，不上抛 `Result`。
fn collect_sync() -> Option<RawIfaceInventory> {
    // 1. Dump default routes（v4 + v6）→ per-LUID 最佳 gateway 选择：
    //    v4 优先 → v6 fallback；同族多 default 时 metric 最小 → next_hop 字典序。
    //    per-iface 内 if_index 恒等，无需跨 iface 选 primary 的 tie-break。
    let gateways: HashMap<u64, GatewayChoice> = collect_per_iface_gateways();

    // 2. 枚举 adapters 链表
    let adapters_buf = get_adapters_addresses()?; // GetAdaptersAddresses 硬失败（IP Helper 不可用） → None

    // 3. 按过滤规则构造 RawIface[]
    let mut interfaces: Vec<RawIface> = Vec::new();
    let mut head = adapters_buf.head();
    while !head.is_null() {
        // SAFETY: head 非 null 由 loop 条件保证；IP_ADAPTER_ADDRESSES_LH 链表由
        // GetAdaptersAddresses 写入且未被释放（buf 生命周期见 `AdaptersAddressesBuf`）
        let adapter = unsafe { &*head };
        if let Some(iface) = adapter_to_raw_iface(adapter, &gateways) {
            interfaces.push(iface);
        }
        head = adapter.Next;
    }

    // 4. dns_suffix 采集
    let dns_suffix = super::dns_suffix::collect_dns_suffix();

    Some(RawIfaceInventory {
        interfaces,
        dns_suffix,
    })
}

/// 单张 iface 承担 default route 时的 gateway 选择结果。
#[derive(Debug, Clone)]
struct GatewayChoice {
    family: ADDRESS_FAMILY,
    /// next-hop IP（`row.NextHop`）。对点对点 / 隧道接口（Wintun, PPPoE, Teredo）的
    /// "on-link default route"，Windows 会写 NextHop=0.0.0.0 / ::——这类记录**仍然**
    /// 算承担 default route，但 `gateway_ip` 最终应上报为 None。用 `Option` 区分。
    next_hop: Option<IpAddr>,
    /// effective_metric = `route.Metric` + `interface.Metric`
    effective_metric: u32,
}

/// RAII wrapper：`FreeMibTable` 在 Drop 时调用，保证 panic / early-return 路径下
/// 也不会泄漏 IP Helper 分配的表内存。
struct MibTable<T> {
    ptr: *mut T,
}

impl<T> MibTable<T> {
    const fn new() -> Self {
        Self { ptr: ptr::null_mut() }
    }

    const fn as_ptr(&self) -> *mut T {
        self.ptr
    }

    const fn ptr_mut(&mut self) -> *mut *mut T {
        &mut self.ptr
    }
}

impl<T> Drop for MibTable<T> {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            // SAFETY: ptr 是 `GetIp*Table2` 成功时写入的 IP Helper 堆指针
            unsafe { FreeMibTable(self.ptr.cast::<c_void>()) };
        }
    }
}

/// 合并 v4 / v6 的 default route 集合 → per-LUID 最佳 [`GatewayChoice`]。
///
/// 合并规则：
/// 1. `gateway_ip` 填充优先级：v4 default → v6 fallback（同 LUID 同时有 v4/v6 时 v4 胜）
/// 2. 同族多 default：effective_metric（route.Metric + interface.Metric）最小 →
///    next_hop 字典序最小
/// 3. 本函数在 per-iface（LUID）粒度聚合，不再跨 iface 竞争；跨 iface 的"主 iface"
///    选择由上层 `build_context` 的截断策略负责
///
/// 两族 dump 任一失败 / 无此 family 静默跳过，另一族继续；IP Helper 完全失败的
/// 极端情形下所有 iface 的 `has_default_route=false`，上层视为离线网络（`PUT {
/// interfaces: [] }` 语义），是合理降级。
fn collect_per_iface_gateways() -> HashMap<u64, GatewayChoice> {
    let mut out: HashMap<u64, GatewayChoice> = HashMap::new();
    for family in [AF_INET, AF_INET6] {
        collect_default_routes(family, &mut out);
    }
    out
}

fn collect_default_routes(family: ADDRESS_FAMILY, out: &mut HashMap<u64, GatewayChoice>) {
    let mut table = MibTable::<MIB_IPFORWARD_TABLE2>::new();
    // SAFETY: table.ptr_mut() 指向局部 MibTable 的 ptr 字段；调用成功时填写有效堆指针
    let err = unsafe { GetIpForwardTable2(family, table.ptr_mut()) };
    if err == ERROR_NOT_FOUND || err == ERROR_NOT_SUPPORTED {
        return;
    }
    if err != NO_ERROR {
        logging!(
            debug,
            Type::Network,
            "netmon windows: GetIpForwardTable2(family={:?}) failed: {:?}",
            family,
            err
        );
        return;
    }
    // SAFETY: err == NO_ERROR 时 table.ptr 指向有效 MIB_IPFORWARD_TABLE2；NumEntries
    // 字段说明 Table 这个柔性数组的实际长度
    unsafe {
        let tbl = &*table.as_ptr();
        let n = tbl.NumEntries as usize;
        let rows = std::slice::from_raw_parts(tbl.Table.as_ptr(), n);
        for row in rows {
            if row.DestinationPrefix.PrefixLength != 0 {
                continue;
            }
            // NextHop 可能是 unspecified（on-link default，见 GatewayChoice 注释）——
            // 不再因此跳过；next_hop 走 Option 表达"没有具体下一跳 IP"
            let next_hop = sockaddr_inet_to_ip(&row.NextHop);
            // interface metric；失败跳过本候选：fallback 0 会让该候选反而比正确候选
            // 更"优"，与选优目标相反——宁可跳过不伪造。
            let Some(iface_metric) = get_interface_metric(family, row.InterfaceLuid) else {
                continue;
            };
            let effective = row.Metric.saturating_add(iface_metric);
            let candidate = GatewayChoice {
                family,
                next_hop,
                effective_metric: effective,
            };
            merge_candidate(out, row.InterfaceLuid.Value, candidate);
        }
    }
}

/// 把 `candidate` 与 `out[luid]` 按 v4-over-v6 + 同族 metric / next_hop 规则合并。
fn merge_candidate(out: &mut HashMap<u64, GatewayChoice>, luid: u64, candidate: GatewayChoice) {
    match out.get(&luid) {
        None => {
            out.insert(luid, candidate);
        }
        Some(existing) => {
            // v4 永远胜 v6
            if existing.family == AF_INET6 && candidate.family == AF_INET {
                out.insert(luid, candidate);
                return;
            }
            if existing.family == AF_INET && candidate.family == AF_INET6 {
                return;
            }
            // 同族：metric 最小 → next_hop 字典序最小；具体 next_hop 优于 on-link
            // default（`None`）—— 同 metric 下具体 IP 信息量更大，应该胜出
            let prefer_new = candidate.effective_metric < existing.effective_metric
                || (candidate.effective_metric == existing.effective_metric
                    && prefer_new_by_next_hop(&candidate.next_hop, &existing.next_hop));
            if prefer_new {
                out.insert(luid, candidate);
            }
        }
    }
}

/// 同 metric 下 tie-break：具体 `Some(ip)` 优先于 `None`（on-link default）；
/// 两者都具体则按字符串字典序；两者都 `None` → 不替换 existing（保序）。
fn prefer_new_by_next_hop(candidate: &Option<IpAddr>, existing: &Option<IpAddr>) -> bool {
    match (candidate, existing) {
        (Some(c), Some(e)) => c.to_string() < e.to_string(),
        (Some(_), None) => true,
        (None, _) => false,
    }
}

fn get_interface_metric(family: ADDRESS_FAMILY, luid: NET_LUID_LH) -> Option<u32> {
    let mut row = MIB_IPINTERFACE_ROW {
        Family: family,
        InterfaceLuid: luid,
        ..Default::default()
    };
    // SAFETY: row 已设置 Family + InterfaceLuid 作为查询 key
    let err = unsafe { GetIpInterfaceEntry(&mut row) };
    if err == NO_ERROR { Some(row.Metric) } else { None }
}

/// 调用 `GetAdaptersAddresses(AF_UNSPEC, ...)` 返回自管生命周期的 buffer。
/// 首次用 15K 尝试（MSDN 推荐），遇到 `ERROR_BUFFER_OVERFLOW` 扩容重试。
/// Win32 API 的所有失败分支都在内部 warn 后降级为 `None`，不上抛 `Result`。
fn get_adapters_addresses() -> Option<AdaptersAddressesBuf> {
    let flags = GAA_FLAG_INCLUDE_PREFIX
        | GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER;
    let family = AF_UNSPEC.0 as u32;
    // 用 `GaaBuffer`（Vec<u64> 底层）保证 8B 对齐；cast 到 IP_ADAPTER_ADDRESSES_LH*
    // 时满足类型对齐要求（align_of::<IP_ADAPTER_ADDRESSES_LH>() == 8 <= 8）
    let mut buf = probe::GaaBuffer::new(15_000);
    let mut buf_size: u32 = buf.byte_capacity();

    // 最多重试 3 次（IP Helper 很少需要 >2 次）
    for _ in 0..3 {
        // SAFETY: buf 非空且 8B 对齐；Win32 在 ret==NO_ERROR 时写入有效链表
        let ret = unsafe {
            GetAdaptersAddresses(
                family,
                flags,
                None,
                Some(buf.as_mut_u8_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>()),
                &mut buf_size,
            )
        };
        if ret == ERROR_BUFFER_OVERFLOW.0 {
            buf.resize(buf_size as usize);
            continue;
        }
        if ret == ERROR_NOT_FOUND.0 {
            // 系统无 adapter（极端情况，容器 / sandbox） → 返回空 buf
            return Some(AdaptersAddressesBuf::empty());
        }
        if ret != NO_ERROR.0 {
            logging!(
                warn,
                Type::Network,
                "netmon windows: GetAdaptersAddresses failed: {}",
                ret
            );
            return None;
        }
        // 成功；`buf` 现在持有有效的 linked-list，其 pointer 字段指向 buf 内部
        return Some(AdaptersAddressesBuf::from_buf(buf));
    }
    logging!(
        warn,
        Type::Network,
        "netmon windows: GetAdaptersAddresses kept returning BUFFER_OVERFLOW (buf_size={})",
        buf_size
    );
    None
}

/// `GetAdaptersAddresses` 结果 buffer 的 owning wrapper。链表节点的指针字段
/// （Next / FirstUnicastAddress / FriendlyName 等）全部指向 buf 内部，buf 必须在
/// 整个遍历期间存活。
struct AdaptersAddressesBuf {
    buf: probe::GaaBuffer,
    empty: bool,
}

impl AdaptersAddressesBuf {
    fn empty() -> Self {
        Self {
            buf: probe::GaaBuffer::new(8),
            empty: true,
        }
    }

    const fn from_buf(buf: probe::GaaBuffer) -> Self {
        Self { buf, empty: false }
    }

    const fn head(&self) -> *const IP_ADAPTER_ADDRESSES_LH {
        if self.empty {
            ptr::null()
        } else {
            self.buf.as_ptr::<IP_ADAPTER_ADDRESSES_LH>()
        }
    }
}

/// 单个 adapter → RawIface；失败（alias 为空 / OperStatus 非 Up / 无合法 IP）
/// 返回 `None`，被 caller 过滤掉。
fn adapter_to_raw_iface(
    adapter: &IP_ADAPTER_ADDRESSES_LH,
    gateways: &HashMap<u64, GatewayChoice>,
) -> Option<RawIface> {
    // admin up 过滤：只保留 IfOperStatusUp
    if adapter.OperStatus != IfOperStatusUp {
        return None;
    }

    // alias（FriendlyName）：UTF-16 PWSTR，空则丢弃
    // SAFETY: FriendlyName 是 Win32 写入的 PWSTR（NUL 终结或 null 指针）；
    // probe::pwstr_ptr_to_string 内部做 null 检查 + MAX_WIN32_PWSTR_LEN(1024) 上限
    let alias = unsafe { probe::pwstr_ptr_to_string(adapter.FriendlyName.0) };
    if alias.is_empty() {
        return None;
    }

    // iface_type：复用 probe 的分类
    let iface_type = probe::classify_iface_type_pure(&alias, adapter.IfType);

    // subnets：遍历 FirstUnicastAddress 链表，构造 CIDR。v4 / v6 都走 OnLinkPrefixLength。
    // 即使 subnets 最终为空（IPv6-only + 仅 link-local / RA 过渡态 / 占位接口）也保留
    // iface；iface_type / ssid / gateway_ip / has_default_route 对 matcher 仍有价值。
    let mut subnets: Vec<String> = Vec::new();
    let mut unicast = adapter.FirstUnicastAddress;
    while !unicast.is_null() {
        // SAFETY: unicast 非 null，IP_ADAPTER_UNICAST_ADDRESS_LH 由 IP Helper 写入
        let ua = unsafe { &*unicast };
        if let Some(cidr) = unicast_address_to_cidr(ua) {
            subnets.push(cidr);
        }
        unicast = ua.Next;
    }

    // LUID 取 union 的 u64 字段
    let luid_value = unsafe { adapter.Luid.Value };
    // gateway_ip / gateway_mac：从 `gateways` 聚合结果按本 LUID 取最佳候选填充。
    // GatewayChoice.next_hop 为 None（on-link default route）时 gateway_ip 保持 None，
    // 但 has_default_route 仍然是 true —— 让前端诊断 / matcher 能识别该 iface 确实承担
    // default 路由。
    let (gateway_ip, gateway_mac, has_default_route) = match gateways.get(&luid_value) {
        Some(g) => match g.next_hop {
            Some(ip) => {
                let mac = read_gateway_mac(ip, luid_value).ok();
                (Some(ip.to_string()), mac, true)
            }
            None => (None, None, true),
        },
        None => (None, None, false),
    };

    // Wi-Fi SSID / BSSID：仅 Wifi 类型 + 用户启用 wifi detection 时才查 WlanAPI。
    // Windows 不要求定位授权，但开关与 Linux / macOS 对称，给用户统一控制入口。
    let (ssid, bssid) = if iface_type == IfaceType::Wifi && wifi_detection_enabled() {
        wifi::read_wifi_info(luid_value)
    } else {
        (None, None)
    };

    Some(RawIface {
        name: alias,
        iface_type,
        ssid,
        bssid,
        gateway_ip,
        gateway_mac,
        subnets,
        metered: None, // sampler 当前不采集 metered
        has_default_route,
    })
}

/// 查指定 LUID 接口上 gateway IP 对应的二层 MAC。IPv4 走 ARP 缓存，IPv6 走
/// NDP 邻居缓存；都由 `GetIpNetTable2(family)` 统一暴露，仅 family 参数不同。
///
/// per-iface LUID 参数。失败（邻居表缺 entry / gateway 未解析）返回 `Err`，
/// 调用方 `.ok()` 后落到 `gateway_mac=None`。
fn read_gateway_mac(gateway: IpAddr, primary_luid_value: u64) -> Result<String> {
    let family = match gateway {
        IpAddr::V4(_) => AF_INET,
        IpAddr::V6(_) => AF_INET6,
    };
    let mut table = MibTable::<MIB_IPNET_TABLE2>::new();
    // SAFETY: table.ptr_mut() 指向局部 MibTable 的 ptr 字段
    let err = unsafe { GetIpNetTable2(family, table.ptr_mut()) };
    if err == ERROR_NOT_FOUND || err == ERROR_NOT_SUPPORTED {
        anyhow::bail!("GetIpNetTable2({:?}): no entries", family);
    }
    if err != NO_ERROR {
        anyhow::bail!("GetIpNetTable2({:?}): {:?}", family, err);
    }

    // SAFETY: err == NO_ERROR 时 table.ptr 有效；NumEntries 说明实际长度
    unsafe {
        let tbl = &*table.as_ptr();
        let rows = std::slice::from_raw_parts(tbl.Table.as_ptr(), tbl.NumEntries as usize);
        for row in rows {
            if row.InterfaceLuid.Value != primary_luid_value {
                continue;
            }
            if row.PhysicalAddressLength != 6 {
                continue;
            }
            if row.PhysicalAddress[..6] == [0u8; 6] {
                continue;
            }
            let Some(ip) = sockaddr_inet_to_ip(&row.Address) else {
                continue;
            };
            if ip == gateway {
                return Ok(probe::format_mac(&row.PhysicalAddress[..6]));
            }
        }
    }
    anyhow::bail!(
        "gateway {} on luid=0x{:x} not in neighbor cache",
        gateway,
        primary_luid_value
    )
}

/// 单个 unicast address 节点 → CIDR 字符串（`A.B.C.D/N` 或 `xxxx::xxxx/N`）。
fn unicast_address_to_cidr(ua: &IP_ADAPTER_UNICAST_ADDRESS_LH) -> Option<String> {
    let sockaddr_ptr = ua.Address.lpSockaddr;
    if sockaddr_ptr.is_null() {
        return None;
    }
    // SOCKADDR* 指向 SOCKADDR_INET 兼容布局（IPv4 → SOCKADDR_IN, IPv6 → SOCKADDR_IN6）
    // SAFETY: ua.Address.lpSockaddr 由 IP Helper 写入，指向 SOCKADDR/SOCKADDR_IN*；
    // 此处按 SOCKADDR_INET 读 si_family 后 dispatch 对应 variant
    let ip = unsafe {
        let si = &*sockaddr_ptr.cast::<SOCKADDR_INET>();
        sockaddr_inet_to_ip(si)?
    };

    let prefix = ua.OnLinkPrefixLength;
    let cidr = match ip {
        IpAddr::V4(v4) => {
            // prefix=0 对 matcher 语义下等价 "匹配任意 IPv4"，会引入误命中风险；
            // 不期望该值出现但防御性拒绝
            if prefix == 0 || prefix > 32 {
                return None;
            }
            let net = probe::network_address_v4(v4, prefix);
            format!("{}/{}", net, prefix)
        }
        IpAddr::V6(v6) => {
            if prefix == 0 || prefix > 128 {
                return None;
            }
            // IPv6 link-local 地址（fe80::/10）不进 subnets：matcher 语义下
            // link-local 对 "是否在同一子网" 没有意义，且跨 iface 重复严重
            if is_ipv6_link_local(v6) {
                return None;
            }
            let net = probe::network_address_v6(v6, prefix);
            format!("{}/{}", net, prefix)
        }
    };
    Some(cidr)
}

const fn is_ipv6_link_local(ip: Ipv6Addr) -> bool {
    let seg = ip.segments()[0];
    (seg & 0xffc0) == 0xfe80
}

fn sockaddr_inet_to_ip(addr: &SOCKADDR_INET) -> Option<IpAddr> {
    // SAFETY: si_family 指明应读哪个 variant
    unsafe {
        match addr.si_family {
            AF_INET => {
                let octets: u32 = addr.Ipv4.sin_addr.S_un.S_addr;
                // sin_addr.S_un.S_addr 是 network byte order
                let ip = Ipv4Addr::from(u32::from_be(octets));
                if ip.is_unspecified() {
                    None
                } else {
                    Some(IpAddr::V4(ip))
                }
            }
            AF_INET6 => {
                let bytes: [u8; 16] = addr.Ipv6.sin6_addr.u.Byte;
                let ip = Ipv6Addr::from(bytes);
                if ip.is_unspecified() {
                    None
                } else {
                    Some(IpAddr::V6(ip))
                }
            }
            _ => None,
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn ipv6_link_local_detected() {
        assert!(is_ipv6_link_local("fe80::1".parse().unwrap()));
        assert!(is_ipv6_link_local("fe80::abcd:1234".parse().unwrap()));
        assert!(!is_ipv6_link_local("2001:db8::1".parse().unwrap()));
        assert!(!is_ipv6_link_local("::1".parse().unwrap()));
        assert!(!is_ipv6_link_local("fec0::1".parse().unwrap()));
    }

    fn gw(family: ADDRESS_FAMILY, ip: &str, metric: u32) -> GatewayChoice {
        GatewayChoice {
            family,
            next_hop: Some(ip.parse().unwrap()),
            effective_metric: metric,
        }
    }

    fn gw_onlink(family: ADDRESS_FAMILY, metric: u32) -> GatewayChoice {
        GatewayChoice {
            family,
            next_hop: None,
            effective_metric: metric,
        }
    }

    #[test]
    fn merge_candidate_v4_always_wins_over_v6() {
        let luid = 0xabcd_u64;
        let mut map: HashMap<u64, GatewayChoice> = HashMap::new();
        // v6 先到
        merge_candidate(&mut map, luid, gw(AF_INET6, "fe80::1", 10));
        assert!(matches!(map[&luid].next_hop, Some(IpAddr::V6(_))));
        // v4 后到：即便 metric 更大也胜（v4-over-v6 规则）
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 100));
        assert!(matches!(map[&luid].next_hop, Some(IpAddr::V4(_))));
        assert_eq!(map[&luid].effective_metric, 100);
    }

    #[test]
    fn merge_candidate_v4_retains_when_v6_arrives() {
        let luid = 1_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 100));
        merge_candidate(&mut map, luid, gw(AF_INET6, "::1", 1));
        assert!(matches!(map[&luid].next_hop, Some(IpAddr::V4(_))));
    }

    fn next_hop_str(g: &GatewayChoice) -> String {
        g.next_hop.map(|ip| ip.to_string()).unwrap_or_default()
    }

    #[test]
    fn merge_candidate_same_family_picks_min_metric() {
        let luid = 2_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 50));
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.2", 10));
        assert_eq!(map[&luid].effective_metric, 10);
        assert_eq!(next_hop_str(&map[&luid]), "10.0.0.2");
    }

    #[test]
    fn merge_candidate_metric_tie_picks_lexicographically_smallest_next_hop() {
        let luid = 3_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.2", 50));
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 50));
        assert_eq!(next_hop_str(&map[&luid]), "10.0.0.1");
    }

    #[test]
    fn merge_candidate_first_wins_on_complete_tie() {
        let luid = 4_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 50));
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 50));
        assert_eq!(next_hop_str(&map[&luid]), "10.0.0.1");
    }

    #[test]
    fn merge_candidate_cross_iface_luids_independent() {
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AF_INET, "192.168.1.1", 25));
        merge_candidate(&mut map, 20, gw(AF_INET, "192.168.2.1", 25));
        // 两个独立 LUID 彼此不干扰
        assert_eq!(next_hop_str(&map[&10]), "192.168.1.1");
        assert_eq!(next_hop_str(&map[&20]), "192.168.2.1");
    }

    #[test]
    fn merge_candidate_onlink_default_keeps_entry_with_no_next_hop() {
        // Wintun / PPPoE / Teredo 的 on-link default route：NextHop=0.0.0.0 被
        // sockaddr_inet_to_ip 过滤为 None。该 luid 仍然算承担 default route。
        let luid = 5_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw_onlink(AF_INET, 100));
        assert!(map.contains_key(&luid));
        assert!(map[&luid].next_hop.is_none());
    }

    #[test]
    fn merge_candidate_onlink_vs_specific_same_family_specific_wins_on_smaller_metric() {
        // 同族场景：metric 5 的具体 next_hop 比 metric 100 的 on-link 更优
        let luid = 6_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw_onlink(AF_INET, 100));
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 5));
        assert_eq!(map[&luid].effective_metric, 5);
        assert_eq!(next_hop_str(&map[&luid]), "10.0.0.1");
    }

    #[test]
    fn merge_candidate_same_metric_specific_wins_over_onlink_existing_none() {
        // existing = on-link (None)，candidate = Some(ip) 且 metric 相同 → Some 应胜
        let luid = 7_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw_onlink(AF_INET, 50));
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 50));
        assert_eq!(next_hop_str(&map[&luid]), "10.0.0.1");
        assert!(map[&luid].next_hop.is_some());
    }

    #[test]
    fn merge_candidate_same_metric_specific_retains_when_onlink_arrives_later() {
        // existing = Some(ip)，candidate = on-link (None) 且 metric 相同 → Some 保留
        let luid = 8_u64;
        let mut map = HashMap::new();
        merge_candidate(&mut map, luid, gw(AF_INET, "10.0.0.1", 50));
        merge_candidate(&mut map, luid, gw_onlink(AF_INET, 50));
        assert_eq!(next_hop_str(&map[&luid]), "10.0.0.1");
    }
}
