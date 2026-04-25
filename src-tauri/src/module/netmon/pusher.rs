//! 对接 `tauri-plugin-mihomo` 的 REST 客户端，实际发起 PUT / DELETE 请求。
//!
//! 用 trait 抽象方便单测注入 mock。
//!
//! **已知限制**：plugin `Error::FailedResponse(String)` 只保留 message，REST body 的
//! `code` 字段在 plugin 层就被丢弃，CVR 侧只能按粗粒度 `Error` variant 做四分类
//! （见 [`PutErrorKind`]）。结构化 code 需要 plugin 侧先扩展 `Error::FailedResponse
//! { status, code, message }`——跨项目 backlog。

use anyhow::{Context as _, Result};
use async_trait::async_trait;
use tauri_plugin_mihomo::models::{NetworkContext, NetworkStatus, PutResponse};

use crate::core::handle::Handle;

#[async_trait]
pub trait ContextPusher: Send + Sync {
    async fn put(&self, ctx: &NetworkContext) -> Result<PutResponse>;
    async fn delete(&self) -> Result<()>;
    /// 查询 mihomo 当前 `/network/context`；用于 `stop_with_delete` 的 content-match
    /// 校验。
    async fn get_status(&self) -> Result<NetworkStatus>;
}

/// PUT / DELETE 失败的粗粒度分类，决定 log 级别 / 是否重试。
///
/// [`Connect`] / [`Timeout`] 判定依赖 `reqwest::Error::is_connect()` /
/// `is_timeout()`；若 plugin 未来换 HTTP client（非 reqwest），这两个 variant
/// 的识别会静默回退到 [`Other`]，维护者需同步更新 `classify_plugin_error`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PutErrorKind {
    /// 连接拒绝：mihomo 进程未启动 / external-controller 未监听该端口
    Connect,
    /// 请求超时
    Timeout,
    /// mihomo 返回非 2xx 响应（400 / 500 / 503 等均落这里）
    FailedResponse,
    /// 其他（JSON 解析失败 / IO / TLS / ...）
    Other,
}

/// 分类 [`ContextPusher`] 返回的错误。anyhow::Error 可能被 `.context(...)` 包过
/// 一两层，需要沿 `chain()` 查找底层的 plugin `Error` variant；同时识别 CVR 侧
/// `service.rs::put_once_with_timeout` 产生的 `io::ErrorKind::TimedOut`
/// （本地 tokio timeout）。
pub fn classify_put_error(err: &anyhow::Error) -> PutErrorKind {
    for cause in err.chain() {
        if let Some(plugin_err) = cause.downcast_ref::<tauri_plugin_mihomo::Error>() {
            return classify_plugin_error(plugin_err);
        }
        if let Some(io_err) = cause.downcast_ref::<std::io::Error>()
            && io_err.kind() == std::io::ErrorKind::TimedOut
        {
            return PutErrorKind::Timeout;
        }
    }
    PutErrorKind::Other
}

fn classify_plugin_error(e: &tauri_plugin_mihomo::Error) -> PutErrorKind {
    match e {
        tauri_plugin_mihomo::Error::Reqwest(re) => {
            if re.is_connect() {
                PutErrorKind::Connect
            } else if re.is_timeout() {
                PutErrorKind::Timeout
            } else {
                PutErrorKind::Other
            }
        }
        tauri_plugin_mihomo::Error::FailedResponse(_) => PutErrorKind::FailedResponse,
        _ => PutErrorKind::Other,
    }
}

pub struct MihomoPusher;

#[async_trait]
impl ContextPusher for MihomoPusher {
    async fn put(&self, ctx: &NetworkContext) -> Result<PutResponse> {
        Handle::mihomo()
            .await
            .put_network_context(ctx)
            .await
            .context("put network context")
    }

    async fn delete(&self) -> Result<()> {
        Handle::mihomo()
            .await
            .delete_network_context()
            .await
            .context("delete network context")
    }

    async fn get_status(&self) -> Result<NetworkStatus> {
        Handle::mihomo()
            .await
            .get_network_context()
            .await
            .context("get network context")
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn classify_failed_response_variant() {
        let e: anyhow::Error = tauri_plugin_mihomo::Error::FailedResponse("400".into()).into();
        assert_eq!(classify_put_error(&e), PutErrorKind::FailedResponse);
    }

    #[test]
    fn classify_wrapped_failed_response() {
        // 模拟 pusher 用 .context("put network context") 包了一层 anyhow
        let inner: anyhow::Error = tauri_plugin_mihomo::Error::FailedResponse("503".into()).into();
        let wrapped = inner.context("put network context");
        assert_eq!(classify_put_error(&wrapped), PutErrorKind::FailedResponse);
    }

    #[test]
    fn classify_unknown_error_falls_back_to_other() {
        let e: anyhow::Error = anyhow::anyhow!("some unrelated error");
        assert_eq!(classify_put_error(&e), PutErrorKind::Other);
    }

    #[test]
    fn classify_local_io_timed_out_is_timeout_kind() {
        // 覆盖 service.rs::put_once_with_timeout 在 tokio::time::timeout 触发后
        // 构造的 io::ErrorKind::TimedOut，它需要与 plugin 内 reqwest timeout 同
        // 归为 PutErrorKind::Timeout，日志才能准确打成 "timed out" 而非 "failed"。
        let io_err = std::io::Error::new(std::io::ErrorKind::TimedOut, "netmon put timed out");
        let e: anyhow::Error = anyhow::Error::from(io_err);
        assert_eq!(classify_put_error(&e), PutErrorKind::Timeout);
    }

    #[test]
    fn classify_local_io_non_timeout_falls_back_to_other() {
        // io::Error 但 kind 不是 TimedOut：不应误分类为 Timeout
        let io_err = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "connection refused");
        let e: anyhow::Error = anyhow::Error::from(io_err);
        assert_eq!(classify_put_error(&e), PutErrorKind::Other);
    }
}
