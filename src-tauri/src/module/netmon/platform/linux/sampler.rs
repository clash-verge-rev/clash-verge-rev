//! Linux 平台 netmon 采集：rtnetlink dump 全部 link + 默认路由 → per-link
//! 构造 [`RawIface`]。
//!
//! enumerate 所有 admin-up link，过滤 / 截断统一交给
//! [`super::super::context::build_context`]；sampler 不挑 primary。

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use anyhow::{Context as _, Result};
use async_trait::async_trait;
use clash_verge_logging::{Type, logging};
use futures::TryStreamExt as _;
use network_interface::NetworkInterfaceConfig as _;
use rtnetlink::packet_route::AddressFamily;
use rtnetlink::packet_route::link::{LinkAttribute, LinkFlags};
use rtnetlink::packet_route::neighbour::{NeighbourAddress, NeighbourAttribute};
use rtnetlink::packet_route::route::{RouteAddress, RouteAttribute, RouteHeader, RouteMessage, RouteType};
use rtnetlink::{Handle, IpVersion, RouteMessageBuilder, new_connection};

use crate::module::netmon::context::{IfaceType, RawIface, RawIfaceInventory};
use crate::module::netmon::sampler::Sampler;
use crate::module::netmon::wifi_detection_enabled;
use crate::process::AsyncHandler;

use super::{probe, wifi};

pub struct LinuxSampler;

#[async_trait]
impl Sampler for LinuxSampler {
    async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>> {
        let (connection, handle, _) = new_connection().context("open rtnetlink connection")?;
        let conn_task = AsyncHandler::spawn(move || async move {
            connection.await;
        });
        let result = collect_with_handle(&handle).await;
        conn_task.abort();
        result
    }
}

/// 单个 link 的原始投影：名字 + sysfs 判出的 iface_type。
struct LinkEntry {
    name: String,
    iface_type: IfaceType,
    if_index: u32,
}

async fn collect_with_handle(handle: &Handle) -> Result<Option<RawIfaceInventory>> {
    // 1. dump 所有 link，按 admin-up 过滤；保序（rtnetlink 返回顺序通常是 ifindex 升序）
    let links = dump_admin_up_links(handle).await?;

    // 2. dump default routes 构造 per-ifindex 最佳 gateway 选择（§2.3 b）：
    //    v4 优先 → v6 fallback；同族 priority（metric）最小 → next_hop 字典序。
    //    per-iface 内 if_index 恒等，第 3 条 tie-break 不适用。
    let gateways = collect_per_iface_gateways(handle).await;

    // 3. NetworkInterface::show 一次，供所有 iface 查询复用
    let net_ifaces = match network_interface::NetworkInterface::show() {
        Ok(v) => Some(v),
        Err(e) => {
            logging!(
                warn,
                Type::Network,
                "netmon linux: NetworkInterface::show failed, subnets will be empty: {:?}",
                e
            );
            None
        }
    };

    // 4. 为每个 link 构造 RawIface
    let mut interfaces: Vec<RawIface> = Vec::with_capacity(links.len());
    for link in links {
        let subnets = net_ifaces
            .as_deref()
            .map(|ifs| probe::build_subnets_from(ifs, &link.name))
            .unwrap_or_default();
        let gateway = gateways.get(&link.if_index);
        let has_default_route = gateway.is_some();

        // gateway_ip / gateway_mac：per-iface 按 §2.3 (b) 填充。GatewayChoice.next_hop
        // 为 None（on-link default，罕见）时 gateway_ip 保持 None 但 has_default_route
        // 仍为 true。MAC 查询：v4 走 /proc/net/arp；v6 走 rtnetlink RTM_GETNEIGH。
        let (gateway_ip, gateway_mac) = match gateway.and_then(|g| g.next_hop) {
            Some(IpAddr::V4(ip)) => {
                let mac = probe::read_gateway_mac_v4(ip, &link.name).ok();
                (Some(IpAddr::V4(ip).to_string()), mac)
            }
            Some(IpAddr::V6(ip)) => {
                let mac = read_gateway_mac_v6(handle, ip, link.if_index).await.ok();
                (Some(IpAddr::V6(ip).to_string()), mac)
            }
            None => (None, None),
        };

        // Wi-Fi SSID / BSSID：仅 Wifi 类型 + 用户启用 wifi detection 时才调 WEXT
        // ioctl。Linux 不要求定位授权，但开关与 macOS / Windows 对称给用户统一
        // 控制入口。
        let (ssid, bssid) = if link.iface_type == IfaceType::Wifi && wifi_detection_enabled() {
            wifi::read_wifi_info(&link.name)
        } else {
            (None, None)
        };

        interfaces.push(RawIface {
            name: link.name,
            iface_type: link.iface_type,
            ssid,
            bssid,
            gateway_ip,
            gateway_mac,
            subnets,
            metered: None, // sampler 当前不采集 metered
            has_default_route,
        });
    }

    // 5. dns_suffix：实装调用 `resolvectl` subprocess + 读 `/etc/resolv.conf`，
    //    是阻塞 I/O，必须用 `spawn_blocking` 包裹，避免占住当前 async worker。
    //    Windows / macOS 的整条采样路径都在 `spawn_blocking(collect_sync)` 里
    //    统一包；Linux 因为 rtnetlink 是 async，只能把 dns_suffix 这一段单独丢到
    //    blocking pool。
    let dns_suffix = match tokio::task::spawn_blocking(super::dns_suffix::collect_dns_suffix).await {
        Ok(v) => v,
        Err(e) => {
            // JoinError 的可能根因：blocking worker panic（collect_dns_suffix 自己
            // 在各失败路径都已 warn + 返回空 Vec，panic 基本不该发生），或 tokio
            // runtime 降级到无 worker 的状态。静默 `unwrap_or_default` 会让
            // dns_suffix "悄悄为空"，与"采到了但为空"撞车，诊断困难——warn 留痕
            // 便于未来判断是环境问题还是真的没有 suffix。
            logging!(
                warn,
                Type::Network,
                "netmon linux: spawn_blocking(collect_dns_suffix) failed ({:?}); dns_suffix will be empty",
                e
            );
            Vec::new()
        }
    };

    Ok(Some(RawIfaceInventory { interfaces, dns_suffix }))
}

/// 通过 rtnetlink `RTM_GETLINK` dump 所有 link，按 `IFF_UP` 过滤 admin-up。
/// 丢弃 loopback 之外的 link 名为空 / 读不到的条目。
async fn dump_admin_up_links(handle: &Handle) -> Result<Vec<LinkEntry>> {
    let mut stream = handle.link().get().execute();
    let mut out: Vec<LinkEntry> = Vec::new();
    while let Some(msg) = stream.try_next().await.context("rtnetlink link dump")? {
        // admin-up 过滤：IFF_UP 标志位
        if !msg.header.flags.contains(LinkFlags::Up) {
            continue;
        }
        let mut name: Option<String> = None;
        for attr in &msg.attributes {
            if let LinkAttribute::IfName(n) = attr {
                name = Some(n.clone());
                break;
            }
        }
        let Some(name) = name else { continue };
        if name.is_empty() {
            continue;
        }
        let iface_type = probe::classify_iface_type(&name);
        out.push(LinkEntry {
            name,
            iface_type,
            if_index: msg.header.index,
        });
    }
    Ok(out)
}

/// 单张 iface 承担 default route 时的 gateway 选择结果。
#[derive(Debug, Clone)]
struct GatewayChoice {
    family: AddressFamily,
    /// next-hop IP。对点对点 / 隧道接口的 on-link default route 内核可能不填
    /// Gateway attr；这类记录仍算承担 default route，但 `gateway_ip` 应上报
    /// 为 None——用 `Option` 区分。
    next_hop: Option<IpAddr>,
    /// route priority（metric）；metric=0 kernel 不填 RTA_PRIORITY，缺省视为 0
    priority: u32,
}

/// Dump v4 + v6 default route → per-ifindex 最佳选择。v4 优先 → v6 fallback；
/// 同族 priority 最小 → next_hop 字典序最小（具体 Some 优于 on-link None）。
async fn collect_per_iface_gateways(handle: &Handle) -> HashMap<u32, GatewayChoice> {
    let mut out: HashMap<u32, GatewayChoice> = HashMap::new();
    for family in [AddressFamily::Inet, AddressFamily::Inet6] {
        if let Err(e) = collect_default_candidates(handle, family, &mut out).await {
            logging!(
                debug,
                Type::Network,
                "netmon linux: dump default routes failed (family={:?}): {:?}",
                family,
                e
            );
        }
    }
    out
}

async fn collect_default_candidates(
    handle: &Handle,
    family: AddressFamily,
    out: &mut HashMap<u32, GatewayChoice>,
) -> Result<()> {
    match family {
        AddressFamily::Inet => {
            let msg = RouteMessageBuilder::<Ipv4Addr>::new().build();
            let mut stream = handle.route().get(msg).execute();
            while let Some(m) = stream.try_next().await.context("rtnetlink route dump (v4)")? {
                for (priority, oif, next_hop) in extract_default_candidates(&m) {
                    merge_candidate(
                        out,
                        oif,
                        GatewayChoice {
                            family,
                            next_hop,
                            priority,
                        },
                    );
                }
            }
        }
        AddressFamily::Inet6 => {
            let msg = RouteMessageBuilder::<Ipv6Addr>::new().build();
            let mut stream = handle.route().get(msg).execute();
            while let Some(m) = stream.try_next().await.context("rtnetlink route dump (v6)")? {
                for (priority, oif, next_hop) in extract_default_candidates(&m) {
                    merge_candidate(
                        out,
                        oif,
                        GatewayChoice {
                            family,
                            next_hop,
                            priority,
                        },
                    );
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// 把 `candidate` 与 `out[ifindex]` 按 §2.3 (b) 优先级合并。
fn merge_candidate(out: &mut HashMap<u32, GatewayChoice>, ifindex: u32, candidate: GatewayChoice) {
    match out.get(&ifindex) {
        None => {
            out.insert(ifindex, candidate);
        }
        Some(existing) => {
            // v4 永远胜 v6
            if existing.family == AddressFamily::Inet6 && candidate.family == AddressFamily::Inet {
                out.insert(ifindex, candidate);
                return;
            }
            if existing.family == AddressFamily::Inet && candidate.family == AddressFamily::Inet6 {
                return;
            }
            // 同族：priority 最小 → next_hop 字典序最小；具体 Some 优于 on-link None
            let prefer_new = candidate.priority < existing.priority
                || (candidate.priority == existing.priority
                    && prefer_new_by_next_hop(&candidate.next_hop, &existing.next_hop));
            if prefer_new {
                out.insert(ifindex, candidate);
            }
        }
    }
}

/// 同 metric 下 tie-break：具体 `Some(ip)` 优先于 `None`（on-link default）；
/// 两者都具体则按字符串字典序；两者都 `None` → 不替换 existing。与 Windows
/// sampler 的 `prefer_new_by_next_hop` 对称。
fn prefer_new_by_next_hop(candidate: &Option<IpAddr>, existing: &Option<IpAddr>) -> bool {
    match (candidate, existing) {
        (Some(c), Some(e)) => c.to_string() < e.to_string(),
        (Some(_), None) => true,
        (None, _) => false,
    }
}

/// 通过 rtnetlink `RTM_GETNEIGH` dump IPv6 NDP 邻居表，按 (ifindex, Destination)
/// 过滤到 gateway 的二层 MAC。v4 走 `/proc/net/arp`（见
/// `probe::read_gateway_mac_v4`），Linux 下 v6 没有 `/proc/net/*` 快照，必须走
/// netlink。
async fn read_gateway_mac_v6(handle: &Handle, ip: Ipv6Addr, if_index: u32) -> Result<String> {
    let mut stream = handle.neighbours().get().set_family(IpVersion::V6).execute();
    while let Some(msg) = stream.try_next().await.context("rtnetlink neighbour dump (v6)")? {
        if msg.header.ifindex != if_index {
            continue;
        }
        let mut dest: Option<Ipv6Addr> = None;
        let mut mac: Option<[u8; 6]> = None;
        for attr in &msg.attributes {
            match attr {
                NeighbourAttribute::Destination(NeighbourAddress::Inet6(d)) => {
                    dest = Some(*d);
                }
                // rtnetlink 把 NDA_LLADDR 命名为 `LinkLocalAddress`，这里指的是
                // **link-layer / 二层 MAC**（非 IPv6 fe80::/10 link-local 地址）。
                // 6 字节 guard 排除 Infiniband 等非 Ethernet 邻居的 LLADDR（>6 字节）。
                NeighbourAttribute::LinkLocalAddress(bytes) if bytes.len() == 6 => {
                    let arr: [u8; 6] = bytes[..6].try_into().unwrap_or([0; 6]);
                    if arr != [0u8; 6] {
                        mac = Some(arr);
                    }
                }
                _ => {}
            }
        }
        if dest == Some(ip)
            && let Some(m) = mac
        {
            return Ok(format!(
                "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
                m[0], m[1], m[2], m[3], m[4], m[5]
            ));
        }
    }
    anyhow::bail!("v6 gateway {} on ifindex={} not in neighbor cache", ip, if_index)
}

/// 从一条 `RouteMessage` 提取 0 到 N 条候选 `(priority, oif, gateway_ip)`。
///
/// 过滤：
/// - 非默认路由（`destination_prefix_length != 0`）
/// - 非 Unicast（Blackhole / Unreachable / Prohibit 等）
/// - 非 main table（通过 `RouteAttribute::Table` 处理扩展表号 > 255）
///
/// 对于 multipath / ECMP 默认路由（双 ISP、bonded 等），顶层没有 Oif，而是放在
/// `RouteAttribute::MultiPath` 的 nexthop 列表里。本函数会展开每个 nexthop 为
/// 独立候选，共享同一 Priority。
pub fn extract_default_candidates(msg: &RouteMessage) -> Vec<(u32, u32, Option<std::net::IpAddr>)> {
    if msg.header.destination_prefix_length != 0 {
        return Vec::new();
    }
    if !matches!(msg.header.kind, RouteType::Unicast) {
        return Vec::new();
    }
    let table_attr = msg.attributes.iter().find_map(|a| match a {
        RouteAttribute::Table(t) => Some(*t),
        _ => None,
    });
    let table = table_attr.unwrap_or_else(|| u32::from(msg.header.table));
    if table != u32::from(RouteHeader::RT_TABLE_MAIN) {
        return Vec::new();
    }

    // metric=0 的路由内核不会发 RTA_PRIORITY（nla_put_u32 对 0 值跳过），
    // 这类路由的**真实** metric 是 0，不是未知；用 0 作为缺省正确反映内核语义。
    let priority = msg
        .attributes
        .iter()
        .find_map(|a| match a {
            RouteAttribute::Priority(p) => Some(*p),
            _ => None,
        })
        .unwrap_or(0);

    // 先看 MultiPath（ECMP / 双 ISP / bonded 等）
    if let Some(nexthops) = msg.attributes.iter().find_map(|a| match a {
        RouteAttribute::MultiPath(nhs) => Some(nhs),
        _ => None,
    }) {
        return nexthops
            .iter()
            .filter(|nh| nh.interface_index != 0)
            .map(|nh| {
                let gateway = nh.attributes.iter().find_map(|a| match a {
                    RouteAttribute::Gateway(addr) => route_address_to_ip(addr),
                    _ => None,
                });
                (priority, nh.interface_index, gateway)
            })
            .collect();
    }

    // 单 nexthop：顶层 Oif + 顶层 Gateway
    let Some(oif) = msg.attributes.iter().find_map(|a| match a {
        RouteAttribute::Oif(i) => Some(*i),
        _ => None,
    }) else {
        return Vec::new();
    };
    let gateway = msg.attributes.iter().find_map(|a| match a {
        RouteAttribute::Gateway(addr) => route_address_to_ip(addr),
        _ => None,
    });
    vec![(priority, oif, gateway)]
}

pub(super) const fn route_address_to_ip(addr: &RouteAddress) -> Option<std::net::IpAddr> {
    match addr {
        RouteAddress::Inet(ip) => Some(std::net::IpAddr::V4(*ip)),
        RouteAddress::Inet6(ip) => Some(std::net::IpAddr::V6(*ip)),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use rtnetlink::packet_route::route::RouteNextHop;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    fn default_v4_msg() -> RouteMessage {
        let mut header = RouteHeader::default();
        header.address_family = AddressFamily::Inet;
        header.destination_prefix_length = 0;
        header.table = RouteHeader::RT_TABLE_MAIN;
        header.kind = RouteType::Unicast;

        let mut msg = RouteMessage::default();
        msg.header = header;
        msg.attributes = vec![
            RouteAttribute::Priority(100),
            RouteAttribute::Oif(3),
            RouteAttribute::Gateway(RouteAddress::Inet("192.168.1.1".parse::<Ipv4Addr>().unwrap())),
        ];
        msg
    }

    #[test]
    fn extract_skips_non_default_prefix() {
        let mut msg = default_v4_msg();
        msg.header.destination_prefix_length = 24;
        assert!(extract_default_candidates(&msg).is_empty());
    }

    #[test]
    fn extract_skips_blackhole() {
        let mut msg = default_v4_msg();
        msg.header.kind = RouteType::BlackHole;
        assert!(extract_default_candidates(&msg).is_empty());
    }

    #[test]
    fn extract_skips_non_main_table_via_attribute() {
        let mut msg = default_v4_msg();
        msg.attributes.insert(0, RouteAttribute::Table(1000));
        assert!(extract_default_candidates(&msg).is_empty());
    }

    #[test]
    fn extract_missing_priority_defaults_to_zero() {
        let mut msg = default_v4_msg();
        msg.attributes.retain(|a| !matches!(a, RouteAttribute::Priority(_)));
        let cands = extract_default_candidates(&msg);
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].0, 0, "metric=0 路由不带 RTA_PRIORITY，缺省应视为 0 最高优先级");
    }

    #[test]
    fn extract_missing_oif_returns_empty() {
        let mut msg = default_v4_msg();
        msg.attributes.retain(|a| !matches!(a, RouteAttribute::Oif(_)));
        assert!(extract_default_candidates(&msg).is_empty());
    }

    #[test]
    fn extract_ipv4_gateway_ok() {
        let msg = default_v4_msg();
        let cands = extract_default_candidates(&msg);
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].0, 100);
        assert_eq!(cands[0].1, 3);
        assert_eq!(cands[0].2, Some("192.168.1.1".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn extract_ipv6_gateway_ok() {
        let mut header = RouteHeader::default();
        header.address_family = AddressFamily::Inet6;
        header.table = RouteHeader::RT_TABLE_MAIN;
        header.kind = RouteType::Unicast;

        let mut msg = RouteMessage::default();
        msg.header = header;
        msg.attributes = vec![
            RouteAttribute::Priority(1024),
            RouteAttribute::Oif(5),
            RouteAttribute::Gateway(RouteAddress::Inet6("fe80::1".parse::<Ipv6Addr>().unwrap())),
        ];
        let cands = extract_default_candidates(&msg);
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].1, 5);
        assert_eq!(cands[0].2, Some("fe80::1".parse::<IpAddr>().unwrap()));
    }

    fn make_nexthop(interface_index: u32, gateway: Ipv4Addr) -> RouteNextHop {
        let mut nh = RouteNextHop::default();
        nh.interface_index = interface_index;
        nh.attributes = vec![RouteAttribute::Gateway(RouteAddress::Inet(gateway))];
        nh
    }

    // ---------- merge_candidate（§2.3 b）----------

    fn gw(family: AddressFamily, ip: &str, priority: u32) -> GatewayChoice {
        GatewayChoice {
            family,
            next_hop: Some(ip.parse().unwrap()),
            priority,
        }
    }

    fn gw_onlink(family: AddressFamily, priority: u32) -> GatewayChoice {
        GatewayChoice {
            family,
            next_hop: None,
            priority,
        }
    }

    #[test]
    fn merge_v4_wins_over_existing_v6() {
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet6, "fe80::1", 10));
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 100));
        // v4 胜出即便 priority 更大
        assert!(matches!(map[&10].next_hop, Some(IpAddr::V4(_))));
    }

    #[test]
    fn merge_v6_candidate_loses_to_existing_v4() {
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 100));
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet6, "::1", 1));
        assert!(matches!(map[&10].next_hop, Some(IpAddr::V4(_))));
    }

    #[test]
    fn merge_same_family_min_priority() {
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 100));
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.2", 50));
        assert_eq!(map[&10].priority, 50);
        assert_eq!(map[&10].next_hop, Some("10.0.0.2".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn merge_same_priority_specific_beats_onlink() {
        // existing = on-link (None)，candidate = Some(ip) 且 priority 相同 → Some 胜
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw_onlink(AddressFamily::Inet, 50));
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 50));
        assert_eq!(map[&10].next_hop, Some("10.0.0.1".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn merge_same_priority_both_some_lex_order() {
        // 同族同 priority，字符串字典序小者胜
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.2", 50));
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 50));
        assert_eq!(map[&10].next_hop, Some("10.0.0.1".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn merge_both_none_keeps_existing() {
        // 双 None → 不替换 existing（保序）
        let existing_family = AddressFamily::Inet;
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw_onlink(existing_family, 50));
        merge_candidate(&mut map, 10, gw_onlink(existing_family, 50));
        assert!(map[&10].next_hop.is_none());
    }

    #[test]
    fn merge_existing_some_retains_when_none_arrives_later() {
        // existing = Some(ip)，candidate = None（on-link），same priority → 不替换
        // 与 `merge_same_priority_specific_beats_onlink` 对称，覆盖
        // `prefer_new_by_next_hop` 的 `(None, _)` 分支
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 50));
        merge_candidate(&mut map, 10, gw_onlink(AddressFamily::Inet, 50));
        assert_eq!(map[&10].next_hop, Some("10.0.0.1".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn merge_cross_iface_independent() {
        // 不同 ifindex 之间互不干扰：防未来重构误把 ifindex 当 global key
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "192.168.1.1", 25));
        merge_candidate(&mut map, 20, gw(AddressFamily::Inet, "192.168.2.1", 25));
        assert_eq!(map[&10].next_hop, Some("192.168.1.1".parse::<IpAddr>().unwrap()));
        assert_eq!(map[&20].next_hop, Some("192.168.2.1".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn merge_idempotent_on_identical_candidates() {
        // same family + same priority + same Some(ip) → map 状态幂等；三字段完全
        // 相同时 "保留 existing" 与 "替换为 candidate" 在断言视角下等价，本测试
        // 专门锁定"重复插入不破坏状态"。"严格 `<` 不是 `<=`" 的语义由
        // `merge_same_priority_both_some_lex_order` +
        // `merge_existing_some_retains_when_none_arrives_later` 两个测试覆盖。
        let mut map = HashMap::new();
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 50));
        merge_candidate(&mut map, 10, gw(AddressFamily::Inet, "10.0.0.1", 50));
        assert_eq!(map[&10].next_hop, Some("10.0.0.1".parse::<IpAddr>().unwrap()));
        assert_eq!(map[&10].priority, 50);
    }

    #[test]
    fn extract_expands_multipath_nexthops() {
        let mut header = RouteHeader::default();
        header.address_family = AddressFamily::Inet;
        header.table = RouteHeader::RT_TABLE_MAIN;
        header.kind = RouteType::Unicast;

        let mut msg = RouteMessage::default();
        msg.header = header;
        msg.attributes = vec![
            RouteAttribute::Priority(100),
            RouteAttribute::MultiPath(vec![
                make_nexthop(3, "10.0.0.1".parse().unwrap()),
                make_nexthop(4, "10.0.0.2".parse().unwrap()),
            ]),
        ];
        let cands = extract_default_candidates(&msg);
        assert_eq!(cands.len(), 2);
        assert_eq!(cands[0], (100, 3, Some("10.0.0.1".parse::<IpAddr>().unwrap())));
        assert_eq!(cands[1], (100, 4, Some("10.0.0.2".parse::<IpAddr>().unwrap())));
    }
}
