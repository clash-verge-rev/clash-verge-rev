//! Resolving the Mixed Port.
//!
//! Two different questions were being asked with one answer:
//!
//! - *What have we configured?* — the user's selection, else the Merge Config. Everything that
//!   writes configuration or decides what to start needs this, and it has to be answerable
//!   before the Core exists.
//! - *What is the Core actually serving on?* — what the Core reports, else what we configured.
//!   Anything that points a client at the proxy wants this, because the two can differ: a
//!   startup fallback moves the port, and a hand-edited Core config can move it too.
//!
//! Before, six call sites hand-copied the first chain (one of them skipping the Merge Config
//! entirely) and the frontend hand-copied a version of the second.

use anyhow::Result;

use super::Config;
use crate::core::handle::Handle;

/// The port mihomo listens on when nothing else is configured.
pub const DEFAULT_MIXED_PORT: u16 = 7897;

/// Resolving the Mixed Port.
pub struct MixedPort;

impl MixedPort {
    /// The Mixed Port the app has configured.
    ///
    /// Reads the draft layer, so an edit in progress is visible to the code applying it. Safe
    /// to call before the Core is running, unlike [`Self::effective`].
    pub async fn desired() -> u16 {
        let selected = Config::verge().await.latest_arc().verge_mixed_port;
        // `get_mixed_port` already falls back to the default when the Merge Config is silent.
        let merged = Config::clash().await.latest_arc().get_mixed_port();
        resolve_desired(selected, merged)
    }

    /// The Mixed Port the Core is actually serving on.
    ///
    /// Costs one round-trip to the Core, so it belongs on paths a user triggers rather than on
    /// paths served per request. Falls back to [`Self::desired`] when the Core cannot be asked,
    /// which is the right answer whenever the Core is not running anyway.
    pub async fn effective() -> u16 {
        let desired = Self::desired().await;
        resolve_effective(
            || async { Ok(Handle::mihomo().await.get_base_config().await?.mixed_port) },
            desired,
        )
        .await
    }
}

/// Prefer what the user selected, else what the Merge Config resolved to.
const fn resolve_desired(selected: Option<u16>, merged: u16) -> u16 {
    match selected {
        Some(port) => port,
        None => merged,
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
        assert_eq!(resolve_desired(Some(9000), 7897), 9000);
    }

    #[test]
    fn the_merge_config_answers_when_nothing_is_selected() {
        assert_eq!(resolve_desired(None, 8080), 8080);
    }

    #[tokio::test]
    async fn a_reporting_core_overrides_what_we_configured() {
        // This is the startup-fallback case: we asked for 7897 and the Core landed on 7898.
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
