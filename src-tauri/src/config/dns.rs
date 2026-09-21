use anyhow::Result;
use clash_verge_draft::DraftTransaction;
use serde_yaml_ng::{Mapping, Value};
use sha2::{Digest as _, Sha256};
use smartstring::alias::String;
use std::sync::atomic::{AtomicBool, Ordering};

use super::{Config, IVerge};
use crate::core::handle::Handle;

static PENDING_DNS_OVERRIDE_NOTICE: AtomicBool = AtomicBool::new(false);

pub(crate) fn take_dns_override_notice() -> bool {
    PENDING_DNS_OVERRIDE_NOTICE.swap(false, Ordering::Relaxed)
}

const PROVIDER_DNS_FIELDS: [&str; 3] = [
    "proxy-server-nameserver",
    "proxy-server-nameserver-policy",
    "nameserver-policy",
];

pub(crate) fn dns_override_source(profile_uid: &str, config: &Mapping) -> Result<Option<String>> {
    let Some(dns) = config.get("dns").and_then(Value::as_mapping) else {
        return Ok(None);
    };
    let fields: Mapping = PROVIDER_DNS_FIELDS
        .iter()
        .filter_map(|key| {
            let value = dns.get(*key)?;
            let nonempty = match value {
                Value::Sequence(values) => !values.is_empty(),
                Value::Mapping(values) => !values.is_empty(),
                Value::String(value) => !value.trim().is_empty(),
                _ => false,
            };
            nonempty.then(|| (Value::from(*key), value.clone()))
        })
        .collect();
    if fields.is_empty() {
        return Ok(None);
    }

    let mut canonical = serde_json::to_value(fields)?;
    canonical.sort_all_objects();
    let mut digest = Sha256::new();
    digest.update(profile_uid.as_bytes());
    digest.update([0]);
    digest.update(serde_json::to_vec(&canonical)?);
    Ok(Some(
        digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect(),
    ))
}

#[derive(Debug, Clone)]
pub(crate) struct DnsOverrideState {
    pub source: Option<String>,
    pub enabled: bool,
    requested: bool,
    confirmation: Option<String>,
}

impl DnsOverrideState {
    pub fn new(source: Option<String>, requested: bool, confirmation: Option<String>) -> Self {
        let enabled = requested && (source.is_none() || source == confirmation);
        Self {
            source,
            enabled,
            requested,
            confirmation,
        }
    }

    fn apply_to(&self, verge: &mut IVerge) -> bool {
        // A later settings write must not be overwritten by an earlier runtime generation.
        if verge.enable_dns_settings.unwrap_or(false) != self.requested
            || verge.dns_override_confirmation != self.confirmation
        {
            return false;
        }
        let clear_confirmation = self.confirmation.is_some() && self.source != self.confirmation;
        if self.enabled == self.requested && !clear_confirmation {
            return false;
        }
        verge.enable_dns_settings = Some(self.enabled);
        if clear_confirmation {
            verge.dns_override_confirmation = None;
        }
        true
    }
}

impl Config {
    pub(crate) async fn sync_dns_override() -> Result<()> {
        let _config_write = Self::lock_config_write().await;
        let state = Self::runtime().await.data_arc().dns_override.clone();
        let Some(state) = state else {
            return Ok(());
        };
        let verge = Self::verge().await;
        let transaction = DraftTransaction::begin(vec![&verge])?;
        if !verge.edit_draft(|draft| state.apply_to(draft)) {
            return Ok(());
        }
        // The runtime is already committed; a disk failure cannot undo its effective settings.
        transaction.commit();
        Handle::refresh_verge();
        if state.requested && !state.enabled {
            PENDING_DNS_OVERRIDE_NOTICE.store(true, Ordering::Relaxed);
            Handle::notice_message("dns_override::auto_disabled", "");
        }
        verge.data_arc().save_file().await
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::{DnsOverrideState, dns_override_source};
    use crate::config::IVerge;
    use anyhow::Result;
    use serde_yaml_ng::Mapping;

    fn mapping(yaml: &str) -> Mapping {
        serde_yaml_ng::from_str(yaml).expect("valid fixture")
    }

    #[test]
    fn dns_override_detects_each_original_field_but_not_empty_placeholders() -> Result<()> {
        for field in [
            "proxy-server-nameserver: [https://doh.pub/dns-query]",
            "proxy-server-nameserver-policy: {'www.yournode.com': '114.114.114.114'}",
            "nameserver-policy: {'+.quandao.com': ['https://doh.dohcore.com:2096/dns-query/#skip-cert-verify=true']}",
        ] {
            assert!(dns_override_source("profile", &mapping(&format!("dns: {{{field}}}")))?.is_some());
            assert!(dns_override_source("profile", &mapping(field))?.is_none());
        }
        for yaml in [
            "{}",
            "dns: {nameserver: [1.1.1.1]}",
            "dns: {proxy-server-nameserver: [], proxy-server-nameserver-policy: null, nameserver-policy: {}}",
        ] {
            assert!(dns_override_source("profile", &mapping(yaml))?.is_none());
        }
        Ok(())
    }

    #[test]
    fn dns_override_confirmation_survives_formatting_but_not_a_different_source() -> Result<()> {
        let original = mapping("dns: {nameserver-policy: {a.example: 1.1.1.1, b.example: [8.8.8.8]}}");
        let source = dns_override_source("one", &original)?;
        let reordered =
            mapping("dns:\n  nameserver-policy:\n    b.example: [8.8.8.8]\n    a.example: 1.1.1.1\nport: 7890");
        assert_eq!(source, dns_override_source("one", &reordered)?);
        assert!(DnsOverrideState::new(source.clone(), true, source.clone()).enabled);
        assert!(!DnsOverrideState::new(dns_override_source("two", &original)?, true, source.clone()).enabled);
        let changed = mapping("dns: {nameserver-policy: {a.example: 9.9.9.9, b.example: [8.8.8.8]}}");
        assert!(!DnsOverrideState::new(dns_override_source("one", &changed)?, true, source).enabled);
        Ok(())
    }

    #[test]
    fn dns_override_confirmation_expires_on_restart() -> Result<()> {
        let source = Some("provider-dns".into());
        let confirmed = IVerge {
            enable_dns_settings: Some(true),
            dns_override_confirmation: source.clone(),
            ..IVerge::default()
        };
        assert!(DnsOverrideState::new(source.clone(), true, confirmed.dns_override_confirmation.clone()).enabled);
        for saved in [
            serde_yaml_ng::to_string(&confirmed)?,
            "enable_dns_settings: true\ndns_override_confirmation: provider-dns".to_owned(),
        ] {
            let mut restarted: IVerge = serde_yaml_ng::from_str(&saved)?;
            let state = DnsOverrideState::new(
                source.clone(),
                restarted.enable_dns_settings.unwrap_or(false),
                restarted.dns_override_confirmation.clone(),
            );
            assert!(!state.enabled, "a previous session must not bypass startup protection");
            assert!(state.apply_to(&mut restarted));
            assert_eq!(restarted.enable_dns_settings, Some(false));
        }
        Ok(())
    }

    #[test]
    fn dns_override_applies_only_to_current_preferences() {
        let mut verge = IVerge {
            enable_dns_settings: Some(true),
            ..IVerge::default()
        };
        let state = DnsOverrideState::new(Some("provider-dns".into()), true, None);
        assert!(state.apply_to(&mut verge));
        assert_eq!(verge.enable_dns_settings, Some(false));
        assert!(!state.apply_to(&mut verge));
        let disabled = DnsOverrideState::new(None, false, None);
        assert!(!disabled.apply_to(&mut verge));
        assert!(!disabled.enabled);

        verge.enable_dns_settings = Some(true);
        verge.dns_override_confirmation = Some("provider-dns".into());
        assert!(!state.apply_to(&mut verge));
        assert_eq!(verge.enable_dns_settings, Some(true));
        assert_eq!(verge.dns_override_confirmation.as_deref(), Some("provider-dns"));
        let leaving = DnsOverrideState::new(None, true, verge.dns_override_confirmation.clone());
        assert!(leaving.apply_to(&mut verge));
        assert!(verge.dns_override_confirmation.is_none());
    }
}
