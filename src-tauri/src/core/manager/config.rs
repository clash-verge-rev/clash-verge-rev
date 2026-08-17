use super::{CoreManager, PROFILE_SELECTIONS_PENDING_COMMIT, RunningMode};
use crate::core::service::StageRequest;
use crate::{
    config::{Config, ConfigType, IProfiles, runtime::IRuntime},
    constants::timing,
    core::{
        handle,
        validate::{CoreConfigValidator, ValidationOutcome, ValidationSkipReason},
    },
    utils::{dirs, help},
};
use anyhow::{Result, anyhow};
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::StageRuntimeOutcome;
use scopeguard::defer;
use smartstring::alias::String;
use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri_plugin_mihomo::Error as MihomoError;

/// What came back from asking the Service to stage a runtime.
///
/// Separated from the decision below so the decision stays a pure function of it. The variants are
/// the four ways an attempt can end, and what distinguishes them is how much they let us conclude:
/// a refusal is the Service's verdict on this bundle, while silence says nothing at all.
#[derive(Debug, Clone, PartialEq, Eq)]
enum StageAttempt {
    /// The Service that owns the running Core predates staging.
    Unsupported,
    /// The Service answered, and its answer was a refusal about the bundle itself — the kind a
    /// fresh start would run into again, because it would materialise the same bundle.
    RefusedTheBundle(String),
    /// The Service answered with a refusal about something other than the bundle: the session, the
    /// protocol, the request. Starting is how several of those get resolved, so it is not a reason
    /// to leave the Core where it is.
    RefusedForAnotherReason(String),
    /// The request did not come back. The Service is authoritative about its own runtime, so
    /// without an answer nothing may be assumed about what it did or did not write.
    Unanswered(String),
    Answered(StageRuntimeOutcome),
}

/// How the Core should be made to pick up a configuration.
#[derive(Debug, PartialEq, Eq)]
enum ConfigApplication {
    /// Point the running Core at this path.
    ReloadFrom(String),
    /// Stop the Core and start it again from a freshly materialised runtime.
    ReplaceCore,
    /// Leave the Core alone and report why the configuration cannot be applied.
    Fail(String),
}

pub(crate) struct ConfigUpdateGuard<'a>(&'a CoreManager);

impl Drop for ConfigUpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.finish_config_update();
    }
}

/// Decide how to apply a configuration, given how staging went.
///
/// Two branches avoid replacing the Core, for opposite reasons. One is success. The other is a
/// refusal *about the bundle*: the Service inspected it and would not take it, and a fresh start
/// materialises the same bundle — so it would fail the same way, having stopped a Core that was
/// working.
///
/// The distinction matters more than it looks. A refusal about the session is not a refusal about
/// the bundle: starting proposes a new session rather than presenting the old one, and the restart
/// path is also what notices that ownership was lost and clears the system proxy. Treating every
/// non-zero code alike would skip that.
///
/// Everything else — an older Service, a request that never came back, or a Service that asked to
/// be restarted — replaces the Core, which is what this did before staging existed and what the
/// Service guarantees is still safe after every way of declining.
fn plan_config_application(attempt: &StageAttempt) -> ConfigApplication {
    match attempt {
        StageAttempt::Answered(StageRuntimeOutcome::Staged { config_path }) => {
            ConfigApplication::ReloadFrom(config_path.into())
        }
        StageAttempt::Answered(StageRuntimeOutcome::RestartRequired { reason }) => {
            logging!(
                info,
                Type::Core,
                "Service declined to stage the runtime ({reason:?}); replacing the core instead"
            );
            ConfigApplication::ReplaceCore
        }
        StageAttempt::RefusedTheBundle(message) => ConfigApplication::Fail(message.clone()),
        StageAttempt::RefusedForAnotherReason(message) => {
            logging!(
                warn,
                Type::Core,
                "Service refused to stage the runtime ({message}); replacing the core instead"
            );
            ConfigApplication::ReplaceCore
        }
        StageAttempt::Unanswered(error) => {
            logging!(
                warn,
                Type::Core,
                "Failed to stage the service runtime, replacing the core instead: {error}"
            );
            ConfigApplication::ReplaceCore
        }
        StageAttempt::Unsupported => ConfigApplication::ReplaceCore,
    }
}

/// One round trip to the Service, classified but not judged.
async fn ask_to_stage(path: &std::path::Path) -> StageAttempt {
    match crate::core::service::stage_runtime_by_service(path).await {
        Ok(StageRequest::Answered(outcome)) => StageAttempt::Answered(outcome),
        Ok(StageRequest::Refused { code, message }) => {
            let message = message.to_string().into();
            if StageRequest::is_about_the_bundle(code) {
                StageAttempt::RefusedTheBundle(message)
            } else {
                StageAttempt::RefusedForAnotherReason(message)
            }
        }
        Err(err) => StageAttempt::Unanswered(format!("{err:#}").into()),
    }
}

/// Ask once, and ask again only when the first attempt came back silent.
///
/// Silence is the one answer that has to be resolved rather than acted on. The Service commits the
/// generation before it replies, so a reply that never arrives can leave `config.yaml` already
/// replaced while this side concludes nothing happened — and the Service restarts a Core that dies
/// later from exactly that file. Treating silence as "nothing happened" is therefore a guess, and
/// the expensive half of it is silent: the Core keeps running the previous configuration until
/// something restarts it, and then it does not.
///
/// Asking again is cheap precisely where it matters. Staging plans against the manifest it wrote,
/// so a bundle that already landed copies nothing and answers in milliseconds; and because the
/// Service holds its lifecycle lock for the whole operation, a second ask that overtakes a first
/// one still in flight waits for it rather than interleaving with it. `confirm_within` is what
/// keeps that wait from being the caller's problem — past it, the answer has stopped being worth
/// more than the fallback, which is where a second silence goes anyway.
async fn stage_with_confirmation<Ask, Fut>(confirm_within: Duration, ask: Ask) -> StageAttempt
where
    Ask: Fn() -> Fut,
    Fut: std::future::Future<Output = StageAttempt>,
{
    let first = match ask().await {
        StageAttempt::Unanswered(first) => first,
        answered => return answered,
    };
    logging!(
        warn,
        Type::Core,
        "Staging did not answer ({first}); asking once more before replacing the core"
    );
    match tokio::time::timeout(confirm_within, ask()).await {
        Ok(StageAttempt::Unanswered(again)) => {
            StageAttempt::Unanswered(format!("{first}; asked again: {again}").into())
        }
        Ok(answered) => answered,
        Err(_) => StageAttempt::Unanswered(format!("{first}; the second ask did not answer either").into()),
    }
}

impl CoreManager {
    pub async fn use_default_config(&self, error_key: &str, error_msg: &str) -> Result<()> {
        use crate::constants::files::RUNTIME_CONFIG;

        let runtime_path = dirs::app_home_dir()?.join(RUNTIME_CONFIG);
        let clash_config = &Config::clash().await.latest_arc().0;

        Config::runtime().await.edit_draft(|d| {
            *d = IRuntime {
                config: Some(clash_config.to_owned()),
                exists_keys: HashSet::new(),
                chain_logs: Default::default(),
            }
        });

        help::save_yaml(&runtime_path, &clash_config, Some("# Clash Verge Runtime")).await?;
        handle::Handle::notice_message(error_key, error_msg);
        Ok(())
    }

    pub async fn update_config_forced(&self) -> Result<ValidationOutcome> {
        self.update_config_with_force(true).await
    }

    pub async fn update_config_with_force(&self, force: bool) -> Result<ValidationOutcome> {
        if handle::Handle::global().is_exiting() {
            return Ok(ValidationOutcome::Skipped {
                reason: ValidationSkipReason::Exiting,
            });
        }

        if !self.try_start_config_update() {
            logging!(info, Type::Core, "Configuration update is already running");
            return Ok(ValidationOutcome::Busy);
        }
        defer! {
            self.finish_config_update();
        }

        if !force && !self.should_update_config() {
            logging!(debug, Type::Core, "Skipping config update due to debounce");
            return Ok(ValidationOutcome::Skipped {
                reason: ValidationSkipReason::Debounced,
            });
        }

        if force {
            self.set_last_update(Instant::now());
        }

        self.perform_config_update(None).await
    }

    pub(crate) async fn update_config_forced_with_profiles(
        &self,
        candidate: &IProfiles,
        rollback: &IProfiles,
    ) -> Result<std::result::Result<ConfigUpdateGuard<'_>, ValidationOutcome>> {
        if handle::Handle::global().is_exiting() {
            return Ok(Err(ValidationOutcome::Skipped {
                reason: ValidationSkipReason::Exiting,
            }));
        }
        if !self.try_start_config_update() {
            return Ok(Err(ValidationOutcome::Busy));
        }
        let guard = ConfigUpdateGuard(self);
        self.set_last_update(Instant::now());
        crate::config::profiles::supersede_selected_activation();

        let outcome = match PROFILE_SELECTIONS_PENDING_COMMIT
            .scope(true, self.perform_config_update(Some(candidate)))
            .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                self.restore_profile_config(rollback).await?;
                return Err(error);
            }
        };
        if !outcome.is_valid() {
            crate::config::profiles::restore_selected_nodes().await;
            return Ok(Err(outcome));
        }
        match candidate.save_file().await {
            Ok(()) => Ok(Ok(guard)),
            Err(error) => {
                self.restore_profile_config(rollback).await?;
                Err(error)
            }
        }
    }

    async fn restore_profile_config(&self, profiles: &IProfiles) -> Result<()> {
        let outcome = self.perform_config_update(Some(profiles)).await?;
        if outcome.is_valid() {
            crate::config::profiles::restore_selected_nodes().await;
            Ok(())
        } else {
            Err(anyhow!("failed to restore previous Core configuration: {outcome}"))
        }
    }

    pub async fn update_config_checked(&self) -> Result<()> {
        let outcome = self.update_config_forced().await?;
        if outcome.is_valid() {
            Ok(())
        } else {
            Err(anyhow!("{outcome}"))
        }
    }

    fn should_update_config(&self) -> bool {
        let now = Instant::now();
        let last = self.get_last_update();

        if let Some(last_time) = last
            && now.duration_since(*last_time) < timing::CONFIG_UPDATE_DEBOUNCE
        {
            return false;
        }

        self.set_last_update(now);
        true
    }

    async fn perform_config_update(&self, profiles: Option<&IProfiles>) -> Result<ValidationOutcome> {
        let runtime = Config::runtime().await;
        let transaction = DraftTransaction::begin(vec![&runtime])?;

        let generate = match profiles {
            Some(profiles) => Config::generate_with_profiles(profiles).await,
            None => Config::generate().await,
        };
        if let Err(err) = generate {
            let message: String = err.to_string().into();
            return Ok(ValidationOutcome::invalid_from_message(message));
        }

        self.validate_and_apply(transaction).await
    }

    pub(crate) async fn update_runtime_config<F>(&self, f: F) -> Result<ValidationOutcome>
    where
        F: FnOnce(&mut IRuntime),
    {
        if !self.try_start_config_update() {
            logging!(info, Type::Core, "Configuration update is already running");
            return Ok(ValidationOutcome::Busy);
        }
        defer! {
            self.finish_config_update();
        }

        let runtime = Config::runtime().await;
        let transaction = DraftTransaction::begin(vec![&runtime])?;
        runtime.edit_draft(f);
        self.validate_and_apply(transaction).await
    }

    /// Validate the staged Runtime Config and hand it to the Core, committing only if both work.
    ///
    /// Takes the transaction rather than opening one, so it covers the staging its callers did.
    /// Every way out of here other than the last line rolls that staging back.
    async fn validate_and_apply(&self, transaction: DraftTransaction<'_>) -> Result<ValidationOutcome> {
        let outcome = CoreConfigValidator::global().validate_config_outcome().await?;
        if !outcome.is_valid() {
            return Ok(outcome);
        }

        let run_path = Config::generate_file(ConfigType::Run).await?;
        self.apply_config(run_path).await?;
        transaction.commit();
        Ok(ValidationOutcome::Valid)
    }

    /// Hand the generated configuration to the Core.
    ///
    /// Says nothing about drafts: whether the staged Runtime Config is kept follows from
    /// whether this succeeded, and the caller's transaction decides that.
    ///
    /// Both modes have the same shape — put the configuration where the Core can read it, ask the
    /// Core to reload, restart it if that did not work. Only the first step differs: in Sidecar
    /// mode the Core already reads the app's own directory, while in Service mode the Service has
    /// to materialise the configuration into the directory it started the Core in.
    async fn apply_config(&self, path: PathBuf) -> Result<()> {
        if matches!(*self.get_running_mode(), RunningMode::Service) {
            let _lifecycle = self.lifecycle_lock.lock().await;
            if !matches!(*self.get_running_mode(), RunningMode::Service) {
                return Err(anyhow!("core mode changed while applying service configuration"));
            }
            return self.apply_config_by_service(&path).await;
        }

        let path = dirs::path_to_str(&path)?;
        self.reload_or_restart(path).await
    }

    /// Apply a configuration in Service mode, staging it in place when that is possible.
    ///
    /// Every way of not staging leads to the same place it always led: stop the Core and start it
    /// again from a freshly materialised runtime. That is what makes declining safe — the Service
    /// leaves the runtime it could not stage exactly as the running Core left it.
    ///
    /// Caller must hold `lifecycle_lock`.
    async fn apply_config_by_service(&self, path: &std::path::Path) -> Result<()> {
        match plan_config_application(&self.attempt_staging(path).await) {
            ConfigApplication::Fail(message) => {
                // The Service looked at this bundle and would not take it. Replacing the Core would
                // hand it the same bundle, so the outage would buy nothing.
                logging!(
                    warn,
                    Type::Core,
                    "Service refused the runtime, leaving the core running: {message}"
                );
                return Err(anyhow!("{message}"));
            }
            ConfigApplication::ReloadFrom(staged) => match self.reload_config(&staged).await {
                Ok(()) => {
                    logging!(info, Type::Core, "Configuration staged and applied by service");
                    return Ok(());
                }
                Err(err) => logging!(
                    warn,
                    Type::Core,
                    "Failed to reload the staged service runtime, replacing the core instead: {err}"
                ),
            },
            ConfigApplication::ReplaceCore => {}
        }

        self.replace_service_core_with_config(path).await?;
        logging!(info, Type::Core, "Configuration materialized and applied by service");
        Ok(())
    }

    /// Ask the Service to stage the runtime, reporting the attempt rather than judging it.
    async fn attempt_staging(&self, path: &std::path::Path) -> StageAttempt {
        if !crate::core::service::active_service_supports_runtime_staging() {
            return StageAttempt::Unsupported;
        }
        stage_with_confirmation(timing::STAGE_CONFIRM_TIMEOUT, || ask_to_stage(path)).await
    }

    /// Reload the Core from `path`, and replace the Core if it will not take it.
    async fn reload_or_restart(&self, path: &str) -> Result<()> {
        let Err(err) = self.reload_config(path).await else {
            logging!(info, Type::Core, "Configuration applied");
            return Ok(());
        };

        logging!(
            warn,
            Type::Core,
            "Failed to apply configuration by mihomo api, restart core to apply it, error msg: {err}"
        );
        match self.restart_core_during_config_update().await {
            Ok(_) => {
                logging!(info, Type::Core, "Configuration applied after restart");
                Ok(())
            }
            Err(err) => {
                logging!(error, Type::Core, "Failed to restart core: {err:#}");
                Err(err.context("failed to apply the configuration"))
            }
        }
    }

    async fn reload_config(&self, path: &str) -> Result<(), MihomoError> {
        handle::Handle::mihomo().reload_config(true, path).await
    }
}

#[cfg(test)]
mod tests {
    use super::{ConfigApplication, StageAttempt, StageRequest, plan_config_application, stage_with_confirmation};
    use clash_verge_service_ipc::{StageRejection, StageRuntimeOutcome};
    use std::{cell::Cell, time::Duration};

    const CONFIRM_WITHIN: Duration = Duration::from_secs(5);

    fn staged() -> StageAttempt {
        StageAttempt::Answered(StageRuntimeOutcome::Staged {
            config_path: "/service/runtime.generation-1/config.yaml".to_owned(),
        })
    }

    #[test]
    fn a_staged_runtime_is_reloaded_from_where_the_service_put_it() {
        let attempt = StageAttempt::Answered(StageRuntimeOutcome::Staged {
            config_path: "/service/runtime.generation-1/config.yaml".to_owned(),
        });

        assert_eq!(
            plan_config_application(&attempt),
            ConfigApplication::ReloadFrom("/service/runtime.generation-1/config.yaml".into()),
            "the core must be pointed at the service's copy, never at the app's own"
        );
    }

    /// Wrap a rejection as the answer the Service would have sent.
    ///
    /// The `match` is the point, not the wrapping: it is exhaustive, so a new way for the Service
    /// to decline cannot be added upstream without this failing to compile — which is what sends
    /// whoever adds it to the test below to say what it should lead to. `CoreRestarted` reached
    /// production without one, and inherited its verdict silently.
    fn declined(reason: StageRejection) -> StageAttempt {
        match &reason {
            StageRejection::CoreNotRunning
            | StageRejection::CorePathChanged
            | StageRejection::RuntimeUnwritable { .. }
            | StageRejection::CoreRestarted => {}
        }
        StageAttempt::Answered(StageRuntimeOutcome::RestartRequired { reason })
    }

    #[test]
    fn a_service_that_declined_makes_the_core_be_replaced() {
        for reason in [
            StageRejection::CoreNotRunning,
            StageRejection::CorePathChanged,
            StageRejection::RuntimeUnwritable {
                detail: "held open".to_owned(),
            },
            // The service's own watchdog can restart the core mid-staging, which leaves the
            // generation holding a mixture no manifest describes. Rebuilding it from nothing is
            // the only answer that does not guess at what is in there.
            StageRejection::CoreRestarted,
        ] {
            assert_eq!(
                plan_config_application(&declined(reason.clone())),
                ConfigApplication::ReplaceCore,
                "declining is an outcome, not an error: {reason:?} must fall back, not fail"
            );
        }
    }

    #[test]
    fn a_service_too_old_to_stage_makes_the_core_be_replaced() {
        assert_eq!(
            plan_config_application(&StageAttempt::Unsupported),
            ConfigApplication::ReplaceCore,
            "an installed service without staging must keep working, not demand a reinstall"
        );
    }

    #[test]
    fn a_refusal_about_the_bundle_leaves_the_core_alone() {
        // Replacing the core would materialise the same bundle the Service just rejected, so the
        // outage buys nothing: the configuration update fails either way, and this way the user's
        // proxy is still working when it does.
        assert_eq!(
            plan_config_application(&StageAttempt::RefusedTheBundle("runtime asset is unavailable".into())),
            ConfigApplication::Fail("runtime asset is unavailable".into())
        );
    }

    #[test]
    fn a_refusal_about_anything_else_still_replaces_the_core() {
        // A stale session is the case that matters: starting proposes a new one, so it is the cure
        // rather than a repeat of the failure — and the restart path is also what notices ownership
        // was lost and clears the system proxy.
        assert_eq!(
            plan_config_application(&StageAttempt::RefusedForAnotherReason("owner session is stale".into())),
            ConfigApplication::ReplaceCore
        );
    }

    #[test]
    fn only_bundle_codes_count_as_a_refusal_of_the_bundle() {
        use clash_verge_service_ipc::ServiceErrorCode;

        assert!(StageRequest::is_about_the_bundle(
            ServiceErrorCode::InvalidRuntimeAsset as u16
        ));
        assert!(StageRequest::is_about_the_bundle(
            ServiceErrorCode::InvalidInstallLocation as u16
        ));
        for other in [
            ServiceErrorCode::StaleOwnerSession,
            ServiceErrorCode::UnauthorizedOwner,
            ServiceErrorCode::ProtocolMismatch,
            ServiceErrorCode::NotActive,
        ] {
            assert!(
                !StageRequest::is_about_the_bundle(other as u16),
                "{other:?} says nothing about the bundle, so starting must still be tried"
            );
        }
    }

    #[test]
    fn a_request_that_never_came_back_makes_the_core_be_replaced() {
        // Not knowing what the service did is the one case where reloading would be a guess: the
        // staged path might not exist, or might hold the previous configuration.
        assert_eq!(
            plan_config_application(&StageAttempt::Unanswered("connection reset".into())),
            ConfigApplication::ReplaceCore
        );
    }

    #[tokio::test]
    async fn an_answer_is_taken_at_its_word_and_not_asked_for_twice() {
        // Staging is only idempotent in what it writes, not in what it costs: a second ask after a
        // perfectly good answer would re-send the whole bundle for nothing.
        for answer in [
            staged(),
            StageAttempt::Answered(StageRuntimeOutcome::RestartRequired {
                reason: StageRejection::CoreNotRunning,
            }),
            StageAttempt::RefusedTheBundle("runtime asset is unavailable".into()),
            StageAttempt::RefusedForAnotherReason("owner session is stale".into()),
        ] {
            let asks = Cell::new(0);
            let outcome = stage_with_confirmation(CONFIRM_WITHIN, || {
                asks.set(asks.get() + 1);
                std::future::ready(answer.clone())
            })
            .await;

            assert_eq!(outcome, answer);
            assert_eq!(asks.get(), 1, "{answer:?} was answered, so asking again buys nothing");
        }
    }

    #[tokio::test]
    async fn silence_is_resolved_by_asking_again_rather_than_assumed() {
        // The case this exists for: the service committed the generation and the reply was lost.
        // Asking again reaches a service that has already done the work, so the second answer is
        // the truth the first one failed to deliver — and it keeps the core off the replace path.
        let asks = Cell::new(0);
        let outcome = stage_with_confirmation(CONFIRM_WITHIN, || {
            asks.set(asks.get() + 1);
            std::future::ready(match asks.get() {
                1 => StageAttempt::Unanswered("connection reset".into()),
                _ => staged(),
            })
        })
        .await;

        assert_eq!(
            outcome,
            staged(),
            "the second answer must decide, not the first silence"
        );
        assert_eq!(asks.get(), 2);
        assert_eq!(
            plan_config_application(&outcome),
            ConfigApplication::ReloadFrom("/service/runtime.generation-1/config.yaml".into()),
            "resolving the silence is only worth doing if it changes what happens next"
        );
    }

    #[tokio::test]
    async fn a_second_silence_still_replaces_the_core() {
        let asks = Cell::new(0);
        let outcome = stage_with_confirmation(CONFIRM_WITHIN, || {
            asks.set(asks.get() + 1);
            std::future::ready(StageAttempt::Unanswered("connection reset".into()))
        })
        .await;

        assert_eq!(asks.get(), 2, "asking a third time would just be a retry loop");
        assert_eq!(plan_config_application(&outcome), ConfigApplication::ReplaceCore);
        assert!(
            matches!(&outcome, StageAttempt::Unanswered(detail)
                if detail.contains("connection reset") && detail.contains("asked again")),
            "two silences must stay unanswered and record that both were tried, got {outcome:?}"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_second_ask_that_keeps_working_is_not_waited_out() {
        // A service still copying assets is why the deadline exists: the answer would be worth
        // having, but not at the cost of leaving the user's configuration unapplied indefinitely.
        let asks = Cell::new(0);
        let started = tokio::time::Instant::now();
        let outcome = stage_with_confirmation(CONFIRM_WITHIN, || async {
            asks.set(asks.get() + 1);
            match asks.get() {
                1 => StageAttempt::Unanswered("deadline has elapsed".into()),
                _ => std::future::pending().await,
            }
        })
        .await;

        assert_eq!(plan_config_application(&outcome), ConfigApplication::ReplaceCore);
        assert_eq!(
            started.elapsed(),
            CONFIRM_WITHIN,
            "the caller must be released at the deadline, not at the service's convenience"
        );
    }
}
