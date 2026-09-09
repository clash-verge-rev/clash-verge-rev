use anyhow::Result;
use clash_verge_draft::DraftTransaction;
use serde::Serialize;
use smartstring::alias::String;

use crate::{
    config::{Config, dns::dns_override_source, profiles::PROFILE_WRITE_LOCK},
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

pub async fn set_dns_override(enabled: bool, confirmation: Option<String>) -> Result<DnsOverrideOutcome> {
    let _profile_write = PROFILE_WRITE_LOCK.lock().await;
    let _config_write = Config::lock_config_write().await;
    let profiles = Config::profiles().await.data_arc();
    let source = dns_override_source(
        profiles.current.as_deref().unwrap_or_default(),
        &profiles.current_mapping().await?,
    )?;
    if enabled && let Some(source) = source.as_ref().filter(|source| Some(*source) != confirmation.as_ref()) {
        return Ok(DnsOverrideOutcome::ConfirmationRequired { source: source.clone() });
    }

    if enabled {
        let content = tokio::fs::read_to_string(dirs::app_home_dir()?.join(DNS_CONFIG)).await?;
        serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&content)?;
    }

    let verge = Config::verge().await;
    let transaction = DraftTransaction::begin(vec![&verge])?;
    verge.edit_draft(|draft| {
        draft.enable_dns_settings = Some(enabled);
        draft.dns_override_confirmation = if enabled { source } else { None };
    });
    CoreManager::global().update_config_checked().await?;

    let state = Config::runtime().await.data_arc().dns_override.clone();
    let mut outcome = DnsOverrideOutcome::Applied;
    // A subscription update can replace the file while Mihomo is validating it.
    if enabled && let Some(state) = state.filter(|state| !state.enabled) {
        verge.edit_draft(|draft| {
            draft.enable_dns_settings = Some(false);
            draft.dns_override_confirmation = None;
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
