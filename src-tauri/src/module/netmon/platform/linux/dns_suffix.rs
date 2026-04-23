//! Linux DNS search-list 采集。
//!
//! 优先 `resolvectl domain`（systemd-resolved 当前生效 search list）；**仅在
//! `resolvectl` 调用失败时** fallback 到 `/etc/resolv.conf` 的 `search` 行。
//! resolvectl `exit=0` 即使输出解析为空也视为 authoritative（"这台机器真没有
//! search domain"），不 fallback——详情见 `collect_dns_suffix` 内注释。
//!
//! **为什么 exec `resolvectl domain` 而不是 DBus**：引入 `zbus` / `dbus` crate
//! 会把依赖体积抬高 ~2MB；exec 一次子进程（典型输出 <1KB）对采样频率（3s
//! debounce）的开销可接受。失败路径（systemd-resolved 未运行 / 无 resolvectl
//! 二进制）会 fallback 到 `/etc/resolv.conf`。
//!
//! **`~` 前缀 routing-only domain 排除**：systemd-resolved 的 `resolvectl domain`
//! 输出中 `~example.com` 表示 **routing-only domain**（仅用于 DNS 路由决策，不是
//! search list）。sampler 必须排除 `~` 前缀条目，只上报纯 search domain。
//!
//! **合并语义**：多 iface 场景 sampler 上报系统实际生效的 search list 的 union；
//! 归一化（lowercase / dedup / sort / 非法字符过滤）由上
//! 层 [`crate::module::netmon::context::normalize_dns_suffix`] 完成。本模块只做
//! 最小入口过滤（空串 / `~` 前缀）。
//!
//! **失败语义**：任一路径失败 → 返回空 Vec，符合 "采集失败 → dns_suffix=[]
//! 不阻塞 PUT" 契约。
//!
//! **阻塞语义**：`collect_dns_suffix` 是 sync 函数，内部调用 resolvectl
//! subprocess + 读 `/etc/resolv.conf` 都是阻塞 I/O；**调用方必须用
//! `tokio::task::spawn_blocking` 包裹**（见 `sampler.rs::collect_with_handle`）。
//!
//! **事件触发 gap**：纯手动 `/etc/resolv.conf` 修改不会触发 netlink 事件 →
//! `dns_suffix` 变化要等下一次 link / addr / route 事件触发的 re-sample 才补
//! 上；详情见 `monitor.rs` module doc 的 "已知 gap（DNS-only 变更）"段落。

use std::io::Read as _;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use clash_verge_logging::{Type, logging};

/// resolvectl 子进程的硬上界。正常 output < 1KB，上界取 3s 保守防 stuck。
/// 超时后会真·kill 子进程（而不仅事后打 log），避免 systemd-resolved 假死
/// 拖住 sampler 的 spawn_blocking 线程。
const RESOLVECTL_TIMEOUT_MS: u64 = 3000;

/// 子进程 try_wait 轮询间隔。50ms 粒度够细（resolvectl 正常 <50ms 完成），
/// 又不至于把 CPU 吃到空转。
const RESOLVECTL_POLL_INTERVAL_MS: u64 = 50;

pub fn collect_dns_suffix() -> Vec<String> {
    // 首选：systemd-resolved。resolvectl exit=0 即视为权威（包括空输出）→
    // 短路返回，不 fallback /etc/resolv.conf。取舍：避免读到第三方工具写过
    // 但与 resolved 不一致的旧 search list；反例是 "systemd-resolved 跑着 +
    // resolvconf overlay /etc/resolv.conf" 的混合 stack（部分 Debian/Ubuntu
    // LTS + 手动装 openresolv），这时 resolvectl 可能报空而 /etc/resolv.conf
    // 有 search，我们会上报空。这类混合配置下 resolved 本身也无法保持
    // /etc/resolv.conf 与实际 resolved 一致，我们选 resolved 侧作单一事实源。
    if let Some(out) = run_resolvectl_domain() {
        return parse_resolvectl_output(&out);
    }
    // Fallback：/etc/resolv.conf 的 search 行
    match std::fs::read_to_string("/etc/resolv.conf") {
        Ok(text) => parse_resolv_conf_search(&text),
        Err(e) => {
            logging!(
                debug,
                Type::Network,
                "netmon linux dns_suffix: resolv.conf fallback failed: {:?}",
                e
            );
            Vec::new()
        }
    }
}

/// Spawn resolvectl 子进程、以 `RESOLVECTL_TIMEOUT_MS` 为硬上界等待 → 读
/// stdout。超时后显式 `kill()` 子进程，避免 systemd-resolved 假死导致主线程
/// （sampler 的 spawn_blocking worker）永久阻塞。
///
/// **并发 drain 模型**：spawn 独立 reader 线程持续读 stdout 到 String，主线程
/// `try_wait` + 超时。如果 "先 wait 再读 stdout"，子进程输出超过 Linux 管道
/// 缓冲（默认 64KB）时会阻塞在 write，`try_wait` 永远 Ok(None)，直到被超时
/// kill——一个本来健康的 `resolvectl status` 级别大输出命令会被误判为超时。
/// 当前 `resolvectl domain` 输出通常 <1KB，但未来若改为更冗长的命令，drain
/// 线程会自然保证正确性。
///
/// 返回 `Some(stdout)` 表示子进程成功退出；`None` 表示 spawn 失败 / 非零退出
/// / 超时。
#[expect(
    clippy::expect_used,
    reason = "stdout is always Some after Stdio::piped() + spawn success; panic on violation is better than silent None"
)]
fn run_resolvectl_domain() -> Option<String> {
    let timeout = Duration::from_millis(RESOLVECTL_TIMEOUT_MS);
    let poll = Duration::from_millis(RESOLVECTL_POLL_INTERVAL_MS);
    let start = Instant::now();

    let mut child = Command::new("resolvectl")
        .arg("domain")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // spawn reader 线程 drain stdout —— 避免大输出卡 pipe
    // `take()` 在 `Stdio::piped()` + spawn 成功后**必定** Some；invariant 用
    // `expect` 显式化，违反该不变式意味着代码重构 bug，panic 比悄悄返回更快暴露
    let stdout = child
        .stdout
        .take()
        .expect("stdout configured as piped and not taken elsewhere");
    let reader_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        let mut s = stdout;
        let _ = s.read_to_string(&mut buf);
        buf
    });

    let exit_ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break status.success();
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    logging!(
                        warn,
                        Type::Network,
                        "netmon linux dns_suffix: resolvectl domain exceeded {}ms, killing",
                        RESOLVECTL_TIMEOUT_MS
                    );
                    let _ = child.kill();
                    let _ = child.wait(); // 回收僵尸
                    // reader 线程在 EOF（pipe close by kill）时会退出；join 丢弃 buf
                    let _ = reader_handle.join();
                    return None;
                }
                std::thread::sleep(poll);
            }
            Err(e) => {
                logging!(
                    debug,
                    Type::Network,
                    "netmon linux dns_suffix: try_wait failed: {:?}",
                    e
                );
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader_handle.join();
                return None;
            }
        }
    };

    // child 已退出 → pipe close → reader 线程会自然结束
    let buf = reader_handle.join().ok()?;
    if exit_ok { Some(buf) } else { None }
}

/// 解析 `resolvectl domain` 的 stdout。典型行形如：
///
/// ```text
/// Global: ~.
/// Link 3 (wlan0): corp.example.com home.lan
/// Link 2 (eth0):
/// ```
///
/// 格式：`<Prefix>:<空白分隔的 domain 列表>`。domain 前缀 `~` 为 routing-only
/// （排除）。仅上报纯 search domain，跨 link + global union。
pub fn parse_resolvectl_output(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        // 每行用冒号切 "前缀":"domains"
        let Some(idx) = line.find(':') else {
            continue;
        };
        let rest = &line[idx + 1..];
        for token in rest.split_whitespace() {
            if token.is_empty() || token == "." {
                // `.` 单独一条 domain 几乎无意义（Global: ~. 之类），跳过
                continue;
            }
            if token.starts_with('~') {
                // routing-only domain 不是 search list
                continue;
            }
            out.push(token.to_string());
        }
    }
    out
}

/// 解析 `/etc/resolv.conf` 的 `search` / `domain` 行（`domain` 是单 domain 的历史
/// fallback）。按 `man 5 resolv.conf` 的 last-wins 语义：多个 `search` 或 `search`
/// 与 `domain` 混用时只保留最后一条（与 glibc `__res_vinit` 一致）。
pub fn parse_resolv_conf_search(text: &str) -> Vec<String> {
    let mut last: Vec<String> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let mut iter = line.split_whitespace();
        let keyword = iter.next().unwrap_or("");
        if keyword == "search" || keyword == "domain" {
            last = iter.filter(|s| !s.is_empty()).map(str::to_string).collect();
        }
    }
    last
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_resolvectl_multi_link_union() {
        let text = "Global: ~.\n\
                    Link 3 (wlan0): corp.example.com home.lan\n\
                    Link 2 (eth0): other.lan\n";
        let out = parse_resolvectl_output(text);
        assert_eq!(out, vec!["corp.example.com", "home.lan", "other.lan"]);
    }

    #[test]
    fn parse_resolvectl_strips_tilde_routing_only() {
        // ~example.com 是 routing-only，必须排除；普通 domain 保留
        let text = "Link 3 (wlan0): ~corp.example.com home.lan\n";
        let out = parse_resolvectl_output(text);
        assert_eq!(out, vec!["home.lan"]);
    }

    #[test]
    fn parse_resolvectl_empty_link_line() {
        let text = "Link 2 (eth0):\n";
        assert!(parse_resolvectl_output(text).is_empty());
    }

    #[test]
    fn parse_resolvectl_dot_domain_ignored() {
        // 单独 `.` 没有 search 意义
        let text = "Global: .\n";
        assert!(parse_resolvectl_output(text).is_empty());
    }

    #[test]
    fn parse_resolv_conf_search_line() {
        let text = "# comment\n\
                    nameserver 8.8.8.8\n\
                    search corp.example.com home.lan\n";
        assert_eq!(parse_resolv_conf_search(text), vec!["corp.example.com", "home.lan"]);
    }

    #[test]
    fn parse_resolv_conf_domain_keyword() {
        // 历史上 `domain` 关键字等价单 domain 的 search
        let text = "domain example.com\n";
        assert_eq!(parse_resolv_conf_search(text), vec!["example.com"]);
    }

    #[test]
    fn parse_resolv_conf_no_search_or_domain() {
        let text = "nameserver 1.1.1.1\n";
        assert!(parse_resolv_conf_search(text).is_empty());
    }

    #[test]
    fn parse_resolv_conf_search_with_comment_and_blank() {
        let text = "\n# lead comment\n\nsearch foo.lan bar.lan\n";
        assert_eq!(parse_resolv_conf_search(text), vec!["foo.lan", "bar.lan"]);
    }

    #[test]
    fn parse_resolv_conf_multiple_search_last_wins() {
        // man 5 resolv.conf: "only the search list from the last instance is used"
        let text = "search first.lan\nsearch second.lan third.lan\n";
        assert_eq!(parse_resolv_conf_search(text), vec!["second.lan", "third.lan"]);
    }

    #[test]
    fn parse_resolv_conf_domain_then_search_last_wins() {
        // `domain` 和 `search` 互斥，"last instance wins"
        let text = "domain example.com\nsearch corp.example.com home.lan\n";
        assert_eq!(parse_resolv_conf_search(text), vec!["corp.example.com", "home.lan"]);
    }

    #[test]
    fn parse_resolv_conf_search_then_domain_last_wins() {
        // `search` 在前 `domain` 在后，取 `domain`
        let text = "search corp.example.com home.lan\ndomain example.com\n";
        assert_eq!(parse_resolv_conf_search(text), vec!["example.com"]);
    }
}
