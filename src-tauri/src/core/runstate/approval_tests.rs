//! 系统批准与 IPC 就绪分别验证，测试不修改本机服务或批准状态。

use super::{FakeEnv, PendingAction, RunStateStore, ServiceHealth};

#[tokio::test]
async fn waiting_for_approval_does_not_probe_ipc_or_report_damage() {
    let env = FakeEnv::new().with_evidence(true);
    env.set_registration_health(Some(ServiceHealth::ApprovalRequired));
    let store = RunStateStore::new(env);

    assert_eq!(store.observe_current_health().await, ServiceHealth::ApprovalRequired);
    assert_eq!(store.env().probe_count(), 0);
    assert!(!store.state().service_usable());
    assert!(store.state().service_needs_attention());
    assert!(!store.state().tun_should_be_disabled(true));
}

#[tokio::test]
async fn registration_success_can_still_require_approval() -> anyhow::Result<()> {
    let env = FakeEnv::new();
    env.set_registration_health(Some(ServiceHealth::ApprovalRequired));
    let store = RunStateStore::new(env);
    store.request_action(PendingAction::Install);

    store.perform(PendingAction::Install).await?;

    assert_eq!(store.state().health, ServiceHealth::ApprovalRequired);
    assert_eq!(store.state().pending, None);
    assert_eq!(store.env().probe_count(), 0);
    assert_eq!(store.env().privileged_actions(), [PendingAction::Install]);
    Ok(())
}

#[tokio::test]
async fn approval_only_becomes_ready_after_a_valid_ipc_reply() -> anyhow::Result<()> {
    let store = RunStateStore::new(FakeEnv::new().service_ready());
    store.observe(ServiceHealth::ApprovalRequired);

    store.refresh_service_approval().await?;

    assert_eq!(store.state().health, ServiceHealth::Ready);
    assert!(store.state().service_usable());
    assert_eq!(store.env().probe_count(), 1);
    assert!(store.env().privileged_actions().is_empty());
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn launchd_startup_delay_does_not_trigger_reinstallation() -> anyhow::Result<()> {
    let store = RunStateStore::new(FakeEnv::new().replying(vec![
        Err("服务正在启动".to_owned()),
        Ok(super::ServiceVersionReply {
            code: 0,
            message: "ok".to_owned(),
            protocol: Some(clash_verge_service_ipc::ProtocolInfo::current()),
        }),
    ]));
    store.observe(ServiceHealth::ApprovalRequired);

    store.refresh_service_approval().await?;

    assert_eq!(store.state().health, ServiceHealth::Ready);
    assert_eq!(store.env().probe_count(), 2);
    assert!(store.env().privileged_actions().is_empty());
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn an_approved_service_that_never_starts_can_still_be_repaired() -> anyhow::Result<()> {
    let store = RunStateStore::new(FakeEnv::new().service_unreachable());
    store.observe(ServiceHealth::ApprovalRequired);

    store.refresh_service_approval().await?;

    assert!(matches!(store.state().health, ServiceHealth::Unavailable(_)));
    assert!(store.state().service_needs_attention());
    assert!(store.env().privileged_actions().is_empty());
    Ok(())
}

#[tokio::test]
async fn revocation_requires_approval_again_instead_of_repair() -> anyhow::Result<()> {
    let env = FakeEnv::new().service_ready();
    env.set_registration_health(Some(ServiceHealth::ApprovalRequired));
    let store = RunStateStore::new(env);
    store.observe(ServiceHealth::Ready);

    store.refresh_service_approval().await?;

    assert_eq!(store.state().health, ServiceHealth::ApprovalRequired);
    assert_eq!(store.env().probe_count(), 0);
    Ok(())
}

#[tokio::test]
async fn approval_refresh_preserves_sidecar_choice_and_pending_operations() -> anyhow::Result<()> {
    let store = RunStateStore::new(FakeEnv::new().service_ready());
    store.observe(ServiceHealth::ApprovalRequired);
    store.allow_sidecar_for_session()?;
    store.refresh_service_approval().await?;
    assert!(store.state().sidecar_allowed);
    assert!(!store.state().service_needs_attention());
    assert_eq!(store.env().probe_count(), 0);

    store.request_action(PendingAction::Uninstall);
    store.refresh_service_approval().await?;
    assert_eq!(store.state().pending, Some(PendingAction::Uninstall));
    assert_eq!(store.env().probe_count(), 0);
    Ok(())
}

#[tokio::test]
async fn changed_native_bundle_uses_existing_reinstallation_flow() {
    let env = FakeEnv::new().service_ready();
    env.set_registration_health(Some(ServiceHealth::VersionMismatch));
    let store = RunStateStore::new(env);

    assert_eq!(store.observe_current_health().await, ServiceHealth::VersionMismatch);
    assert_eq!(store.env().probe_count(), 0);
    assert!(store.state().service_needs_attention());
    assert!(store.env().privileged_actions().is_empty());
}
