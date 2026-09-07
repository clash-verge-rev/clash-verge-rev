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

/// A staging result separated from the policy that acts on it.
#[derive(Debug, Clone, PartialEq, Eq)]
enum StageAttempt {
    Unsupported,
    /// Restarting would present the same rejected bundle.
    RefusedTheBundle(String),
    /// A new service session may resolve this refusal.
    RefusedForAnotherReason(String),
    /// The service may have staged the bundle without delivering its reply.
    Unanswered(String),
    Answered(StageRuntimeOutcome),
}

#[derive(Debug, PartialEq, Eq)]
enum ConfigApplication {
    ReloadFrom(String),
    ReplaceCore,
    Fail(String),
}

pub(crate) struct ConfigUpdateGuard<'a>(&'a CoreManager);

impl Drop for ConfigUpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.finish_config_update();
    }
}

/// Avoids replacing a working core only when the service staged successfully or rejected the
/// bundle itself; session-level failures may be repaired by replacement.
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

/// Confirms one silent request because the service may commit before its reply is lost.
/// Re-staging an already committed bundle is idempotent and bounded by `confirm_within`.
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

    /// Validates and applies the caller's transaction, committing only on success.
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

    /// Applies a generated configuration through the active core owner.
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

    /// Applies through the service, replacing the core when in-place staging is unavailable.
    /// Caller must hold `lifecycle_lock`.
    async fn apply_config_by_service(&self, path: &std::path::Path) -> Result<()> {
        match plan_config_application(&self.attempt_staging(path).await) {
            ConfigApplication::Fail(message) => {
                // Replacement would hand the service the same rejected bundle.
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

    /// Exhaustively maps every service rejection into the policy under test.
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
            // A watchdog restart mid-staging can leave a generation that no manifest describes.
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
        // Keep the working core when replacement would present the same rejected bundle.
        assert_eq!(
            plan_config_application(&StageAttempt::RefusedTheBundle("runtime asset is unavailable".into())),
            ConfigApplication::Fail("runtime asset is unavailable".into())
        );
    }

    #[test]
    fn a_refusal_about_anything_else_still_replaces_the_core() {
        // A new session can repair stale ownership and clear the inherited system proxy.
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

    #[tokio::test]
    async fn an_answer_is_taken_at_its_word_and_not_asked_for_twice() {
        // Do not pay for a confirmation after a conclusive answer.
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
        // Confirm a committed generation whose first reply was lost.
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
        // Do not wait indefinitely for a service still copying assets.
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
