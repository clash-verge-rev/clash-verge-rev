//! Windows DNS search-list 采集。
//!
//! 优先读 `GetAdaptersAddresses` 每个 **admin-up** adapter 的 `FirstDnsSuffix`
//! 链（per-link search list，通常由 DHCP / 域策略下发）；为空时 fallback 到
//! `DnsSuffix`（connection-specific DNS suffix，注意**不是** search list 的严格
//! 成员，但作为 fallback 覆盖老系统 / 非标准下发场景）。
//!
//! **合并语义**：上报系统实际生效的 search list 的 union——所有
//! `IfOperStatusUp` 的 adapter 各自的 suffix 汇总（down / disconnected adapter
//! 上次留下的陈旧 suffix 必须跳过，否则会与 sampler 的 iface 过滤口径不一致，
//! 导致 `dns_suffix` 命中早已不在的公司网络）。归一化（lowercase +
//! dedup + sort + 非法字符过滤）由上层
//! [`crate::module::netmon::context::normalize_dns_suffix`] 完成。本模块只负责"读"，
//! 原始字符串按 OS 返回原样透传（不 trim、不过滤空白），把异常输入的
//! decision 留给 normalize 步骤做集中处理。
//!
//! **失败语义**：任一 Win32 调用失败 → 返回空 Vec，符合 "采集失败 →
//! dns_suffix=[] 不阻塞 PUT" 契约。

use clash_verge_logging::{Type, logging};
use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_NOT_FOUND, NO_ERROR};
use windows::Win32::NetworkManagement::IpHelper::{
    GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_FRIENDLY_NAME,
    GAA_FLAG_SKIP_MULTICAST, GAA_FLAG_SKIP_UNICAST, GetAdaptersAddresses, IP_ADAPTER_ADDRESSES_LH,
};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::Networking::WinSock::AF_UNSPEC;

use super::probe;

pub fn collect_dns_suffix() -> Vec<String> {
    // 仅需 DNS 相关字段，跳过 unicast / anycast / multicast / dns server / friendly
    // name 让 IP Helper 少做无用功（显著减小返回 buffer 体积）
    let flags = GAA_FLAG_SKIP_UNICAST
        | GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER
        | GAA_FLAG_SKIP_FRIENDLY_NAME;
    let family = AF_UNSPEC.0 as u32;
    let mut buf = probe::GaaBuffer::new(15_000);
    let mut buf_size: u32 = buf.byte_capacity();

    for _ in 0..3 {
        // SAFETY: buf 8B 对齐（GaaBuffer 底层 Vec<u64>），满足 IP_ADAPTER_ADDRESSES_LH
        // 对齐；Win32 在 ret == NO_ERROR 时写入有效链表
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
            return Vec::new();
        }
        if ret != NO_ERROR.0 {
            logging!(
                debug,
                Type::Network,
                "netmon windows dns_suffix: GetAdaptersAddresses failed: {}",
                ret
            );
            return Vec::new();
        }
        return extract_suffixes_from_buffer(&buf);
    }
    logging!(
        debug,
        Type::Network,
        "netmon windows dns_suffix: GetAdaptersAddresses kept returning BUFFER_OVERFLOW"
    );
    Vec::new()
}

fn extract_suffixes_from_buffer(buf: &probe::GaaBuffer) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut head: *const IP_ADAPTER_ADDRESSES_LH = buf.as_ptr();
    while !head.is_null() {
        // SAFETY: head 非 null 由 loop 条件保证；链表节点在 buf 内部，buf 生命周期
        // 与本函数栈帧一致
        let adapter = unsafe { &*head };

        // 仅采集 admin-up adapter 的 suffix；down / disconnected 的陈旧 suffix
        // 会和 sampler 的 iface 过滤口径不一致，导致 dns_suffix 命中早已不在的
        // 公司网络（与"实际生效的 search list"语义相违）
        if adapter.OperStatus != IfOperStatusUp {
            head = adapter.Next;
            continue;
        }

        // 首选：per-link search list（FirstDnsSuffix 链）
        let mut sfx = adapter.FirstDnsSuffix;
        let mut pushed_any_link_suffix = false;
        while !sfx.is_null() {
            // SAFETY: sfx 非 null；IP_ADAPTER_DNS_SUFFIX.String 是 [u16; 256] 的 NUL
            // 终结缓冲
            let node = unsafe { &*sfx };
            let s = probe::pwstr_to_string(&node.String);
            // 不 trim——把空白 / 控制字符的处理留给 normalize_dns_suffix 统一去重 /
            // 过滤。这里仅丢空串（pwstr_to_string 已切断 NUL，空串 = 该节点无内容）。
            if !s.is_empty() {
                out.push(s);
                pushed_any_link_suffix = true;
            }
            sfx = node.Next;
        }

        // Fallback：仅当该 adapter 的 per-link list 完全为空时，用 connection-specific
        // DnsSuffix（严格说不是 search list 的一部分，但部分老 / 非标准环境只填这个）
        if !pushed_any_link_suffix {
            // SAFETY: DnsSuffix 是 PWSTR；空指针由 probe::pwstr_ptr_to_string 内部 check
            let dns_suffix = unsafe { probe::pwstr_ptr_to_string(adapter.DnsSuffix.0) };
            if !dns_suffix.is_empty() {
                out.push(dns_suffix);
            }
        }

        head = adapter.Next;
    }
    out
}
