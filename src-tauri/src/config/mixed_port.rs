//! Resolving the Mixed Port.
//!
//! Two questions, deliberately kept apart because the answers can differ:
//! [`MixedPort::desired`] — what we configured, answerable before the Core exists;
//! [`MixedPort::effective`] — what the Core reports it is serving on.

use std::sync::atomic::{AtomicU16, Ordering};

use anyhow::Result;

use super::Config;
use crate::core::handle::Handle;

/// The port mihomo listens on when nothing else is configured.
pub const DEFAULT_MIXED_PORT: u16 = 7897;

/// The port a startup fallback moved this session to, or 0 for none.
///
/// Never persisted: the user's port stays in `verge.yaml` and `config.yaml` so the next launch
/// asks for it again. Persisting it instead made a once-blocked port climb on every launch.
static SESSION_FALLBACK: AtomicU16 = AtomicU16::new(0);

/// Resolving the Mixed Port.
pub struct MixedPort;

impl MixedPort {
    /// Read by [`Self::desired`] and by runtime config generation — the two places that decide
    /// what the Core is asked to listen on.
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

    /// The Mixed Port the app has configured. Safe before the Core exists.
    ///
    /// Reads the draft layer, so this can name a port the Core has not moved to yet — which
    /// matters because the PAC endpoint hands it outside the app. Safe only because
    /// `feat::listener::save_proxy_ports` closes PAC across the staging (`core_starting` /
    /// `core_start_settled`); any other path staging a listener port must do the same.
    pub async fn desired() -> u16 {
        let selected = Config::verge().await.latest_arc().verge_mixed_port;
        // `get_mixed_port` already falls back to the default when the Merge Config is silent.
        let merged = Config::clash().await.latest_arc().get_mixed_port();
        resolve_desired(Self::session_fallback(), selected, merged)
    }

    /// The Mixed Port the Core is actually serving on.
    ///
    /// Costs a round-trip, so use it on user-triggered paths, not per-request ones.
    pub async fn effective() -> u16 {
        let desired = Self::desired().await;
        resolve_effective(
            || async { Ok(Handle::mihomo().get_base_config().await?.mixed_port) },
            desired,
        )
        .await
    }
}

/// Fallback first — it is the only value not written down, so the files still name the port the
/// user asked for while this session serves another.
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
