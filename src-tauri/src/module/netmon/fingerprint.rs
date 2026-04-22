//! NetworkContext 指纹，与 mihomo `component/networkpolicy.NetworkContext.Fingerprint()`
//! byte-for-byte 对齐。
//!
//! **Why:** 指纹用于 Rust 侧本地跳过"与上次等价"的 PUT，避免在事件抖动期间
//! 发起重复网络请求（内核侧也有幂等，但能不发就不发）。
//!
//! **关键不变量（any cross-impl 必须遵守）**：
//! - key 前缀 `iface.<idx>.<field>`，`<idx>` 从 0 起、不补零
//! - `version` 字段硬编码字面量 `"1"`，**不是** `ctx.version.to_string()`——即使
//!   未来 version 字段演进或 ctx 被中途污染，两端 fingerprint 必须 byte-stable。
//!   参考 mihomo `component/networkpolicy/context.go:422` 的同类注释
//! - `metered` 三态编码：`None → "null"` / `Some(true) → "true"` / `Some(false) → "false"`
//! - 调用方（context.rs::build_context）保证 `ctx.interfaces` 已按 name 升序 + 每张
//!   iface 的 `subnets` 已按字符串序 sort+dedup；fingerprint.rs 不再重排
//!
//! **fixture bootstrap**：首版 fixture 应由 mihomo 侧 `TestFingerprint_ParityDump`
//! 产出后拷贝到 `src-tauri/tests/fixtures/fingerprint_fixtures.json`，两侧常量
//! `FIXTURE_SHA256` 同步校验。当前暂放 placeholder fixture（`expected_hex_v1`
//! 留空），待 mihomo 侧 dump test 合入后回填。

use tauri_plugin_mihomo::models::NetworkContext;

const FNV_OFFSET_64: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME_64: u64 = 0x0000_0100_0000_01b3;

struct Fnv64a(u64);

impl Fnv64a {
    const fn new() -> Self {
        Self(FNV_OFFSET_64)
    }

    fn update(&mut self, data: &[u8]) {
        for &byte in data {
            self.0 ^= u64::from(byte);
            self.0 = self.0.wrapping_mul(FNV_PRIME_64);
        }
    }

    const fn finalize(self) -> u64 {
        self.0
    }
}

/// `write_kv` 格式：`name=<len>:<value>\n`。key 带 iface index 前缀（`iface.0.name` /
/// `iface.1.name` / ...）天然承担 boundary，不需单独 sep 记录。
fn write_kv(h: &mut Fnv64a, name: &str, value: &str) {
    h.update(name.as_bytes());
    h.update(b"=");
    h.update(value.len().to_string().as_bytes());
    h.update(b":");
    h.update(value.as_bytes());
    h.update(b"\n");
}

const fn metered_str(m: Option<bool>) -> &'static str {
    match m {
        None => "null",
        Some(true) => "true",
        Some(false) => "false",
    }
}

/// 计算 16 字符小写十六进制指纹。
///
/// 调用方（context.rs::build_context）必须保证：
/// - `ctx.interfaces` 按 `name` 升序（fingerprint 不再排序）
/// - 每张 iface 的 `subnets` 已 sort + dedup
/// - `ctx.dns_suffix` 已 lowercase + dedup + sort
pub fn compute(ctx: &NetworkContext) -> String {
    let mut h = Fnv64a::new();

    for (idx, iface) in ctx.interfaces.iter().enumerate() {
        write_kv(&mut h, &format!("iface.{}.name", idx), &iface.name);
        write_kv(
            &mut h,
            &format!("iface.{}.iface_type", idx),
            iface.iface_type.as_deref().unwrap_or(""),
        );
        write_kv(
            &mut h,
            &format!("iface.{}.ssid", idx),
            iface.ssid.as_deref().unwrap_or(""),
        );
        write_kv(
            &mut h,
            &format!("iface.{}.bssid", idx),
            iface.bssid.as_deref().unwrap_or(""),
        );
        write_kv(
            &mut h,
            &format!("iface.{}.gateway_ip", idx),
            iface.gateway_ip.as_deref().unwrap_or(""),
        );
        write_kv(
            &mut h,
            &format!("iface.{}.gateway_mac", idx),
            iface.gateway_mac.as_deref().unwrap_or(""),
        );
        let subnets = iface.subnets.as_ref().map(|v| v.join(",")).unwrap_or_default();
        write_kv(&mut h, &format!("iface.{}.subnets", idx), &subnets);
        write_kv(&mut h, &format!("iface.{}.metered", idx), metered_str(iface.metered));
    }

    let dns = ctx.dns_suffix.as_ref().map(|v| v.join(",")).unwrap_or_default();
    write_kv(&mut h, "dns_suffix", &dns);
    // **MUST** hardcoded literal "1"，对齐 mihomo context.go:422
    write_kv(&mut h, "version", "1");

    format!("{:016x}", h.finalize())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use tauri_plugin_mihomo::models::InterfaceContext;

    fn empty_ctx() -> NetworkContext {
        NetworkContext {
            version: 1,
            interfaces: Vec::new(),
            dns_suffix: None,
            ttl: None,
        }
    }

    fn iface(name: &str) -> InterfaceContext {
        InterfaceContext {
            name: name.to_string(),
            iface_type: None,
            ssid: None,
            bssid: None,
            gateway_ip: None,
            gateway_mac: None,
            subnets: None,
            metered: None,
        }
    }

    #[test]
    fn empty_ctx_has_deterministic_hash() {
        let a = compute(&empty_ctx());
        let b = compute(&empty_ctx());
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn ttl_does_not_affect_fingerprint() {
        let mut a = empty_ctx();
        a.interfaces.push(iface("en0"));
        let mut b = a.clone();
        b.ttl = Some(1800);
        assert_eq!(compute(&a), compute(&b));
    }

    #[test]
    fn version_hardcoded_not_dynamic() {
        // 即便调用方把 version 污染成 999，fingerprint 写的仍是 "1"
        let mut a = empty_ctx();
        a.version = 1;
        let fp_v1 = compute(&a);
        a.version = 999;
        let fp_vdirty = compute(&a);
        assert_eq!(
            fp_v1, fp_vdirty,
            "fingerprint must be byte-stable regardless of ctx.version"
        );
    }

    #[test]
    fn metered_tristate_produces_distinct_hashes() {
        let base_iface = InterfaceContext {
            name: "en0".into(),
            iface_type: Some("wifi".into()),
            ..iface("en0")
        };
        let mut ctx_null = empty_ctx();
        ctx_null.interfaces.push(base_iface.clone());
        let mut ctx_true = empty_ctx();
        ctx_true.interfaces.push(InterfaceContext {
            metered: Some(true),
            ..base_iface.clone()
        });
        let mut ctx_false = empty_ctx();
        ctx_false.interfaces.push(InterfaceContext {
            metered: Some(false),
            ..base_iface
        });
        let a = compute(&ctx_null);
        let b = compute(&ctx_true);
        let c = compute(&ctx_false);
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_ne!(b, c);
    }

    #[test]
    fn multi_iface_index_prefix_makes_order_significant() {
        // fingerprint 不再排序（由 context.rs 保证），因此传入顺序不同 → hash 不同
        let mut ctx_ab = empty_ctx();
        ctx_ab.interfaces.push(iface("en0"));
        ctx_ab.interfaces.push(iface("en1"));
        let mut ctx_ba = empty_ctx();
        ctx_ba.interfaces.push(iface("en1"));
        ctx_ba.interfaces.push(iface("en0"));
        assert_ne!(compute(&ctx_ab), compute(&ctx_ba));
    }

    #[test]
    fn dns_suffix_empty_and_none_hash_identical() {
        let mut a = empty_ctx();
        a.dns_suffix = None;
        let mut b = empty_ctx();
        b.dns_suffix = Some(Vec::new());
        assert_eq!(compute(&a), compute(&b));
    }

    // ---- parity fixture 消费位点（当前为 stub）----
    //
    // 当 `fingerprint_fixtures.json` 的 `expected_hex_v1` 填充完毕（由 mihomo 侧
    // `TestFingerprint_ParityDump` 产出）后，此处应消费 fixture 做双端 byte-parity
    // 对拍。当前先保证 include_str! 路径正确 + 简单形状校验。
    #[test]
    fn fixture_file_loads_and_has_expected_shape() {
        let raw: &str = include_str!("../../../tests/fixtures/fingerprint_fixtures.json");
        // 基本 smoke：JSON 可解析 + 顶层是数组 + 至少一条用例
        let v: serde_json::Value = serde_json::from_str(raw).expect("fixture is valid JSON");
        let arr = v.as_array().expect("fixture is a JSON array");
        assert!(!arr.is_empty(), "fixture must have at least one case");
        for (i, case) in arr.iter().enumerate() {
            assert!(case.get("name").is_some(), "case #{i} missing `name`");
            assert!(case.get("context").is_some(), "case #{i} missing `context`");
            assert!(
                case.get("expected_hex_v1").is_some(),
                "case #{i} missing `expected_hex_v1`"
            );
        }
    }
}
