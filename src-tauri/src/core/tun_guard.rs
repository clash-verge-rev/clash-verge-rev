//! Sidecar protection and legacy journal migration; service cores own their own protection.

use anyhow::Result;
pub(crate) use clash_verge_service_ipc::forwarding_guard::{InterfaceUnavailable, InterfaceUnavailableReason};

pub(crate) fn interface_unavailable(error: &anyhow::Error) -> Option<&InterfaceUnavailable> {
    error.downcast_ref()
}

#[derive(Debug)]
pub(crate) enum GuardFailure {
    Recovery,
    Preparation,
}

impl std::fmt::Display for GuardFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Recovery => "TUN compatibility restoration is pending",
            Self::Preparation => "TUN compatibility protection could not be prepared",
        })
    }
}

impl std::error::Error for GuardFailure {}

pub(crate) fn is_guard_failure(error: &anyhow::Error) -> bool {
    error.downcast_ref::<GuardFailure>().is_some()
}

static PENDING_RESTORE_NOTICE: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);

pub(crate) fn record_restore_notice(detail: String) {
    *PENDING_RESTORE_NOTICE.lock() = Some(detail);
}

pub(crate) fn take_restore_notice() -> Option<String> {
    PENDING_RESTORE_NOTICE.lock().take()
}

#[cfg(windows)]
fn clear_restore_notice() {
    *PENDING_RESTORE_NOTICE.lock() = None;
}

mod runtime {
    use anyhow::Result;
    use clash_verge_service_ipc::forwarding_guard::GuardRuntime;
    use parking_lot::Mutex;

    static RUNTIME: Mutex<Option<GuardRuntime>> = Mutex::new(None);

    pub(super) fn with_runtime<T>(operation: impl FnOnce(&mut GuardRuntime) -> Result<T>) -> Result<T> {
        let mut runtime = RUNTIME.lock();
        if runtime.is_none() {
            #[cfg(windows)]
            let root = crate::utils::dirs::app_home_dir()?;
            #[cfg(not(windows))]
            let root = std::path::PathBuf::new();
            *runtime = Some(GuardRuntime::new(root));
        }
        operation(
            runtime
                .as_mut()
                .ok_or_else(|| anyhow::anyhow!("TUN guard runtime is unavailable"))?,
        )
    }

    pub(super) fn has_owned_guard() -> bool {
        RUNTIME.lock().as_ref().is_some_and(GuardRuntime::has_owned_guard)
    }

    #[cfg(windows)]
    pub(super) fn check() -> Result<()> {
        match RUNTIME.lock().as_mut() {
            Some(runtime) => runtime.check(),
            None => Ok(()),
        }
    }
}

pub struct GuardTransaction {
    id: Option<u64>,
}

pub fn prepare(interface_name: Option<&str>) -> Result<GuardTransaction> {
    #[cfg(not(windows))]
    let interface_name = {
        let _ = interface_name;
        None
    };
    Ok(GuardTransaction {
        id: runtime::with_runtime(|runtime| runtime.prepare(interface_name))
            .map_err(|error| error.context(GuardFailure::Preparation))?,
    })
}

impl GuardTransaction {
    pub fn rollback(self) -> Result<()> {
        let mut transaction = self;
        if let Some(id) = transaction.id.take() {
            return runtime::with_runtime(|runtime| runtime.finish(id, false));
        }
        Ok(())
    }

    pub fn commit(self) -> Result<()> {
        let mut transaction = self;
        if let Some(id) = transaction.id.take() {
            let result = runtime::with_runtime(|runtime| runtime.finish(id, true));
            #[cfg(windows)]
            if result.is_ok() {
                clear_restore_notice();
            }
            return result;
        }
        Ok(())
    }

    pub fn retain(self) -> Result<()> {
        let mut transaction = self;
        if let Some(id) = transaction.id.take() {
            return runtime::with_runtime(|runtime| runtime.retain(id));
        }
        Ok(())
    }
}

impl Drop for GuardTransaction {
    fn drop(&mut self) {
        #[cfg(windows)]
        if let Some(id) = self.id.take() {
            let result = runtime::with_runtime(|runtime| runtime.retain(id));
            let detail = match result {
                Ok(()) => {
                    "TUN compatibility restoration requires confirming that the cancelled core has exited".to_owned()
                }
                Err(error) => format!("TUN compatibility retention failed: {error:#}"),
            };
            record_restore_notice(detail.clone());
            super::handle::Handle::notice(super::notify::NoticeStatus::TunCompatibilityGuardRestoreFailed, detail);
        }
    }
}

pub fn recover() -> Result<()> {
    let result = runtime::with_runtime(|runtime| runtime.recover());
    #[cfg(windows)]
    if result.is_ok() {
        clear_restore_notice();
    }
    result
}

pub fn prepare_recovery() -> Result<bool> {
    let result = runtime::with_runtime(|runtime| runtime.prepare_recovery());
    #[cfg(windows)]
    if matches!(result, Ok(false)) {
        clear_restore_notice();
    }
    result
}

pub fn has_owned_guard() -> bool {
    runtime::has_owned_guard()
}

pub fn restore() -> Result<()> {
    let result = runtime::with_runtime(|runtime| runtime.restore());
    #[cfg(windows)]
    if result.is_ok() {
        clear_restore_notice();
    }
    result
}

#[cfg(windows)]
pub fn check() -> Result<()> {
    runtime::check()
}

#[cfg(test)]
mod tests {
    use super::{
        GuardFailure, InterfaceUnavailable, InterfaceUnavailableReason, interface_unavailable, is_guard_failure,
    };

    #[test]
    fn guard_failures_remain_terminal_without_losing_interface_guidance() {
        let error = anyhow::Error::new(InterfaceUnavailable {
            name: "WLAN".into(),
            reason: InterfaceUnavailableReason::Disconnected,
        })
        .context(GuardFailure::Preparation)
        .context("service startup failed");
        assert!(is_guard_failure(&error));
        assert_eq!(
            interface_unavailable(&error).map(|error| error.name.as_str()),
            Some("WLAN")
        );
        assert!(!is_guard_failure(&anyhow::anyhow!("proxy port in use")));
    }
}
