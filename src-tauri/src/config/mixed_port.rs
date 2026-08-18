//! Resolves the configured [`MixedPort::desired`] separately from the Core's live
//! [`MixedPort::effective`] value.

use std::sync::atomic::{AtomicU16, Ordering};

use anyhow::Result;

use super::Config;
use crate::core::handle::Handle;

/// The port mihomo listens on when nothing else is configured.
pub const DEFAULT_MIXED_PORT: u16 = 7897;

/// A startup fallback for this session only; persistence would make the port climb across launches.
static SESSION_FALLBACK: AtomicU16 = AtomicU16::new(0);

pub struct MixedPort;

impl MixedPort {
    pub(crate) fn session_fallback() -> Option<u16> {
        match SESSION_FALLBACK.load(Ordering::Acquire) {
            0 => None,
            port => Some(port),
        }
    }

    pub(crate) fn set_session_fallback(port: u16) {
        SESSION_FALLBACK.store(port, Ordering::Release);
    }

    pub(crate) fn clear_session_fallback() {
        SESSION_FALLBACK.store(0, Ordering::Release);
    }

    /// Returns the configured port. Paths staging it must close PAC until the Core catches up.
    pub async fn desired() -> u16 {
        let selected = Config::verge().await.latest_arc().verge_mixed_port;
        // `get_mixed_port` already falls back to the default when the Merge Config is silent.
        let merged = Config::clash().await.latest_arc().get_mixed_port();
        resolve_desired(Self::session_fallback(), selected, merged)
    }

    /// Returns the Core's live port; reserve this round-trip for user-triggered paths.
    pub async fn effective() -> u16 {
        let desired = Self::desired().await;
        resolve_effective(
            || async { Ok(Handle::mihomo().get_base_config().await?.mixed_port) },
            desired,
        )
        .await
    }
}

/// The session-only fallback outranks persisted choices.
const fn resolve_desired(session_fallback: Option<u16>, selected: Option<u16>, merged: u16) -> u16 {
    match (session_fallback, selected) {
        (Some(port), _) | (None, Some(port)) => port,
        (None, None) => merged,
    }
}

/// Prefer what the Core reports; fall back to what we configured.
async fn resolve_effective<Live, LiveFuture>(live: Live, desired: u16) -> u16
where
    Live: FnOnce() -> LiveFuture,
    LiveFuture: Future<Output = Result<u16>>,
{
    match live().await {
        // A Core reporting port 0 is a Core that has not bound anything yet.
        Ok(port) if port != 0 => port,
        _ => desired,
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::*;

    #[test]
    fn a_selected_port_wins_over_the_merge_config() {
        assert_eq!(resolve_desired(None, Some(9000), 7897), 9000);
    }

    #[test]
    fn the_merge_config_answers_when_nothing_is_selected() {
        assert_eq!(resolve_desired(None, None, 8080), 8080);
    }

    #[test]
    fn a_session_fallback_outranks_the_port_still_written_down() {
        assert_eq!(resolve_desired(Some(7900), Some(7897), 7897), 7900);
    }

    #[tokio::test]
    async fn a_reporting_core_overrides_what_we_configured() {
        assert_eq!(resolve_effective(|| async { Ok(7898) }, 7897).await, 7898);
    }

    #[tokio::test]
    async fn an_unreachable_core_leaves_the_configured_port_standing() {
        assert_eq!(
            resolve_effective(|| async { anyhow::bail!("core is not running") }, 7897).await,
            7897
        );
    }

    #[tokio::test]
    async fn a_core_that_has_not_bound_yet_is_not_believed() {
        assert_eq!(resolve_effective(|| async { Ok(0) }, 7897).await, 7897);
    }
}
