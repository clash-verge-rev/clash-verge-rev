//! macOS DNS search-list 采集。
//!
//! 读 `SCDynamicStore` 的 `State:/Network/Global/DNS` 字典里的 `SearchDomains`
//! 字段——`CFArray<CFString>`。macOS 已经把当前生效的 search list（各 adapter
//! union + 配置叠加）汇总到这一 global key，不需要在 host 侧再合并。
//!
//! **合并语义**：直接透传 `SearchDomains` 数组内容；归一化
//! （lowercase / dedup / sort / 非法字符过滤）由上层
//! [`crate::module::netmon::context::normalize_dns_suffix`] 完成，本模块只做
//! 最小入口过滤：空字符串丢弃（对应 SCDynamicStore 某些版本的占位条目），其
//! 余 trim / 规范化 / 非法字符等交给 normalize 步骤统一处理。
//!
//! **失败语义**：任一步失败（key 不存在 / 类型不匹配 / 结构非预期）→ 返回空
//! Vec，符合 "采集失败 → dns_suffix=[] 不阻塞 PUT" 契约。
//!
//! **类型安全**：CFDictionary 的字段用 `CFType::downcast::<T>()` 做运行时类型
//! 校验，而不是直接裸 cast `*ptr as CFArrayRef` —— 后者在异常类型下会触发
//! wrong-type method dispatch（虽然 OCObjC 会 raise exception 但仍是 FFI 风险）。
//! CFArray 元素同样 per-item downcast 而非 `CFArray<CFString>` 直接 cast。

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType as _, ToVoid as _};
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use system_configuration::dynamic_store::SCDynamicStoreBuilder;

pub fn collect_dns_suffix() -> Vec<String> {
    let Some(store) = SCDynamicStoreBuilder::new("clash-verge-netmon-dns").build() else {
        return Vec::new();
    };

    let Some(value) = store.get(CFString::new("State:/Network/Global/DNS")) else {
        return Vec::new();
    };
    let Some(dict) = value.downcast::<CFDictionary>() else {
        return Vec::new();
    };

    let key = CFString::new("SearchDomains");
    let Some(array_ptr) = dict.find(key.to_void()) else {
        return Vec::new();
    };
    let raw = *array_ptr as CFTypeRef;
    if raw.is_null() {
        return Vec::new();
    }
    // SAFETY: dict.find 返回 borrowed ref；wrap_under_get_rule 按 Get Rule 语义
    // retain 一次、CFType drop 释放，引用计数配平
    let ty = unsafe { CFType::wrap_under_get_rule(raw) };
    let Some(array) = ty.downcast::<CFArray>() else {
        return Vec::new();
    };

    (0..array.len())
        .filter_map(|i| {
            let item = array.get(i)?;
            let raw_item = *item as CFTypeRef;
            if raw_item.is_null() {
                return None;
            }
            // SAFETY: 同上，对元素逐个 wrap + downcast 而不是 CFArray<CFString>
            // 直接转型，避免元素类型异常时的 FFI 风险
            let ty = unsafe { CFType::wrap_under_get_rule(raw_item) };
            let s = ty.downcast::<CFString>()?.to_string();
            if s.is_empty() { None } else { Some(s) }
        })
        .collect()
}
