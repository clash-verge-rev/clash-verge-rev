//! Windows DNS search-list 采集入口。
//!
//! 当前阶段仅提供 stub，恒返回空 `Vec<String>`。真实实现（`GetAdaptersAddresses`
//! 的 `FirstSuffixSearchList` 链读取 + `DnsSuffix` fallback）由后续 commit
//! 落地。平台 sampler 填充时调用 [`collect_dns_suffix`] 填
//! `RawIfaceInventory.dns_suffix`；采集失败一律返回空 Vec（不阻塞 PUT），
//! 保持 host-side 对外宽容行为。
#[allow(dead_code)] // 平台 sampler 接入后即可消费
pub fn collect_dns_suffix() -> Vec<String> {
    Vec::new()
}
