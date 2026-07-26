//! Turning raw Service probes into [`ServiceHealth`].
//!
//! Everything here is a pure function of its arguments: the probing itself is an effect
//! on [`super::env::RunStateEnv`], so these classifications are testable without IPC,
//! systemd, SCM or launchd.

use clash_verge_service_ipc::{MIN_REQUIRED_SERVICE_REVISION, ProtocolInfo, ProtocolVersion};

use super::health::ServiceHealth;

/// What the Service replied to a protocol-version query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceVersionReply {
    pub code: u16,
    pub message: String,
    pub protocol: Option<ProtocolInfo>,
}

/// The verdict on a [`ServiceVersionReply`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceVersionCheck {
    Ready,
    NeedsReinstall(String),
}

/// What a live probe of the currently-installed Service told us.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurrentServiceProbe {
    Missing,
    Ready,
    VersionMismatch,
    Unavailable,
}

/// Decide whether the Service we reached speaks a protocol this client can use.
pub fn classify_service_version_reply(reply: &ServiceVersionReply) -> ServiceVersionCheck {
    let client = ProtocolVersion::current();
    if reply.code == 0
        && reply
            .protocol
            .as_ref()
            .is_some_and(|info| info.supports_client(client, MIN_REQUIRED_SERVICE_REVISION))
    {
        return ServiceVersionCheck::Ready;
    }

    let detail = if reply.code == 0 {
        match reply.protocol.as_ref() {
            Some(info) => format!(
                "client requires epoch {} revision >= {}, service reports epoch {} revision {} (build {})",
                client.epoch,
                MIN_REQUIRED_SERVICE_REVISION,
                info.protocol.epoch,
                info.protocol.revision,
                info.build_version
            ),
            None => "service did not report protocol information".to_owned(),
        }
    } else {
        format!(
            "protocol query returned code {} ({}) while expecting epoch {}",
            reply.code, reply.message, client.epoch
        )
    };
    ServiceVersionCheck::NeedsReinstall(format!(
        "Service helper protocol mismatch: {detail}. Choose Reinstall or Repair to continue"
    ))
}

/// Classify a version reply into the probe outcome used by [`classify_service_health`].
pub fn probe_outcome(reply: &ServiceVersionReply) -> CurrentServiceProbe {
    if classify_service_version_reply(reply) == ServiceVersionCheck::Ready {
        CurrentServiceProbe::Ready
    } else {
        CurrentServiceProbe::VersionMismatch
    }
}

/// Combine a live probe with platform installation evidence into a health verdict.
///
/// The `has_install_marker` case matters: a Service registered with the platform that does
/// not answer is broken, not absent, so it needs reinstalling rather than installing.
/// `unavailable_reason` is only consulted for [`CurrentServiceProbe::Unavailable`].
pub fn classify_service_health(
    current: CurrentServiceProbe,
    has_install_marker: bool,
    unavailable_reason: &str,
) -> ServiceHealth {
    match current {
        CurrentServiceProbe::Ready => ServiceHealth::Ready,
        CurrentServiceProbe::VersionMismatch => ServiceHealth::VersionMismatch,
        CurrentServiceProbe::Unavailable => ServiceHealth::Unavailable(unavailable_reason.to_owned()),
        CurrentServiceProbe::Missing if has_install_marker => ServiceHealth::VersionMismatch,
        CurrentServiceProbe::Missing => ServiceHealth::NotInstalled,
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::*;

    fn ready_reply() -> ServiceVersionReply {
        ServiceVersionReply {
            code: 0,
            message: "ok".to_owned(),
            protocol: Some(ProtocolInfo::current()),
        }
    }

    #[test]
    fn a_compatible_reply_is_ready() {
        assert_eq!(
            classify_service_version_reply(&ready_reply()),
            ServiceVersionCheck::Ready
        );
        assert_eq!(probe_outcome(&ready_reply()), CurrentServiceProbe::Ready);
    }

    #[test]
    fn a_reply_without_protocol_information_needs_reinstall() {
        let reply = ServiceVersionReply {
            code: 0,
            message: "ok".to_owned(),
            protocol: None,
        };
        let ServiceVersionCheck::NeedsReinstall(detail) = classify_service_version_reply(&reply) else {
            panic!("expected a reinstall verdict");
        };
        assert!(
            detail.contains("did not report protocol information"),
            "detail should explain the missing protocol: {detail}"
        );
        assert_eq!(probe_outcome(&reply), CurrentServiceProbe::VersionMismatch);
    }

    #[test]
    fn a_nonzero_code_needs_reinstall() {
        let reply = ServiceVersionReply {
            code: 7,
            message: "nope".to_owned(),
            protocol: Some(ProtocolInfo::current()),
        };
        let ServiceVersionCheck::NeedsReinstall(detail) = classify_service_version_reply(&reply) else {
            panic!("expected a reinstall verdict");
        };
        assert!(detail.contains("code 7"), "detail should name the code: {detail}");
    }

    #[test]
    fn a_mismatched_epoch_needs_reinstall() {
        let mut info = ProtocolInfo::current();
        info.protocol.epoch = info.protocol.epoch.wrapping_add(1);
        let reply = ServiceVersionReply {
            code: 0,
            message: "ok".to_owned(),
            protocol: Some(info),
        };
        assert!(matches!(
            classify_service_version_reply(&reply),
            ServiceVersionCheck::NeedsReinstall(_)
        ));
        assert_eq!(probe_outcome(&reply), CurrentServiceProbe::VersionMismatch);
    }

    #[test]
    fn a_service_revision_below_the_minimum_needs_reinstall() {
        let Some(revision) = MIN_REQUIRED_SERVICE_REVISION.checked_sub(1) else {
            // Nothing below the minimum exists to test against.
            return;
        };
        let mut info = ProtocolInfo::current();
        info.protocol.revision = revision;
        let reply = ServiceVersionReply {
            code: 0,
            message: "ok".to_owned(),
            protocol: Some(info),
        };
        assert!(matches!(
            classify_service_version_reply(&reply),
            ServiceVersionCheck::NeedsReinstall(_)
        ));
    }

    #[test]
    fn missing_without_evidence_is_not_installed() {
        assert_eq!(
            classify_service_health(CurrentServiceProbe::Missing, false, ""),
            ServiceHealth::NotInstalled
        );
    }

    #[test]
    fn missing_with_evidence_means_broken_not_absent() {
        assert_eq!(
            classify_service_health(CurrentServiceProbe::Missing, true, ""),
            ServiceHealth::VersionMismatch
        );
    }

    #[test]
    fn an_unreachable_service_keeps_the_reason() {
        assert_eq!(
            classify_service_health(CurrentServiceProbe::Unavailable, true, "socket refused"),
            ServiceHealth::Unavailable("socket refused".to_owned())
        );
    }

    #[test]
    fn a_live_probe_dominates_the_install_marker() {
        for has_marker in [false, true] {
            assert_eq!(
                classify_service_health(CurrentServiceProbe::Ready, has_marker, ""),
                ServiceHealth::Ready
            );
            assert_eq!(
                classify_service_health(CurrentServiceProbe::VersionMismatch, has_marker, ""),
                ServiceHealth::VersionMismatch
            );
        }
    }
}
