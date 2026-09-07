//! Classifies service ownership samples; `CoreManager` performs any recovery it requests.

use clash_verge_service_ipc::ServiceLifecycleState;

/// Tolerates transient service restarts and slow status calls.
const SUSTAINED_SAMPLES: u8 = 3;

/// Why the app stopped trusting the Service that was running its Core.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerRecoveryReason {
    /// Another owner took the Service over.
    Displaced,
    /// Still ours, but the Core it was running is gone.
    SameOwnerFailure,
    /// We could not reach the Service at all for long enough to give up.
    TransportFailure,
}

/// One reading of Service owner status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerSample {
    /// No usable answer: transport failed, an error code came back, or the payload was empty.
    Unreadable,
    /// The Service reports it is no longer running for us.
    NotActive,
    /// A complete answer.
    Status {
        is_active: bool,
        desired_core_should_be_running: bool,
        service_state: ServiceLifecycleState,
        core_pid: Option<u32>,
    },
}

/// What the caller should do about a sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerStep {
    /// Nothing is wrong, or not wrong for long enough yet.
    Continue,
    /// Check the Core endpoint before treating a sustained status-channel failure as lost ownership.
    VerifyTransport,
    /// Stop trusting the Service and recover.
    Recover(OwnerRecoveryReason),
}

/// Counts consecutive bad samples so that a blip is not mistaken for a failure.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct OwnerWatch {
    unreadable_samples: u8,
    missing_core_samples: u8,
}

impl OwnerWatch {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            unreadable_samples: 0,
            missing_core_samples: 0,
        }
    }

    /// True only when a failure first becomes sustained, to avoid repeated logs.
    #[must_use]
    pub const fn just_became_sustained(&self) -> bool {
        self.unreadable_samples == SUSTAINED_SAMPLES
    }

    /// Fold one reading into the decision.
    pub const fn observe(&mut self, sample: OwnerSample) -> OwnerStep {
        match sample {
            OwnerSample::Unreadable => {
                self.unreadable_samples = self.unreadable_samples.saturating_add(1);
                if self.unreadable_samples >= SUSTAINED_SAMPLES {
                    OwnerStep::VerifyTransport
                } else {
                    OwnerStep::Continue
                }
            }
            OwnerSample::NotActive => OwnerStep::Recover(OwnerRecoveryReason::Displaced),
            OwnerSample::Status {
                is_active,
                desired_core_should_be_running,
                service_state,
                core_pid,
            } => {
                self.unreadable_samples = 0;
                self.missing_core_samples = if core_pid.is_none() && !is_settling(service_state) {
                    self.missing_core_samples.saturating_add(1)
                } else {
                    0
                };
                match recovery_reason(
                    is_active,
                    desired_core_should_be_running,
                    service_state,
                    core_pid,
                    self.missing_core_samples,
                ) {
                    Some(reason) => OwnerStep::Recover(reason),
                    None => OwnerStep::Continue,
                }
            }
        }
    }

    /// Resets the failure run when only the status channel is unavailable.
    pub const fn resolve_transport(&mut self, owner_endpoint_available: bool) -> OwnerStep {
        if owner_endpoint_available {
            self.unreadable_samples = 0;
            return OwnerStep::Continue;
        }
        OwnerStep::Recover(OwnerRecoveryReason::TransportFailure)
    }
}

/// States in which a missing Core PID is expected rather than alarming.
const fn is_settling(service_state: ServiceLifecycleState) -> bool {
    matches!(
        service_state,
        ServiceLifecycleState::Starting | ServiceLifecycleState::RecoveringCore
    )
}

const fn recovery_reason(
    is_active: bool,
    desired_running: bool,
    service_state: ServiceLifecycleState,
    core_pid: Option<u32>,
    missing_core_samples: u8,
) -> Option<OwnerRecoveryReason> {
    if !is_active {
        return Some(OwnerRecoveryReason::Displaced);
    }
    let core_is_gone = !is_settling(service_state) && core_pid.is_none() && missing_core_samples >= SUSTAINED_SAMPLES;
    if !desired_running || matches!(service_state, ServiceLifecycleState::Fatal) || core_is_gone {
        return Some(OwnerRecoveryReason::SameOwnerFailure);
    }
    None
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::*;

    const fn healthy() -> OwnerSample {
        OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: true,
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(42),
        }
    }

    const fn core_gone(service_state: ServiceLifecycleState) -> OwnerSample {
        OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: true,
            service_state,
            core_pid: None,
        }
    }

    #[test]
    fn a_healthy_sample_changes_nothing() {
        let mut watch = OwnerWatch::new();
        assert_eq!(watch.observe(healthy()), OwnerStep::Continue);
        assert_eq!(watch, OwnerWatch::new());
    }

    #[test]
    fn a_short_run_of_unreadable_samples_is_tolerated() {
        let mut watch = OwnerWatch::new();
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
    }

    #[test]
    fn a_sustained_run_of_unreadable_samples_asks_about_the_transport() {
        let mut watch = OwnerWatch::new();
        for _ in 0..2 {
            watch.observe(OwnerSample::Unreadable);
        }
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::VerifyTransport);
        assert!(watch.just_became_sustained(), "the sustained moment should log once");
    }

    #[test]
    fn a_sustained_run_logs_only_once_however_long_it_lasts() {
        let mut watch = OwnerWatch::new();
        for _ in 0..3 {
            watch.observe(OwnerSample::Unreadable);
        }
        assert!(watch.just_became_sustained());

        watch.observe(OwnerSample::Unreadable);
        assert!(!watch.just_became_sustained());
    }

    #[test]
    fn a_reachable_core_endpoint_means_only_the_status_channel_broke() {
        let mut watch = OwnerWatch::new();
        for _ in 0..3 {
            watch.observe(OwnerSample::Unreadable);
        }

        assert_eq!(watch.resolve_transport(true), OwnerStep::Continue);

        // The run restarted: the next stretch of silence must earn its own verdict.
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::VerifyTransport);
    }

    #[test]
    fn an_unreachable_core_endpoint_confirms_transport_failure() {
        let mut watch = OwnerWatch::new();
        for _ in 0..3 {
            watch.observe(OwnerSample::Unreadable);
        }

        assert_eq!(
            watch.resolve_transport(false),
            OwnerStep::Recover(OwnerRecoveryReason::TransportFailure)
        );
    }

    #[test]
    fn a_readable_sample_clears_an_unreadable_run() {
        let mut watch = OwnerWatch::new();
        watch.observe(OwnerSample::Unreadable);
        watch.observe(OwnerSample::Unreadable);

        watch.observe(healthy());

        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
    }

    #[test]
    fn a_service_reporting_not_active_is_displacement() {
        let mut watch = OwnerWatch::new();
        assert_eq!(
            watch.observe(OwnerSample::NotActive),
            OwnerStep::Recover(OwnerRecoveryReason::Displaced)
        );
    }

    #[test]
    fn a_status_saying_we_are_not_the_owner_is_displacement() {
        let mut watch = OwnerWatch::new();
        let sample = OwnerSample::Status {
            is_active: false,
            desired_core_should_be_running: true,
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(1),
        };
        assert_eq!(
            watch.observe(sample),
            OwnerStep::Recover(OwnerRecoveryReason::Displaced)
        );
    }

    #[test]
    fn a_fatal_service_recovers_immediately() {
        let mut watch = OwnerWatch::new();
        let sample = OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: true,
            service_state: ServiceLifecycleState::Fatal,
            core_pid: Some(1),
        };
        assert_eq!(
            watch.observe(sample),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn a_service_that_no_longer_wants_the_core_running_recovers_immediately() {
        let mut watch = OwnerWatch::new();
        let sample = OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: false,
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(1),
        };
        assert_eq!(
            watch.observe(sample),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn a_briefly_missing_core_is_tolerated_then_recovered() {
        let mut watch = OwnerWatch::new();
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn a_missing_core_is_expected_while_the_service_is_still_settling() {
        for state in [ServiceLifecycleState::Starting, ServiceLifecycleState::RecoveringCore] {
            let mut watch = OwnerWatch::new();
            for _ in 0..10 {
                assert_eq!(watch.observe(core_gone(state)), OwnerStep::Continue, "{state:?}");
            }
        }
    }

    #[test]
    fn a_core_that_comes_back_clears_the_missing_run() {
        let mut watch = OwnerWatch::new();
        watch.observe(core_gone(ServiceLifecycleState::Running));
        watch.observe(core_gone(ServiceLifecycleState::Running));

        watch.observe(healthy());

        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
    }

    #[test]
    fn an_unreadable_run_does_not_count_towards_a_missing_core() {
        // The two counters are independent: silence says nothing about the Core's PID.
        let mut watch = OwnerWatch::new();
        watch.observe(OwnerSample::Unreadable);
        watch.observe(OwnerSample::Unreadable);

        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
    }
}
