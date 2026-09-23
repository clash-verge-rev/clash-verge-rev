use anyhow::{Result, ensure};
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging_error};
use serde::Serialize;
use smartstring::alias::String;

use crate::{
    config::{
        Config, PrfItem,
        dns::{ProfileDnsSettings, dns_override_source},
        profiles::{self, PROFILE_WRITE_LOCK},
    },
    constants::files::DNS_CONFIG,
    core::{CoreManager, handle::Handle},
    utils::dirs,
};

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DnsOverrideOutcome {
    Applied,
    ConfirmationRequired { source: String },
}

async fn validate_dns_settings() -> Result<()> {
    let content = tokio::fs::read_to_string(dirs::app_home_dir()?.join(DNS_CONFIG)).await?;
    serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&content)?;
    Ok(())
}

/// Saves subscription metadata and applies a changed DNS permission for the active profile.
/// Returns whether the runtime was applied, so the editor can avoid a second reload.
pub async fn patch_profile_with_dns(index: &str, item: &PrfItem) -> Result<bool> {
    let profile_write = PROFILE_WRITE_LOCK.lock().await;
    let config_write = Config::lock_config_write().await;
    let profiles = Config::profiles().await;
    let verge = Config::verge().await;
    let (runtime_applied, config_update_guard) = profiles
        .with_data_modify(|mut candidate| async move {
            let original = candidate.clone();
            let was_allowed = original.get_item(index)?.allows_dns_override();
            candidate.patch_item(index, item)?;
            let allowed = candidate.get_item(index)?.allows_dns_override();
            if was_allowed == allowed {
                candidate.save_file().await?;
                return Ok((candidate, (false, None)));
            }

            if allowed {
                validate_dns_settings().await?;
            }
            let original_verge = verge.data_arc();
            let transaction = DraftTransaction::begin(vec![&verge])?;
            verge.edit_draft(|draft| {
                let mut settings = draft.dns_settings_for(index, was_allowed);
                if allowed {
                    settings.enabled = true;
                }
                settings.confirmation = None;
                draft.profile_dns_settings.insert(index.into(), settings);
            });

            let is_current = candidate.current.as_deref() == Some(index);
            // Persist first so an I/O failure cannot leave the core using unsaved settings.
            // If validation or profile persistence fails, restore this file below.
            verge.latest_arc().save_file().await?;
            let saved = async {
                if is_current {
                    let outcome = CoreManager::global()
                        .update_config_forced_with_profiles(&candidate, &original, || verge.discard())
                        .await?;
                    match outcome {
                        Ok(guard) => Ok(Some(guard)),
                        Err(outcome) => anyhow::bail!(outcome),
                    }
                } else {
                    candidate.save_file().await?;
                    Ok(None)
                }
            }
            .await;

            match saved {
                Ok(guard) => {
                    transaction.commit();
                    Ok((candidate, (is_current, guard)))
                }
                Err(error) => {
                    transaction.rollback();
                    original_verge
                        .save_file()
                        .await
                        .map_err(|restore| anyhow::anyhow!("{error:#}; restoring DNS settings failed: {restore:#}"))?;
                    Err(error)
                }
            }
        })
        .await?;
    if runtime_applied {
        profiles::activate_selected_nodes();
    }
    drop(config_update_guard);
    drop(config_write);
    drop(profile_write);

    if runtime_applied {
        logging_error!(Type::Config, Config::sync_dns_override().await);
        Handle::refresh_clash();
    }
    Handle::refresh_verge();
    Ok(runtime_applied)
}

pub async fn set_dns_override(
    profile_uid: String,
    enabled: bool,
    confirmation: Option<String>,
) -> Result<DnsOverrideOutcome> {
    let _profile_write = PROFILE_WRITE_LOCK.lock().await;
    let _config_write = Config::lock_config_write().await;
    let profiles = Config::profiles().await.data_arc();
    ensure!(
        profiles.current.as_ref() == Some(&profile_uid),
        "The active profile changed; retry the DNS setting"
    );
    let allowed = profiles.get_item(&profile_uid)?.allows_dns_override();
    let source = dns_override_source(
        profiles.current.as_deref().unwrap_or_default(),
        &profiles.current_mapping().await?,
    )?;
    if enabled
        && !allowed
        && let Some(source) = source.as_ref().filter(|source| Some(*source) != confirmation.as_ref())
    {
        return Ok(DnsOverrideOutcome::ConfirmationRequired { source: source.clone() });
    }

    if enabled {
        validate_dns_settings().await?;
    }

    let verge = Config::verge().await;
    let transaction = DraftTransaction::begin(vec![&verge])?;
    verge.edit_draft(|draft| {
        draft.profile_dns_settings.insert(
            profile_uid.clone(),
            ProfileDnsSettings {
                enabled,
                confirmation: if enabled && !allowed { source } else { None },
            },
        );
    });
    CoreManager::global().update_config_checked().await?;

    let state = Config::runtime().await.data_arc().dns_override.clone();
    let mut outcome = DnsOverrideOutcome::Applied;
    // A subscription update can replace the file while Mihomo is validating it.
    if enabled && let Some(state) = state.filter(|state| !state.enabled) {
        verge.edit_draft(|draft| {
            draft
                .profile_dns_settings
                .insert(profile_uid, ProfileDnsSettings::default());
        });
        if let Some(source) = state.source {
            outcome = DnsOverrideOutcome::ConfirmationRequired { source };
        }
    }

    transaction.commit();
    Handle::refresh_verge();
    Handle::refresh_clash();
    verge.data_arc().save_file().await?;
    Ok(outcome)
}
