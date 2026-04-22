//! Linux PlatformMonitor：订阅 rtnetlink 多播组，事件到达即触发 `TriggerReason::NetworkEvent`。
//!
//! 订阅 socket 失效（kernel 关了 netlink socket、进程信号等）时 stream 会 EOF；
//! 此时重连 + 指数退避，重连前发一次 NetworkEvent 让 Sampler 做全量重采，
//! 补回中间丢失的事件。注：ENOBUFS 本身被 `netlink-proto` 转换为 NLMSG_OVERRUN
//! 消息推入事件流（不会让 stream 结束），我们把它当普通事件消费，自然触发 resync。
//!
//! **已知 gap（DNS-only 变更）**：Linux 没有 netlink-equivalent 的 DNS 变化通知
//! 通道。大多数 DNS 变更会伴随 link / addr / route 事件（DHCP renew 触发
//! IPv4_ROUTE、VPN connect 触发 LINK），能被现有订阅 cover；但纯手动
//! `echo search example.com >> /etc/resolv.conf` 或 `resolvconf -u` 等配置变更
//! 不会有任何 netlink 事件，`dns_suffix` 的变化只能等下一次因其他原因触发的
//! re-sample 时补上。若未来需要覆盖此 gap 可加 inotify `/etc/resolv.conf` 或
//! systemd-resolved D-Bus `PropertiesChanged` 订阅；当前刻意避开 D-Bus 依赖。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context as _, Result};
use async_trait::async_trait;
use clash_verge_logging::{Type, logging};
use futures::StreamExt as _;
use parking_lot::Mutex;
use rtnetlink::constants::{RTMGRP_IPV4_IFADDR, RTMGRP_IPV4_ROUTE, RTMGRP_IPV6_IFADDR, RTMGRP_IPV6_ROUTE, RTMGRP_LINK};
use rtnetlink::new_connection;
use rtnetlink::sys::{AsyncSocket as _, SocketAddr};
use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc;

use crate::module::netmon::TriggerReason;
use crate::module::netmon::platform::PlatformMonitor;
use crate::process::AsyncHandler;

/// 指数退避序列（秒）：1, 2, 5, 10, 30，之后固定 30。
const BACKOFF_SECONDS: &[u64] = &[1, 2, 5, 10, 30];

pub struct LinuxMonitor {
    stopping: Arc<AtomicBool>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl LinuxMonitor {
    pub fn new() -> Self {
        Self {
            stopping: Arc::new(AtomicBool::new(false)),
            task: Mutex::new(None),
        }
    }
}

#[async_trait]
impl PlatformMonitor for LinuxMonitor {
    async fn start(&self, tx: mpsc::UnboundedSender<TriggerReason>) -> Result<()> {
        let stopping = Arc::clone(&self.stopping);
        let handle = AsyncHandler::spawn(move || async move {
            run_with_backoff(tx, stopping).await;
        });
        *self.task.lock() = Some(handle);
        Ok(())
    }

    async fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        // 临时变量提取避免 MutexGuard 活到 if let 结束（clippy::significant_drop_in_scrutinee）
        let handle = self.task.lock().take();
        if let Some(handle) = handle {
            handle.abort();
        }
    }
}

async fn run_with_backoff(tx: mpsc::UnboundedSender<TriggerReason>, stopping: Arc<AtomicBool>) {
    let mut consecutive_failures: usize = 0;

    while !stopping.load(Ordering::Acquire) {
        match listen_once(&tx, &stopping).await {
            ListenOutcome::Stopped => break,
            ListenOutcome::ReceiverDropped => break,
            ListenOutcome::Eof { received_any } => {
                // 本轮曾经收到过事件 = 订阅工作正常，只是 socket 被对端关了。
                // 触发一次 resync 让 Sampler 补采，并把失败计数重置。
                // 注：ENOBUFS 不会让 stream EOF，它由 netlink-proto 转成
                // NLMSG_OVERRUN 消息透传（见本文件 module doc）。
                let delay = if received_any {
                    let _ = tx.send(TriggerReason::NetworkEvent);
                    consecutive_failures = 0;
                    Duration::from_secs(BACKOFF_SECONDS[0])
                } else {
                    let d = backoff_delay(consecutive_failures);
                    consecutive_failures = consecutive_failures.saturating_add(1);
                    d
                };
                logging!(
                    warn,
                    Type::Network,
                    "netmon linux netlink stream ended unexpectedly (received_any={}), reconnect in {:?}",
                    received_any,
                    delay
                );
                tokio::time::sleep(delay).await;
            }
            ListenOutcome::Error(e) => {
                let delay = backoff_delay(consecutive_failures);
                logging!(
                    warn,
                    Type::Network,
                    "netmon linux netlink listen error: {:?}, reconnect in {:?}",
                    e,
                    delay
                );
                tokio::time::sleep(delay).await;
                consecutive_failures = consecutive_failures.saturating_add(1);
            }
        }
    }
}

fn backoff_delay(attempt: usize) -> Duration {
    let idx = attempt.min(BACKOFF_SECONDS.len() - 1);
    Duration::from_secs(BACKOFF_SECONDS[idx])
}

enum ListenOutcome {
    /// stop_with_delete 被调用
    Stopped,
    /// service loop 已退出（tx receiver 丢失）
    ReceiverDropped,
    /// stream 意外关闭；`received_any` 表示本轮期间是否收到过至少一条消息
    Eof { received_any: bool },
    /// 建连 / bind 失败
    Error(anyhow::Error),
}

async fn listen_once(tx: &mpsc::UnboundedSender<TriggerReason>, stopping: &AtomicBool) -> ListenOutcome {
    let (mut connection, _handle, mut messages) = match new_connection() {
        Ok(v) => v,
        Err(e) => return ListenOutcome::Error(anyhow::anyhow!("new_connection: {e}")),
    };

    let groups = RTMGRP_LINK | RTMGRP_IPV4_IFADDR | RTMGRP_IPV4_ROUTE | RTMGRP_IPV6_IFADDR | RTMGRP_IPV6_ROUTE;
    if let Err(e) = connection
        .socket_mut()
        .socket_mut()
        .bind(&SocketAddr::new(0, groups))
        .context("bind netlink multicast groups")
    {
        return ListenOutcome::Error(e);
    }

    let conn_task = AsyncHandler::spawn(move || async move {
        connection.await;
    });

    let mut received_any = false;
    while let Some((_msg, _addr)) = messages.next().await {
        if stopping.load(Ordering::Acquire) {
            conn_task.abort();
            return ListenOutcome::Stopped;
        }
        received_any = true;
        if tx.send(TriggerReason::NetworkEvent).is_err() {
            conn_task.abort();
            return ListenOutcome::ReceiverDropped;
        }
    }

    conn_task.abort();
    if stopping.load(Ordering::Acquire) {
        ListenOutcome::Stopped
    } else {
        ListenOutcome::Eof { received_any }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn backoff_sequence_monotone_and_capped() {
        let seq: Vec<_> = (0..10).map(backoff_delay).collect();
        // 前 5 次按序列严格递增
        assert_eq!(seq[0], Duration::from_secs(1));
        assert_eq!(seq[1], Duration::from_secs(2));
        assert_eq!(seq[2], Duration::from_secs(5));
        assert_eq!(seq[3], Duration::from_secs(10));
        assert_eq!(seq[4], Duration::from_secs(30));
        // 之后固定 30 秒
        for d in &seq[5..] {
            assert_eq!(*d, Duration::from_secs(30));
        }
    }
}
