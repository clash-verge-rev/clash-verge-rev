use crate::{config::Config, singleton, utils::server};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use scopeguard::defer;
use smartstring::alias::String;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use sysproxy::{Autoproxy, GuardMonitor, GuardType, Sysproxy};
use tokio::sync::Mutex as TokioMutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProxyApplyStep {
    Sysproxy,
    Autoproxy,
}

const fn proxy_apply_steps(sys_enabled: bool, auto_enabled: bool) -> [ProxyApplyStep; 2] {
    // Disabling PAC clears WinINET proxy flags on Windows, so pure global
    // proxy mode must clear PAC before enabling Sysproxy.
    if sys_enabled && !auto_enabled {
        [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
    } else {
        [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
    }
}

const fn proxy_cleanup_allowed(is_macos: bool, has_authority: bool) -> bool {
    !is_macos || has_authority
}

const fn proxy_guard_refresh_allowed(is_macos: bool, captured_state: u64, current_state: u64) -> bool {
    !is_macos || (captured_state == current_state && proxy_state_has_authority(current_state))
}

const PROXY_AUTHORITY_BIT: u64 = 1;
const PROXY_REVOKED_BIT: u64 = 1 << 1;
const PROXY_AUTHORITY_GENERATION_STEP: u64 = 1 << 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProxyAuthorityUpdate {
    Preserve,
    ClaimIfNotRevoked,
    ClaimAfterCoreReady,
}

const fn proxy_state_has_authority(state: u64) -> bool {
    state & PROXY_AUTHORITY_BIT != 0
}

const fn proxy_state_is_revoked(state: u64) -> bool {
    state & PROXY_REVOKED_BIT != 0
}

const fn revoked_proxy_state(state: u64) -> u64 {
    (state.wrapping_add(PROXY_AUTHORITY_GENERATION_STEP) & !(PROXY_AUTHORITY_BIT | PROXY_REVOKED_BIT))
        | PROXY_REVOKED_BIT
}

const fn proxy_state_after_core_ready_without_proxy(state: u64) -> u64 {
    state.wrapping_add(PROXY_AUTHORITY_GENERATION_STEP) & !(PROXY_AUTHORITY_BIT | PROXY_REVOKED_BIT)
}

fn try_take_proxy_cleanup_authority(state: &AtomicU64, is_macos: bool) -> bool {
    state
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            proxy_cleanup_allowed(is_macos, proxy_state_has_authority(current)).then(|| revoked_proxy_state(current))
        })
        .is_ok()
}

const fn proxy_mutation_allowed(is_macos: bool, state: u64, update: ProxyAuthorityUpdate) -> bool {
    !is_macos
        || match update {
            ProxyAuthorityUpdate::Preserve => proxy_state_has_authority(state),
            ProxyAuthorityUpdate::ClaimIfNotRevoked => !proxy_state_is_revoked(state),
            ProxyAuthorityUpdate::ClaimAfterCoreReady => true,
        }
}

const fn proxy_state_after_apply(state: u64, system_proxy_enabled: bool, update: ProxyAuthorityUpdate) -> u64 {
    if !system_proxy_enabled {
        state & !(PROXY_AUTHORITY_BIT | PROXY_REVOKED_BIT)
    } else if matches!(
        update,
        ProxyAuthorityUpdate::ClaimIfNotRevoked | ProxyAuthorityUpdate::ClaimAfterCoreReady
    ) {
        (state | PROXY_AUTHORITY_BIT) & !PROXY_REVOKED_BIT
    } else {
        state
    }
}

pub(crate) struct Sysopt {
    update_lock: TokioMutex<()>,
    guard_operation_lock: TokioMutex<()>,
    reset_sysproxy: AtomicBool,
    proxy_cleanup_state: AtomicU64,
    inner_proxy: Arc<RwLock<(Sysproxy, Autoproxy)>>,
    guard: Arc<RwLock<GuardMonitor>>,
}

impl Default for Sysopt {
    fn default() -> Self {
        Self {
            update_lock: TokioMutex::new(()),
            guard_operation_lock: TokioMutex::new(()),
            reset_sysproxy: AtomicBool::new(false),
            proxy_cleanup_state: AtomicU64::new(0),
            inner_proxy: Arc::new(RwLock::new((Sysproxy::default(), Autoproxy::default()))),
            guard: Arc::new(RwLock::new(GuardMonitor::new(GuardType::None, Duration::from_secs(30)))),
        }
    }
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

async fn get_bypass() -> String {
    let verge = Config::verge().await.latest_arc();
    let use_default = verge.use_default_bypass.unwrap_or(true);
    let custom_bypass = verge.system_proxy_bypass.as_deref().unwrap_or("");

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.into()
    } else if use_default {
        format!("{DEFAULT_BYPASS},{custom_bypass}").into()
    } else {
        custom_bypass.into()
    }
}

singleton!(Sysopt, SYSOPT);

impl Sysopt {
    fn new() -> Self {
        Self::default()
    }

    fn access_guard(&self) -> Arc<RwLock<GuardMonitor>> {
        Arc::clone(&self.guard)
    }

    async fn stop_proxy_guard_locked(&self) {
        loop {
            let state = self.access_guard().read().get_state();
            if state.is_pendding() {
                tokio::task::yield_now().await;
                continue;
            }
            self.access_guard().write().stop();
            return;
        }
    }

    pub(super) async fn stop_proxy_guard(&self) {
        let _operation = self.guard_operation_lock.lock().await;
        self.stop_proxy_guard_locked().await;
    }

    fn revoke_proxy_cleanup_authority(&self) {
        let _ = self
            .proxy_cleanup_state
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |state| {
                Some(revoked_proxy_state(state))
            });
    }

    pub(crate) async fn revoke_proxy_cleanup_authority_and_stop_guard(&self) {
        let _ = self.revoke_proxy_cleanup_authority_and_stop_guard_if(|| true).await;
    }

    pub(super) async fn revoke_proxy_cleanup_authority_and_stop_guard_if<F>(&self, claim_recovery: F) -> bool
    where
        F: FnOnce() -> bool,
    {
        let _operation = self.guard_operation_lock.lock().await;
        if !claim_recovery() {
            return false;
        }
        self.revoke_proxy_cleanup_authority();
        self.stop_proxy_guard_locked().await;
        true
    }

    fn proxy_cleanup_is_allowed(&self) -> bool {
        proxy_cleanup_allowed(
            cfg!(target_os = "macos"),
            proxy_state_has_authority(self.proxy_cleanup_state.load(Ordering::Acquire)),
        )
    }

    #[cfg(target_os = "macos")]
    pub(super) fn proxy_cleanup_is_revoked(&self) -> bool {
        proxy_state_is_revoked(self.proxy_cleanup_state.load(Ordering::Acquire))
    }

    pub(crate) async fn refresh_guard(&self) {
        logging!(info, Type::Core, "Refreshing system proxy guard...");
        let authority_snapshot = self.proxy_cleanup_state.load(Ordering::Acquire);
        if !proxy_guard_refresh_allowed(
            cfg!(target_os = "macos"),
            authority_snapshot,
            self.proxy_cleanup_state.load(Ordering::Acquire),
        ) {
            logging!(
                info,
                Type::Core,
                "Skipping proxy guard refresh without current macOS proxy authority"
            );
            self.stop_proxy_guard().await;
            return;
        }
        let verge = Config::verge().await.latest_arc();
        let _operation = self.guard_operation_lock.lock().await;
        let current_authority = self.proxy_cleanup_state.load(Ordering::Acquire);
        if !proxy_guard_refresh_allowed(cfg!(target_os = "macos"), authority_snapshot, current_authority) {
            if !proxy_cleanup_allowed(cfg!(target_os = "macos"), proxy_state_has_authority(current_authority)) {
                self.stop_proxy_guard_locked().await;
            }
            return;
        }
        if !verge.enable_system_proxy.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy is disabled.");
            self.stop_proxy_guard_locked().await;
            return;
        }
        if !verge.enable_proxy_guard.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy guard is disabled.");
            self.stop_proxy_guard_locked().await;
            return;
        }
        logging!(
            info,
            Type::Core,
            "Updating system proxy with duration: {} seconds",
            verge.proxy_guard_duration.unwrap_or(30)
        );
        {
            let guard = self.access_guard();
            guard
                .write()
                .set_interval(Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30)));
        }
        logging!(info, Type::Core, "Starting system proxy guard...");
        {
            let guard = self.access_guard();
            guard.write().start();
        }
        while self.access_guard().read().get_state().is_pendding() {
            tokio::task::yield_now().await;
        }
    }

    /// Wait for any in-progress `update_sysproxy` to finish, so that a
    /// subsequent read of OS-level sysproxy state sees a fully applied
    /// configuration instead of a partially-applied one (e.g. SOCKS already
    /// disabled but HTTP still enabled mid-transition).
    pub(crate) async fn wait_idle(&self) {
        let _ = self.update_lock.lock().await;
    }

    /// init the sysproxy
    pub(crate) async fn update_sysproxy(&self) -> Result<()> {
        self.update_sysproxy_inner(ProxyAuthorityUpdate::Preserve, || true)
            .await
            .map(|_| ())
    }

    pub(crate) async fn update_sysproxy_and_claim_if_not_revoked(&self) -> Result<()> {
        self.update_sysproxy_inner(ProxyAuthorityUpdate::ClaimIfNotRevoked, || true)
            .await
            .map(|_| ())
    }

    pub(super) async fn update_sysproxy_and_claim_cleanup_authority_if<F>(&self, claim_still_valid: F) -> Result<bool>
    where
        F: Fn() -> bool + Send + Sync,
    {
        self.update_sysproxy_inner(ProxyAuthorityUpdate::ClaimAfterCoreReady, claim_still_valid)
            .await
    }

    pub(super) async fn allow_future_proxy_claim_after_core_ready_if<F>(&self, claim_still_valid: F) -> bool
    where
        F: Fn() -> bool,
    {
        let _guard_operation = self.guard_operation_lock.lock().await;
        if !claim_still_valid() {
            return false;
        }
        let state = self.proxy_cleanup_state.load(Ordering::Acquire);
        self.proxy_cleanup_state
            .compare_exchange(
                state,
                proxy_state_after_core_ready_without_proxy(state),
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
            && claim_still_valid()
    }

    async fn update_sysproxy_inner<F>(
        &self,
        authority_update: ProxyAuthorityUpdate,
        claim_still_valid: F,
    ) -> Result<bool>
    where
        F: Fn() -> bool + Send + Sync,
    {
        let authority_snapshot = self.proxy_cleanup_state.load(Ordering::Acquire);
        if !claim_still_valid()
            || !proxy_mutation_allowed(cfg!(target_os = "macos"), authority_snapshot, authority_update)
        {
            logging!(
                info,
                Type::Core,
                "Skipping system proxy update without current macOS proxy authority"
            );
            return Ok(false);
        }

        let _lock = self.update_lock.lock().await;
        if self.proxy_cleanup_state.load(Ordering::Acquire) != authority_snapshot
            || !claim_still_valid()
            || !proxy_mutation_allowed(cfg!(target_os = "macos"), authority_snapshot, authority_update)
        {
            return Ok(false);
        }

        let verge = Config::verge().await.latest_arc();
        let port = match verge.verge_mixed_port {
            Some(port) => port,
            None => Config::clash().await.latest_arc().get_mixed_port(),
        };
        let pac_port = server::embedded_server_port()?;
        // 先 await, 避免持有锁导致的 Send 问题
        let bypass = get_bypass().await;

        let (sys_enable, pac_enable, proxy_host, proxy_guard) = (
            verge.enable_system_proxy.unwrap_or_default(),
            verge.proxy_auto_config.unwrap_or_default(),
            verge.proxy_host.as_deref().unwrap_or("127.0.0.1"),
            verge.enable_proxy_guard.unwrap_or_default(),
        );

        if self.proxy_cleanup_state.load(Ordering::Acquire) != authority_snapshot || !claim_still_valid() {
            return Ok(false);
        }

        let (sys, auto, guard_type) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.host = proxy_host.into();
            sys.port = port;
            sys.bypass = bypass.into();
            auto.url = format!("http://{proxy_host}:{pac_port}/commands/pac");

            // `enable_system_proxy` is the master switch.
            // When disabled, force clear both global proxy and PAC at OS level.
            let guard_type = if !sys_enable {
                sys.enable = false;
                auto.enable = false;
                GuardType::None
            } else if pac_enable {
                sys.enable = false;
                auto.enable = true;
                if proxy_guard {
                    GuardType::Autoproxy(auto.clone())
                } else {
                    GuardType::None
                }
            } else {
                sys.enable = true;
                auto.enable = false;
                if proxy_guard {
                    GuardType::Sysproxy(sys.clone())
                } else {
                    GuardType::None
                }
            };

            (sys.clone(), auto.clone(), guard_type)
        };

        let _guard_operation = self.guard_operation_lock.lock().await;
        if self.proxy_cleanup_state.load(Ordering::Acquire) != authority_snapshot || !claim_still_valid() {
            return Ok(false);
        }
        self.access_guard().write().set_guard_type(guard_type);

        let apply_steps = proxy_apply_steps(sys.enable, auto.enable);

        tokio::task::spawn_blocking(move || -> Result<()> {
            for step in apply_steps {
                match step {
                    ProxyApplyStep::Autoproxy => auto.set_auto_proxy()?,
                    ProxyApplyStep::Sysproxy => sys.set_system_proxy()?,
                }
            }
            Ok(())
        })
        .await??;

        if !claim_still_valid() {
            return Ok(false);
        }
        let next_state = proxy_state_after_apply(authority_snapshot, sys_enable, authority_update);
        let state_updated = self
            .proxy_cleanup_state
            .compare_exchange(authority_snapshot, next_state, Ordering::AcqRel, Ordering::Acquire)
            .is_ok();

        Ok(!cfg!(target_os = "macos") || (state_updated && claim_still_valid()))
    }

    /// reset the sysproxy
    pub(crate) async fn reset_sysproxy(&self) -> Result<()> {
        if !self.proxy_cleanup_is_allowed() {
            logging!(
                info,
                Type::Core,
                "Skipping system proxy cleanup without current macOS proxy authority"
            );
            return Ok(());
        }
        if self
            .reset_sysproxy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        defer! {
            self.reset_sysproxy.store(false, Ordering::SeqCst);
        }
        let _lock = self.update_lock.lock().await;
        let _guard_operation = self.guard_operation_lock.lock().await;
        if !try_take_proxy_cleanup_authority(&self.proxy_cleanup_state, cfg!(target_os = "macos")) {
            return Ok(());
        }
        self.stop_proxy_guard_locked().await;

        // 直接关闭所有代理
        let (sys, auto) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.enable = false;
            auto.enable = false;
            (sys.clone(), auto.clone())
        };

        tokio::task::spawn_blocking(move || -> Result<()> {
            sys.set_system_proxy()?;
            auto.set_auto_proxy()?;
            Ok(())
        })
        .await??;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PROXY_AUTHORITY_BIT, PROXY_REVOKED_BIT, ProxyApplyStep, ProxyAuthorityUpdate, proxy_apply_steps,
        proxy_cleanup_allowed, proxy_guard_refresh_allowed, proxy_mutation_allowed, proxy_state_after_apply,
        proxy_state_after_core_ready_without_proxy, proxy_state_has_authority, revoked_proxy_state,
        try_take_proxy_cleanup_authority,
    };
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn macos_cleanup_requires_current_proxy_authority() {
        assert!(!proxy_cleanup_allowed(true, false));
        assert!(proxy_cleanup_allowed(true, true));
        assert!(proxy_cleanup_allowed(false, false));
        assert!(proxy_cleanup_allowed(false, true));
        assert!(!proxy_mutation_allowed(true, 0, ProxyAuthorityUpdate::Preserve));
        assert!(proxy_mutation_allowed(true, 0, ProxyAuthorityUpdate::ClaimIfNotRevoked));
        assert!(!proxy_mutation_allowed(
            true,
            PROXY_REVOKED_BIT,
            ProxyAuthorityUpdate::ClaimIfNotRevoked
        ));
        assert!(proxy_mutation_allowed(
            true,
            PROXY_REVOKED_BIT,
            ProxyAuthorityUpdate::ClaimAfterCoreReady
        ));
        assert!(proxy_mutation_allowed(false, 0, ProxyAuthorityUpdate::Preserve));

        let revoked = revoked_proxy_state(PROXY_AUTHORITY_BIT);
        assert!(!proxy_state_has_authority(revoked));
        assert_ne!(revoked & PROXY_REVOKED_BIT, 0);
        let claimed = proxy_state_after_apply(revoked, true, ProxyAuthorityUpdate::ClaimAfterCoreReady);
        assert!(proxy_state_has_authority(claimed));
        assert_eq!(claimed & PROXY_REVOKED_BIT, 0);

        let state = AtomicU64::new(PROXY_AUTHORITY_BIT);
        let apply_snapshot = state.load(Ordering::Acquire);
        state.store(revoked_proxy_state(apply_snapshot), Ordering::Release);
        assert!(
            state
                .compare_exchange(
                    apply_snapshot,
                    proxy_state_after_apply(apply_snapshot, true, ProxyAuthorityUpdate::ClaimIfNotRevoked),
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_err()
        );
        assert_ne!(state.load(Ordering::Acquire) & PROXY_REVOKED_BIT, 0);

        assert!(proxy_guard_refresh_allowed(
            true,
            PROXY_AUTHORITY_BIT,
            PROXY_AUTHORITY_BIT
        ));
        assert!(!proxy_guard_refresh_allowed(
            true,
            PROXY_AUTHORITY_BIT,
            revoked_proxy_state(PROXY_AUTHORITY_BIT)
        ));
        assert!(!proxy_guard_refresh_allowed(true, 0, 0));
        assert!(proxy_guard_refresh_allowed(false, 0, 0));

        let cleanup_state = AtomicU64::new(PROXY_AUTHORITY_BIT);
        assert!(try_take_proxy_cleanup_authority(&cleanup_state, true));
        assert!(!try_take_proxy_cleanup_authority(&cleanup_state, true));
        assert_ne!(cleanup_state.load(Ordering::Acquire) & PROXY_REVOKED_BIT, 0);
    }

    #[test]
    fn confirmed_core_ready_without_proxy_allows_a_later_claim() {
        let revoked = revoked_proxy_state(PROXY_AUTHORITY_BIT);
        let disabled_ready = proxy_state_after_core_ready_without_proxy(revoked);
        assert!(!proxy_state_has_authority(disabled_ready));
        assert_eq!(disabled_ready & PROXY_REVOKED_BIT, 0);
        assert!(proxy_mutation_allowed(
            true,
            disabled_ready,
            ProxyAuthorityUpdate::ClaimIfNotRevoked
        ));
    }

    #[tokio::test]
    async fn conditional_owner_recovery_revokes_only_after_generation_claim() {
        let sysopt = super::Sysopt::default();
        sysopt.proxy_cleanup_state.store(PROXY_AUTHORITY_BIT, Ordering::Release);

        assert!(!sysopt.revoke_proxy_cleanup_authority_and_stop_guard_if(|| false).await);
        assert!(proxy_state_has_authority(
            sysopt.proxy_cleanup_state.load(Ordering::Acquire)
        ));

        assert!(sysopt.revoke_proxy_cleanup_authority_and_stop_guard_if(|| true).await);
        assert!(!proxy_state_has_authority(
            sysopt.proxy_cleanup_state.load(Ordering::Acquire)
        ));
    }

    #[test]
    fn pure_sysproxy_mode_clears_pac_before_enabling_global_proxy() {
        assert_eq!(
            proxy_apply_steps(true, false),
            [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
        );
    }

    #[test]
    fn pac_mode_clears_global_proxy_before_enabling_pac() {
        assert_eq!(
            proxy_apply_steps(false, true),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }

    #[test]
    fn disabled_mode_clears_global_proxy_before_pac() {
        assert_eq!(
            proxy_apply_steps(false, false),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }
}
