use super::{CmdResult, proxy_aware_coded_error};
use crate::{
    constants::timing,
    core::{
        CoreManager,
        manager::RunningMode,
        service::{SERVICE_MANAGER, ServiceStatus, request_runtime_provider_sync},
    },
};

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ServiceInstallOutcome {
    Installed,
    #[cfg(any(windows, test))]
    Sidecar {
        reason: String,
    },
}

async fn execute_service_operation_sync(status: ServiceStatus, error_code: &str) -> CmdResult<ServiceInstallOutcome> {
    let manager = CoreManager::global();
    let result = {
        let _lifecycle = manager.lifecycle_lock.lock().await;
        if matches!(
            &status,
            ServiceStatus::ReinstallRequired | ServiceStatus::ForceReinstallRequired
        ) {
            manager
                .controlled_stop_core_inner()
                .await
                .map_err(|error| proxy_aware_coded_error(&error, error_code))?;
        }
        SERVICE_MANAGER.handle_service_status(status).await
    };
    #[cfg(windows)]
    return finish_service_installation(result, error_code, || manager.continue_with_sidecar()).await;

    #[cfg(not(windows))]
    result
        .map(|()| ServiceInstallOutcome::Installed)
        .map_err(|error| proxy_aware_coded_error(&error, error_code))
}

#[cfg(any(windows, test))]
async fn finish_service_installation<Fallback, FallbackFuture>(
    installation: anyhow::Result<()>,
    error_code: &str,
    fallback: Fallback,
) -> CmdResult<ServiceInstallOutcome>
where
    Fallback: FnOnce() -> FallbackFuture,
    FallbackFuture: std::future::Future<Output = anyhow::Result<()>>,
{
    let Err(error) = installation else {
        return Ok(ServiceInstallOutcome::Installed);
    };
    let Some(failure) = error.downcast_ref::<clash_verge_service_ipc::management::InstallationVerificationError>()
    else {
        return Err(proxy_aware_coded_error(&error, error_code));
    };
    let reasons = failure
        .status
        .cores
        .iter()
        .filter_map(|core| match &core.availability {
            clash_verge_service_ipc::CoreAvailability::Rejected { reason } => Some(format!("{}: {reason}", core.name)),
            _ => None,
        })
        .collect::<Vec<_>>();
    if reasons.is_empty() {
        return Err(proxy_aware_coded_error(&error, error_code));
    }
    let reason = reasons.join("\n");
    fallback().await.map_err(|error| {
        proxy_aware_coded_error(
            &error.context(format!("Service core rejected: {reason}; Sidecar fallback failed")),
            "SERVICE_SIDECAR_FAILED",
        )
    })?;
    Ok(ServiceInstallOutcome::Sidecar { reason })
}

#[tauri::command]
pub async fn install_service() -> CmdResult<ServiceInstallOutcome> {
    execute_service_operation_sync(ServiceStatus::InstallRequired, "SERVICE_INSTALL_FAILED").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    CoreManager::global()
        .uninstall_service_and_start_sidecar()
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "SERVICE_UNINSTALL_FAILED"))
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult<ServiceInstallOutcome> {
    execute_service_operation_sync(ServiceStatus::ReinstallRequired, "SERVICE_REINSTALL_FAILED").await
}

#[tauri::command]
pub async fn repair_service() -> CmdResult<ServiceInstallOutcome> {
    execute_service_operation_sync(ServiceStatus::ForceReinstallRequired, "SERVICE_REPAIR_FAILED").await
}

#[tauri::command]
pub async fn continue_with_sidecar() -> CmdResult {
    crate::core::CoreManager::global()
        .continue_with_sidecar()
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "SERVICE_SIDECAR_FAILED"))
}

#[tauri::command]
pub fn take_service_fallback_notice() -> bool {
    crate::core::service::take_service_fallback_notice()
}

#[tauri::command]
pub fn get_core_startup_error() -> Option<crate::core::manager::CoreFailure> {
    crate::core::CoreManager::global().get_startup_error()
}

#[tauri::command]
pub fn take_service_repair_notice() -> bool {
    crate::core::service::take_service_repair_notice()
}

#[tauri::command]
pub fn take_service_owner_notice() -> Option<String> {
    crate::core::service::take_service_owner_notice()
}

#[tauri::command]
pub fn sync_runtime_providers() {
    if matches!(*CoreManager::global().get_running_mode(), RunningMode::Service) {
        request_runtime_provider_sync(timing::RUNTIME_PROVIDER_SETTLE);
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::{ServiceInstallOutcome, finish_service_installation};
    use clash_verge_service_ipc::{
        CoreAvailability, CoreInspection, InstallationStatus, ProtocolInfo, management::InstallationVerificationError,
    };
    use std::cell::Cell;

    #[tokio::test]
    async fn rejected_installation_reports_sidecar_only_after_successful_continuation() {
        let reason = "core path C:\\ is writable by Everyone";
        for (availability, fallback_ready) in [
            (None, false),
            (Some(CoreAvailability::Missing), false),
            (Some(CoreAvailability::DigestMismatch), false),
            (Some(CoreAvailability::Rejected { reason: reason.into() }), false),
            (Some(CoreAvailability::Rejected { reason: reason.into() }), true),
        ] {
            let fallback_called = Cell::new(false);
            let rejected = matches!(&availability, Some(CoreAvailability::Rejected { .. }));
            let error = match availability {
                Some(availability) => anyhow::Error::new(InstallationVerificationError {
                    status: InstallationStatus {
                        service_sha256: String::new(),
                        protocol: ProtocolInfo::current(),
                        cores: vec![CoreInspection {
                            name: "verge-mihomo.exe".into(),
                            availability,
                        }],
                        core_busy: false,
                    },
                }),
                None => anyhow::anyhow!("{reason}"),
            }
            .context("install service failed");
            let result = finish_service_installation(Err(error), "SERVICE_INSTALL_FAILED", || async {
                fallback_called.set(true);
                anyhow::ensure!(fallback_ready, "another core is running");
                Ok(())
            })
            .await;

            assert_eq!(fallback_called.get(), rejected);
            if rejected && fallback_ready {
                assert_eq!(
                    result,
                    Ok(ServiceInstallOutcome::Sidecar {
                        reason: format!("verge-mihomo.exe: {reason}")
                    })
                );
            } else {
                let error = result.expect_err("an unavailable fallback must remain an error");
                assert_eq!(
                    error.code.as_deref(),
                    Some(if rejected {
                        "SERVICE_SIDECAR_FAILED"
                    } else {
                        "SERVICE_INSTALL_FAILED"
                    })
                );
                if rejected {
                    assert!(error.detail.contains(reason));
                    assert!(error.detail.contains("another core is running"));
                }
            }
        }
    }
}
