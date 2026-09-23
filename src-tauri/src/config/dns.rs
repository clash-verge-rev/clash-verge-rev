use anyhow::Result;
use clash_verge_draft::DraftTransaction;
use serde::{Deserialize, Serialize};
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
    profile_uid: String,
    pub source: Option<String>,
    pub enabled: bool,
    requested: bool,
    confirmation: Option<String>,
    allow_dns_override: bool,
}

impl DnsOverrideState {
    pub fn new(
        profile_uid: &str,
        source: Option<String>,
        requested: bool,
        confirmation: Option<String>,
        allow_dns_override: bool,
    ) -> Self {
        let enabled = requested && (allow_dns_override || source.is_none() || source == confirmation);
        Self {
            profile_uid: profile_uid.into(),
            source,
            enabled,
            requested,
            confirmation,
            allow_dns_override,
        }
    }

    fn apply_to(&self, verge: &mut IVerge, allow_dns_override: bool) -> bool {
        if self.profile_uid.is_empty() || self.allow_dns_override != allow_dns_override {
            return false;
        }
        let settings = verge.dns_settings_for(&self.profile_uid, self.allow_dns_override);
        // A later settings write must not be overwritten by an earlier runtime generation.
        if (settings.enabled, settings.confirmation.as_ref()) != (self.requested, self.confirmation.as_ref()) {
            return false;
        }
        let clear_confirmation = self.confirmation.is_some() && self.source != self.confirmation;
        if self.enabled == self.requested
            && !clear_confirmation
            && verge.profile_dns_settings.contains_key(&self.profile_uid)
        {
            return false;
        }
        verge.profile_dns_settings.insert(
            self.profile_uid.clone(),
            ProfileDnsSettings {
                enabled: self.enabled,
                confirmation: if clear_confirmation {
                    None
                } else {
                    self.confirmation.clone()
                },
            },
        );
        true
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ProfileDnsSettings {
    pub enabled: bool,
    // Force-enable confirmation is valid only for the current app session.
    #[serde(skip)]
    pub confirmation: Option<String>,
}

impl IVerge {
    pub(crate) fn dns_settings_for(&self, profile_uid: &str, allow_dns_override: bool) -> ProfileDnsSettings {
        self.profile_dns_settings
            .get(profile_uid)
            .cloned()
            .unwrap_or(ProfileDnsSettings {
                enabled: allow_dns_override || self.enable_dns_settings.unwrap_or(false),
                confirmation: None,
            })
    }
}

impl Config {
    pub(crate) async fn sync_dns_override() -> Result<()> {
        let _config_write = Self::lock_config_write().await;
        let state = Self::runtime().await.data_arc().dns_override.clone();
        let Some(state) = state else {
            return Ok(());
        };
        let allow_dns_override = Self::profiles()
            .await
            .data_arc()
            .get_item(&state.profile_uid)
            .is_ok_and(|profile| profile.allows_dns_override());
        let verge = Self::verge().await;
        let transaction = DraftTransaction::begin(vec![&verge])?;
        if !verge.edit_draft(|draft| state.apply_to(draft, allow_dns_override)) {
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
    use super::{DnsOverrideState, ProfileDnsSettings, dns_override_source};
    use crate::config::{IProfiles, IVerge, PrfOption};
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
        assert!(DnsOverrideState::new("one", source.clone(), true, source.clone(), false).enabled);
        assert!(
            !DnsOverrideState::new(
                "two",
                dns_override_source("two", &original)?,
                true,
                source.clone(),
                false
            )
            .enabled
        );
        let changed = mapping("dns: {nameserver-policy: {a.example: 9.9.9.9, b.example: [8.8.8.8]}}");
        assert!(!DnsOverrideState::new("one", dns_override_source("one", &changed)?, true, source, false).enabled);
        Ok(())
    }

    #[test]
    fn dns_override_confirmation_expires_on_restart() -> Result<()> {
        let source = Some("provider-dns".into());
        let confirmed = IVerge {
            profile_dns_settings: [(
                "one".into(),
                ProfileDnsSettings {
                    enabled: true,
                    confirmation: source.clone(),
                },
            )]
            .into(),
            ..IVerge::default()
        };
        let settings = confirmed.dns_settings_for("one", false);
        assert!(DnsOverrideState::new("one", source.clone(), settings.enabled, settings.confirmation, false).enabled);
        for saved in [
            serde_yaml_ng::to_string(&confirmed)?,
            "enable_dns_settings: true\ndns_override_confirmation: provider-dns".to_owned(),
        ] {
            let mut restarted: IVerge = serde_yaml_ng::from_str(&saved)?;
            let settings = restarted.dns_settings_for("one", false);
            let state = DnsOverrideState::new("one", source.clone(), settings.enabled, settings.confirmation, false);
            assert!(!state.enabled, "a previous session must not bypass startup protection");
            assert!(state.apply_to(&mut restarted, false));
            assert!(!restarted.dns_settings_for("one", false).enabled);
        }
        Ok(())
    }

    #[test]
    fn persistent_dns_permission_survives_restart_and_source_changes() -> Result<()> {
        let profiles: IProfiles = serde_yaml_ng::from_str(
            "current: one\nitems:\n  - uid: one\n    option: {allow_dns_override: true}\n  - uid: two\n",
        )?;
        let profiles: IProfiles = serde_yaml_ng::from_str(&serde_yaml_ng::to_string(&profiles)?)?;
        let mut verge: IVerge = serde_yaml_ng::from_str("profile_dns_settings: {one: {enabled: true}}")?;
        let profile = profiles.get_item("one")?;
        assert!(profile.allows_dns_override());
        assert!(!profiles.get_item("two")?.allows_dns_override());
        assert!(IVerge::default().dns_settings_for("one", true).enabled);
        for source in ["provider-dns", "updated-provider-dns"] {
            let settings = verge.dns_settings_for("one", profile.allows_dns_override());
            let state = DnsOverrideState::new(
                "one",
                Some(source.into()),
                settings.enabled,
                settings.confirmation,
                profile.allows_dns_override(),
            );
            assert!(state.enabled);
            assert!(!state.apply_to(&mut verge, true));
        }
        verge
            .profile_dns_settings
            .insert("one".into(), ProfileDnsSettings::default());
        let restarted: IVerge = serde_yaml_ng::from_str(&serde_yaml_ng::to_string(&verge)?)?;
        let settings = restarted.dns_settings_for("one", profile.allows_dns_override());
        let disabled = DnsOverrideState::new(
            "one",
            Some("provider-dns".into()),
            settings.enabled,
            settings.confirmation,
            profile.allows_dns_override(),
        );
        assert!(!disabled.enabled, "persistent permission must respect a manual disable");
        let protected = DnsOverrideState::new(
            "two",
            Some("provider-dns".into()),
            true,
            None,
            profiles.get_item("two")?.allows_dns_override(),
        );
        assert!(!protected.enabled);
        Ok(())
    }

    #[test]
    fn subscription_option_updates_preserve_or_explicitly_revoke_dns_permission() {
        let existing = PrfOption {
            allow_dns_override: Some(true),
            ..PrfOption::default()
        };
        for update in [None, Some(PrfOption::default())] {
            let merged = PrfOption::merge(Some(&existing), update.as_ref()).expect("existing options");
            assert_eq!(merged.allow_dns_override, Some(true));
        }
        let revoked = PrfOption {
            allow_dns_override: Some(false),
            ..PrfOption::default()
        };
        let merged = PrfOption::merge(Some(&existing), Some(&revoked)).expect("existing options");
        assert_eq!(merged.allow_dns_override, Some(false));
    }

    #[test]
    fn dns_override_applies_only_to_current_preferences() {
        let mut verge = IVerge {
            enable_dns_settings: Some(true),
            ..IVerge::default()
        };
        let state = DnsOverrideState::new("one", Some("provider-dns".into()), true, None, false);
        assert!(!state.apply_to(&mut verge, true));
        assert!(verge.dns_settings_for("one", false).enabled);
        assert!(state.apply_to(&mut verge, false));
        assert!(!verge.dns_settings_for("one", false).enabled);
        assert!(!state.apply_to(&mut verge, false));
        let disabled = DnsOverrideState::new("one", None, false, None, false);
        assert!(!disabled.apply_to(&mut verge, false));
        assert!(!disabled.enabled);

        verge.profile_dns_settings.insert(
            "one".into(),
            ProfileDnsSettings {
                enabled: true,
                confirmation: Some("provider-dns".into()),
            },
        );
        assert!(!state.apply_to(&mut verge, false));
        let settings = verge.dns_settings_for("one", false);
        assert!(settings.enabled);
        assert_eq!(settings.confirmation.as_deref(), Some("provider-dns"));
        let leaving = DnsOverrideState::new("one", None, true, settings.confirmation, false);
        assert!(leaving.apply_to(&mut verge, false));
        assert!(verge.dns_settings_for("one", false).confirmation.is_none());
    }

    #[test]
    fn automatic_disable_is_saved_only_for_the_affected_profile() -> Result<()> {
        let mut verge = IVerge {
            enable_dns_settings: Some(true),
            ..IVerge::default()
        };
        let first = DnsOverrideState::new("one", None, true, None, false);
        assert!(first.apply_to(&mut verge, false));
        let protected = DnsOverrideState::new("two", Some("provider-dns".into()), true, None, false);
        assert!(protected.apply_to(&mut verge, false));
        assert!(verge.dns_settings_for("one", false).enabled);
        assert!(!verge.dns_settings_for("two", false).enabled);
        assert!(verge.dns_settings_for("unvisited", false).enabled);
        assert_eq!(verge.enable_dns_settings, Some(true));
        let restarted: IVerge = serde_yaml_ng::from_str(&serde_yaml_ng::to_string(&verge)?)?;
        assert!(restarted.dns_settings_for("one", false).enabled);
        assert!(!restarted.dns_settings_for("two", false).enabled);
        Ok(())
    }

    #[test]
    fn switching_profiles_preserves_each_confirmation_until_its_source_changes() {
        let mut verge = IVerge::default();
        for uid in ["one", "two"] {
            verge.profile_dns_settings.insert(
                uid.into(),
                ProfileDnsSettings {
                    enabled: true,
                    confirmation: Some(uid.into()),
                },
            );
        }
        for uid in ["one", "two", "one"] {
            let settings = verge.dns_settings_for(uid, false);
            let state = DnsOverrideState::new(uid, Some(uid.into()), settings.enabled, settings.confirmation, false);
            assert!(state.enabled);
            assert!(!state.apply_to(&mut verge, false));
        }
        let settings = verge.dns_settings_for("two", false);
        let updated = DnsOverrideState::new(
            "two",
            Some("updated".into()),
            settings.enabled,
            settings.confirmation,
            false,
        );
        assert!(updated.apply_to(&mut verge, false));
        assert!(!verge.dns_settings_for("two", false).enabled);
        assert!(verge.dns_settings_for("two", false).confirmation.is_none());
        assert!(verge.dns_settings_for("one", false).enabled);
        assert_eq!(
            verge.dns_settings_for("one", false).confirmation.as_deref(),
            Some("one")
        );
    }
}
