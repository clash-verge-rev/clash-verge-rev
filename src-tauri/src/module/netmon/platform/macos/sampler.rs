//! macOS 平台 netmon 采集：SCDynamicStore 枚举服务 + getifaddrs 查 ifi_type。
//!
//! enumerate 所有 active service → 构造全量 [`RawIface`] 集合，过滤 / 截断统一
//! 交给 [`super::super::context::build_context`]；sampler 不挑 primary。
//!
//! 所有 Darwin API 同步阻塞，`collect_raw()` 用 `spawn_blocking` 包起来避免阻
//! 塞 tokio runtime。

use std::collections::{HashMap, HashSet};
use std::ffi::{CStr, c_void};
use std::net::IpAddr;
use std::ptr;

use anyhow::{Context as _, Result, anyhow};
use async_trait::async_trait;
use clash_verge_logging::{Type, logging};
use core_foundation::ConcreteCFType;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType, ToVoid as _};
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use libc::{
    AF_INET, AF_INET6, AF_LINK, CTL_NET, NET_RT_FLAGS, PF_ROUTE, RTF_LLINFO, freeifaddrs, getifaddrs, ifaddrs, sysctl,
};
use network_interface::NetworkInterfaceConfig as _;
use system_configuration::dynamic_store::{SCDynamicStore, SCDynamicStoreBuilder};

use crate::module::netmon::context::{IfaceType, RawIface, RawIfaceInventory};
use crate::module::netmon::sampler::Sampler;
use crate::module::netmon::wifi_detection_enabled;

use super::{probe, wifi};

pub struct MacosSampler;

#[async_trait]
impl Sampler for MacosSampler {
    async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>> {
        tokio::task::spawn_blocking(collect_sync)
            .await
            .context("join spawn_blocking for macos sampler")?
    }
}

fn collect_sync() -> Result<Option<RawIfaceInventory>> {
    let store = SCDynamicStoreBuilder::new("clash-verge-netmon-sampler")
        .build()
        .ok_or_else(|| anyhow!("SCDynamicStoreCreate returned NULL"))?;

    // 1. 枚举所有 active service 的 (InterfaceName, Router)；两族合并
    //    按 iface 名聚合（同一 iface 可能同时出现在 v4/v6）。v4 router 优先；
    //    无 v4 → 用 v6。§2.3 b 的 metric / next_hop 字典序 tie-break 在
    //    SCDynamicStore 层面不适用——service 级别不暴露 metric，同 iface 同族
    //    多 Router 极罕见；ServiceOrder 的先到胜出等价"按系统偏好第一个"。
    let iface_data = enumerate_active_services(&store);

    // 2. v4 + v6 邻居表各拉一次，建立 (if_index, ip) → mac 的查找索引，避免
    //    per-iface 重复 sysctl（每次调用返回整机邻居表）
    let neighbors_v4 = fetch_neighbor_entries(AF_INET);
    let neighbors_v6 = fetch_neighbor_entries(AF_INET6);

    // 3. getifaddrs 一次 + NetworkInterface::show 一次，供所有 iface 查询复用
    //    （避免 build_raw_iface 内部 per-iface 重复拉取整机链表，N 个 iface ≈ 2N
    //    次 getifaddrs；合并到这里变成 2 次）。任一失败均 `debug` 级 log + 降级
    //    （classify 退化 IfaceType::Other，subnets 空）。不把 sample 整体 Err——
    //    一次瞬时 getifaddrs 失败不值得丢掉整批 iface_type 和 has_default_route 信息。
    let if_addrs = match IfAddrsGuard::new() {
        Ok(g) => Some(g),
        Err(e) => {
            // warn 级：失败影响面比 sysctl 更大（所有 iface 的 iface_type 退化成
            // Other、gateway_mac 缺失），运维侧需要能感知；service loop 的 3s
            // debounce 已限制重复频率。
            logging!(
                warn,
                Type::Network,
                "netmon macos: getifaddrs failed, iface_type/if_index will degrade: {:?}",
                e
            );
            None
        }
    };
    let net_ifaces = match network_interface::NetworkInterface::show() {
        Ok(v) => Some(v),
        Err(e) => {
            logging!(
                warn,
                Type::Network,
                "netmon macos: NetworkInterface::show failed, subnets will be empty: {:?}",
                e
            );
            None
        }
    };

    // 4. 对每个 iface_name 构造 RawIface
    let mut interfaces: Vec<RawIface> = Vec::new();
    for name in &iface_data.order {
        let gateway_ip = iface_data.gateways.get(name).copied();
        let has_default_route = iface_data.default_route_ifaces.contains(name);
        let iface = build_raw_iface(
            name,
            gateway_ip,
            has_default_route,
            &neighbors_v4,
            &neighbors_v6,
            if_addrs.as_ref(),
            net_ifaces.as_deref(),
        );
        interfaces.push(iface);
    }

    // 5. dns_suffix 采集
    let dns_suffix = super::dns_suffix::collect_dns_suffix();

    Ok(Some(RawIfaceInventory { interfaces, dns_suffix }))
}

/// 枚举 SCDynamicStore 里所有 active service 的 InterfaceName + Router。
///
/// 返回：
/// - `order`：按 ServiceOrder（macOS "服务顺序"）+ 首次出现去重后的 iface 名顺序，
///   保序让 build_context 的 step 5 sort-by-name 之前存在可预测输入
/// - `gateways`：iface → gateway IP 映射。v4 优先 → v6 fallback；同族多 Router
///   罕见，ServiceOrder 第一个命中者胜
#[derive(Default)]
struct IfaceData {
    order: Vec<String>,
    gateways: HashMap<String, IpAddr>,
    /// iface 名 → 是否承担默认路由。来源：SCDynamicStore 服务字典里是否存在
    /// `Router` key（与 `gateways` 解耦）。与 Linux/Windows 对齐，避免用
    /// `gateway_ip.is_some()` 反推——部分 IPv6 link-local 网关在 macOS 15+
    /// 会被配成无法 parse 的字符串（带嵌入 scope 等），此时 Router 字段仍表达
    /// "该 iface 承担默认路由"，只是 next-hop 取不到具体 IP。
    default_route_ifaces: HashSet<String>,
}

fn enumerate_active_services(store: &SCDynamicStore) -> IfaceData {
    let mut out = IfaceData::default();
    let mut seen: HashSet<String> = HashSet::new();

    // v4 优先 → v6 fallback（族优先级）
    for family in ["IPv4", "IPv6"] {
        for key in enumerate_service_keys(store, family) {
            let Some(svc) = read_service(store, &key) else {
                continue;
            };
            if svc.iface_name.is_empty() {
                continue;
            }
            if seen.insert(svc.iface_name.clone()) {
                out.order.push(svc.iface_name.clone());
            }
            if svc.has_default_route {
                out.default_route_ifaces.insert(svc.iface_name.clone());
            }
            // 首次出现的 Router 胜；v4 先遍历 → v6 只能在 v4 未填 Router 时补
            if let Some(router) = svc.router
                && !out.gateways.contains_key(&svc.iface_name)
            {
                out.gateways.insert(svc.iface_name, router);
            }
        }
    }
    out
}

/// 按 ServiceOrder 列出指定 family 的所有 service 的 key。ServiceOrder 读不到
/// 或空时退化为无序（`SCDynamicStore::get_keys` 按 pattern 返回），仍比不做好。
fn enumerate_service_keys(store: &SCDynamicStore, family_suffix: &str) -> Vec<String> {
    let service_order = read_service_order(store);
    if service_order.is_empty() {
        let pattern = format!("State:/Network/Service/[^/]+/{}", family_suffix);
        return store
            .get_keys(CFString::new(pattern.as_str()))
            .map(|keys| {
                (0..keys.len())
                    .filter_map(|i| keys.get(i).map(|k| k.to_string()))
                    .collect()
            })
            .unwrap_or_default();
    }
    service_order
        .into_iter()
        .map(|uuid| format!("State:/Network/Service/{}/{}", uuid, family_suffix))
        .collect()
}

/// 读 `Setup:/Network/Global/IPv4.ServiceOrder` 拿系统服务优先级（UUID 列表）。
///
/// 使用对两族共用 —— macOS `Setup:/Network/Global/IPv4.ServiceOrder` 存的是全局
/// UUID 优先级列表，不按 family 分；SCDynamicStore 只在 IPv4 global key 下放
/// 这个字段，IPv6 枚举也复用同一顺序。
///
/// 读失败 / 非预期类型 / 空数组 → 返回空 vec，调用方走无序 fallback。
fn read_service_order(store: &SCDynamicStore) -> Vec<String> {
    let Some(value) = store.get(CFString::new("Setup:/Network/Global/IPv4")) else {
        return Vec::new();
    };
    let Some(dict) = value.downcast::<CFDictionary>() else {
        return Vec::new();
    };
    let Some(array) = dict_find_downcast::<CFArray>(&dict, "ServiceOrder") else {
        return Vec::new();
    };
    (0..array.len())
        .filter_map(|i| {
            // CFArray 默认 item 是 `*const c_void` raw ptr，显式 per-element
            // downcast 到 CFString 而不是 `CFArray<CFString>` 的直接转型——
            // 如果元素不是 CFString，此处返 None 而非做 wrong-type method dispatch
            let item = array.get(i)?;
            let raw = *item as CFTypeRef;
            if raw.is_null() {
                return None;
            }
            // SAFETY: array.get 返回 borrowed ref；wrap_under_get_rule 按 Get Rule
            // 语义 retain 一次、CFType drop 释放，引用计数配平
            let ty = unsafe { CFType::wrap_under_get_rule(raw) };
            ty.downcast::<CFString>().map(|s| s.to_string())
        })
        .collect()
}

/// 通用辅助：从 `CFDictionary` 按字符串 key find，downcast 到 `T`。找不到 /
/// 类型不匹配 → None；避免在调用点重复 CFType wrap + downcast 模板。
fn dict_find_downcast<T: TCFType + ConcreteCFType>(dict: &CFDictionary, key: &str) -> Option<T> {
    let cf_key = CFString::new(key);
    let ptr = dict.find(cf_key.to_void())?;
    let raw = *ptr as CFTypeRef;
    if raw.is_null() {
        return None;
    }
    // SAFETY: dict.find 返回 borrowed ref（&*const c_void）；解引用后的裸指针
    // 按 CoreFoundation Get Rule 由 wrap_under_get_rule 做 retain，CFType
    // drop 时 release
    let ty = unsafe { CFType::wrap_under_get_rule(raw) };
    ty.downcast::<T>()
}

/// 单个 service entry 的简单投影：InterfaceName + 默认路由归属 + Router（可选）。
///
/// `has_default_route` 与 `router` 解耦：前者来源于"dict 是否存在 Router key"，
/// 后者来源于"Router 字符串是否能解析成 IpAddr"。macOS 15+ 某些 configd 版本
/// 会把 IPv6 link-local gateway 带 embedded-scope 的非标字符串塞进 Router
/// 字段，`Ipv6Addr::from_str` 不能 parse 但 iface 仍然承担默认路由——分两个
/// 字段保留这种真实世界语义，与 Linux/Windows 实现行为对齐。
struct ServiceEntry {
    iface_name: String,
    has_default_route: bool,
    router: Option<IpAddr>,
}

fn read_service(store: &SCDynamicStore, key: &str) -> Option<ServiceEntry> {
    let value = store.get(CFString::new(key))?;
    let dict = value.downcast::<CFDictionary>()?;

    let iface_name = dict_find_downcast::<CFString>(&dict, "InterfaceName")?.to_string();

    // Router 字段是 CFString（IPv4 点分 / IPv6 冒号分）。SCDynamicStore 通常返
    // 不带 zone 的裸字符串，但 macOS 15+ 某些 configd 版本会把 `%en0` 附在
    // IPv6 link-local 尾部，而 `Ipv6Addr::from_str` 不支持 zone ID → 剥 `%`
    // 之后再 parse，避免本 iface 的 gateway_ip 错过。parse 失败（罕见）视为无
    // 可用 gateway_ip，但 `has_default_route` 仍为 true（见 ServiceEntry 注释）；
    // 非 CFString 类型时 `dict_find_downcast` 返 None，视为无 Router。
    let router_raw = dict_find_downcast::<CFString>(&dict, "Router");
    let has_default_route = router_raw.is_some();
    let router = router_raw.and_then(|s| {
        let raw = s.to_string();
        // `split_once('%')` 语义清晰：有 % 时返 (IP 部分, zone)，无 % 时返 None
        // 走 fallback 用原串
        let without_zone = raw.split_once('%').map(|(a, _)| a).unwrap_or(&raw);
        match without_zone.parse::<IpAddr>() {
            Ok(ip) => Some(ip),
            Err(err) => {
                // 罕见：SCDynamicStore Router 字符串不是合法 IP（历史上见过
                // macOS 15+ 部分 configd build 带嵌入 scope 的 IPv6 link-local
                // 格式）。debug 级留痕便于诊断，但不影响上报：`has_default_route`
                // 仍为 true，只是 gateway_ip 会缺。
                logging!(
                    debug,
                    Type::Network,
                    "netmon macos: Router field for service {} is not a valid IpAddr (raw={:?}, err={})",
                    key,
                    raw,
                    err
                );
                None
            }
        }
    });

    Some(ServiceEntry {
        iface_name,
        has_default_route,
        router,
    })
}

/// 把 iface 名 → `RawIface`：getifaddrs 读 ifi_type 分类 + build_subnets 构造
/// subnets + gateway_ip/mac 填充 + has_default_route 标注。
///
/// `if_addrs` / `net_ifaces` 由 `collect_sync` 在外层统一拉取后传引用，避免
/// 每 iface 各拉一次整机链表的 N+1 开销。
fn build_raw_iface(
    iface_name: &str,
    gateway_ip: Option<IpAddr>,
    has_default_route: bool,
    neighbors_v4: &[probe::ArpEntry],
    neighbors_v6: &[probe::ArpEntry],
    if_addrs: Option<&IfAddrsGuard>,
    net_ifaces: Option<&[network_interface::NetworkInterface]>,
) -> RawIface {
    let (mut iface_type, if_index) = classify_by_getifaddrs(iface_name, if_addrs);

    // macOS `getifaddrs` 对 802.11 Wi-Fi 网卡也返 IFT_ETHER（不用 IFT_IEEE80211）；
    // 单靠 ifi_type 无法区分 Wi-Fi 与有线以太。必须用 CoreWLAN 的
    // `interfaceWithName:` 做权威判断：该接口在 CWWiFiClient 管理列表里 →
    // 升级 Ethernet → Wifi。仅在 base 是 Ethernet 时调用（避免对明确非
    // Wi-Fi 的 Vpn / Loopback 误升级）。
    //
    // 本查询不依赖 Location 权限（只查接口类型），即便 `wifi_detection_enabled`
    // 为 false 也能跑——此处只判定 iface_type，SSID/BSSID 读取另有 gate。
    if iface_type == IfaceType::Ethernet && wifi::is_wifi_interface(iface_name) {
        iface_type = IfaceType::Wifi;
    }

    let subnets = net_ifaces
        .map(|ifaces| probe::build_subnets_from(ifaces, iface_name))
        .unwrap_or_default();

    // gateway_mac：仅当 gateway_ip 已填且 getifaddrs 给了有效 if_index 时查
    // 邻居表；v4/v6 各自用对应族的缓存
    let gateway_mac = gateway_ip.zip(if_index).and_then(|(ip, idx)| {
        let table = match ip {
            IpAddr::V4(_) => neighbors_v4,
            IpAddr::V6(_) => neighbors_v6,
        };
        probe::find_gateway_mac(table, ip, idx)
    });

    // Wi-Fi SSID / BSSID：仅 Wifi 类型 + 用户启用 wifi detection 时才查 CoreWLAN。
    // macOS 14+ 读 SSID/BSSID 要 Location 授权（由 `location.rs` 的 UX 管理），
    // 关闭时静默返回 `(None, None)`，iface 仍以 iface_type=Wifi 上报。
    let (ssid, bssid) = if iface_type == IfaceType::Wifi && wifi_detection_enabled() {
        wifi::read_wifi_info(iface_name)
    } else {
        (None, None)
    };

    RawIface {
        name: iface_name.to_string(),
        iface_type,
        ssid,
        bssid,
        gateway_ip: gateway_ip.map(|ip| ip.to_string()),
        gateway_mac,
        subnets,
        metered: None, // sampler 当前不采集 metered
        has_default_route,
    }
}

/// 调 sysctl `[CTL_NET, PF_ROUTE, 0, family, NET_RT_FLAGS, RTF_LLINFO]` 拿
/// ARP / NDP 邻居表 bytes，用 `probe::parse_sysctl_rtm_llinfo` 解析。
///
/// 失败 / 空表返回空 Vec；所有 iface 的 gateway_mac 查询共享本函数一次输出，
/// 避免每 iface 各调一次全表拉取的 N 倍开销。
fn fetch_neighbor_entries(family: i32) -> Vec<probe::ArpEntry> {
    let mut mib: [i32; 6] = [CTL_NET, PF_ROUTE, 0, family, NET_RT_FLAGS, RTF_LLINFO];

    // 第一次调用：size=0，拿需要的字节数
    let mut needed: usize = 0;
    // SAFETY: 传入 mib 长度 6；buf=null 让内核只写 needed
    let rc = unsafe { sysctl(mib.as_mut_ptr(), 6, ptr::null_mut(), &mut needed, ptr::null_mut(), 0) };
    if rc != 0 {
        logging!(
            warn,
            Type::Network,
            "netmon macos: sysctl NET_RT_FLAGS sizing failed (family={}, rc={}, errno={})",
            family,
            rc,
            std::io::Error::last_os_error()
        );
        return Vec::new();
    }
    if needed == 0 {
        // 合法的"空邻居表"场景（比如 IPv6-only 没任何 ARP entry），debug 级
        logging!(
            debug,
            Type::Network,
            "netmon macos: sysctl NET_RT_FLAGS returned empty table (family={})",
            family
        );
        return Vec::new();
    }

    let mut buf = vec![0u8; needed];
    // SAFETY: buf 按 needed 分配
    let rc = unsafe {
        sysctl(
            mib.as_mut_ptr(),
            6,
            buf.as_mut_ptr() as *mut c_void,
            &mut needed,
            ptr::null_mut(),
            0,
        )
    };
    if rc != 0 {
        logging!(
            warn,
            Type::Network,
            "netmon macos: sysctl NET_RT_FLAGS read failed (family={}, rc={}, errno={})",
            family,
            rc,
            std::io::Error::last_os_error()
        );
        return Vec::new();
    }
    buf.truncate(needed);
    probe::parse_sysctl_rtm_llinfo(&buf)
}

/// RAII 包装 getifaddrs 结果，Drop 时 freeifaddrs。
struct IfAddrsGuard(*mut ifaddrs);

impl IfAddrsGuard {
    fn new() -> Result<Self> {
        let mut head: *mut ifaddrs = ptr::null_mut();
        // SAFETY: getifaddrs 在成功时填写 head，失败时返 -1
        let rc = unsafe { getifaddrs(&mut head) };
        if rc != 0 {
            anyhow::bail!("getifaddrs failed: {}", std::io::Error::last_os_error());
        }
        Ok(Self(head))
    }
}

impl Drop for IfAddrsGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: head 是 getifaddrs 分配的链表头
            unsafe { freeifaddrs(self.0) };
        }
    }
}

/// 遍历 getifaddrs 查找 name 匹配的 AF_LINK 条目，读 if_data.ifi_type，调用
/// probe 分类。返回 (iface_type, if_index)；if_index 用于 gateway_mac 邻居表查询
/// （sysctl NET_RT_FLAGS 结果需按 if_index 过滤）。
///
/// `if_addrs` 由 `collect_sync` 外层统一拉取后传入；当外层失败 / 未传入时退化
/// 调用处自己拉一次，保留原 API 行为。iface_type 拿不到时退化为 `Other`
/// （保守分类：不会误判为物理）。
fn classify_by_getifaddrs(iface: &str, if_addrs: Option<&IfAddrsGuard>) -> (IfaceType, Option<u16>) {
    // 外层未提供（极端：getifaddrs 在 collect_sync 顶层失败）→ 退化 Other
    let Some(guard) = if_addrs else {
        return (IfaceType::Other, None);
    };

    let mut cur = guard.0;
    while !cur.is_null() {
        // SAFETY: 链表节点生命周期由 guard 持有
        let node = unsafe { &*cur };
        if node.ifa_name.is_null() {
            // getifaddrs 正常语义下不返 null，但极端场景（坏内核 / 第三方 kext）
            // 若返 null，裸 CStr::from_ptr(null) 直接 UB；与 ifa_addr / ifa_data
            // 的 is_null 检查对称防御一次。
            cur = node.ifa_next;
            continue;
        }
        // SAFETY: ifa_name 非 null + NUL 终结（BSD 契约）
        let name = unsafe { CStr::from_ptr(node.ifa_name) }.to_string_lossy().to_string();
        if name == iface
            && !node.ifa_addr.is_null()
            // SAFETY: ifa_addr 非 null；sa_len / sa_family 在结构头固定偏移
            && unsafe { (*node.ifa_addr).sa_len } >= 4
            && i32::from(unsafe { (*node.ifa_addr).sa_family }) == AF_LINK
            && !node.ifa_data.is_null()
        {
            // SAFETY: ifa_data 对 AF_LINK 指向 if_data 结构；ifi_type 是第 0 字节
            let ifi_type = unsafe { *(node.ifa_data as *const u8) };
            // sockaddr_dl 的 sdl_index 在偏移 2-3（u16 ne）。sa_len 已校验 >= 4
            // 保证 bytes[2..4] 在 sockaddr 边界内（BSD `sockaddr_dl` 的 header
            // 其实是 8 字节，但 sa_len 最小 4 已覆盖 sdl_index 偏移）
            let sdl_ptr = node.ifa_addr as *const u8;
            // SAFETY: sa_len >= 4 + sockaddr_dl 布局由 BSD 稳定
            let if_index = unsafe {
                let b0 = *sdl_ptr.add(2);
                let b1 = *sdl_ptr.add(3);
                u16::from_ne_bytes([b0, b1])
            };
            return (probe::classify_iface_type_pure(iface, ifi_type), Some(if_index));
        }
        cur = node.ifa_next;
    }

    (IfaceType::Other, None)
}
