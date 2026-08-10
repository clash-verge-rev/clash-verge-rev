use anyhow::Result;
use smartstring::alias::String;

pub type CmdResult<T = ()> = Result<T, CommandFailure>;

/// Structured command failure returned to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CommandFailure {
    /// Stable frontend identifier, when classified.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<std::string::String>,
    /// Human-readable diagnostic detail.
    pub detail: std::string::String,
}

impl CommandFailure {
    /// A failure with a stable code.
    pub fn coded(code: &str, detail: impl std::fmt::Display) -> Self {
        Self {
            code: Some(code.to_owned()),
            detail: detail.to_string(),
        }
    }

    /// A failure with nothing to classify it by.
    pub fn plain(detail: impl std::fmt::Display) -> Self {
        Self {
            code: None,
            detail: detail.to_string(),
        }
    }
}

/// Preserve plain-string failures without inventing a code.
impl From<&str> for CommandFailure {
    fn from(detail: &str) -> Self {
        Self::plain(detail)
    }
}

impl From<std::string::String> for CommandFailure {
    fn from(detail: std::string::String) -> Self {
        Self { code: None, detail }
    }
}

impl From<String> for CommandFailure {
    fn from(detail: String) -> Self {
        Self::plain(detail)
    }
}

impl std::fmt::Display for CommandFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.detail)
    }
}

pub fn coded_error(code: &str, detail: impl std::fmt::Display) -> CommandFailure {
    CommandFailure::coded(code, detail)
}

/// Prefer an actionable proxy classification over the operation's fallback code.
pub fn proxy_aware_coded_error(error: &anyhow::Error, fallback: &str) -> CommandFailure {
    let code =
        crate::core::proxy_control::SysproxyFailure::from_chain(error).map_or(fallback, |failure| failure.code());
    CommandFailure::coded(code, format_args!("{error:#}"))
}

/// Preserve uncoded failures unless the chain contains a proxy classification.
pub fn proxy_aware_error(error: &anyhow::Error) -> CommandFailure {
    match crate::core::proxy_control::SysproxyFailure::from_chain(error) {
        Some(failure) => CommandFailure::coded(failure.code(), format_args!("{error:#}")),
        None => CommandFailure::plain(format_args!("{error:#}")),
    }
}

// Command modules
pub mod app;
pub mod backup;
pub mod clash;
pub mod lightweight;
pub mod listener;
pub mod media_unlock_checker;
pub mod network;
pub mod profile;
pub mod proxy;
pub mod runtime;
pub mod save_profile;
pub mod service;
pub mod system;
pub mod uwp;
pub mod validate;
pub mod verge;
pub mod webdav;

// Re-export all command functions for backwards compatibility
pub use app::*;
pub use backup::*;
pub use clash::*;
pub use lightweight::*;
pub use listener::*;
pub use media_unlock_checker::*;
pub use network::*;
pub use profile::*;
pub use proxy::*;
pub use runtime::*;
pub use save_profile::*;
pub use service::*;
pub use system::*;
pub use uwp::*;
pub use validate::*;
pub use verge::*;
pub use webdav::*;

pub trait StringifyErr<T> {
    fn stringify_err(self) -> CmdResult<T>;
    fn stringify_err_log<F>(self, log_fn: F) -> CmdResult<T>
    where
        F: Fn(&str);
}

pub trait WithErrorCode<T> {
    fn with_error_code(self, code: &str) -> CmdResult<T>;
}

impl<T, E: std::fmt::Display> StringifyErr<T> for Result<T, E> {
    fn stringify_err(self) -> CmdResult<T> {
        self.map_err(CommandFailure::plain)
    }

    fn stringify_err_log<F>(self, log_fn: F) -> CmdResult<T>
    where
        F: Fn(&str),
    {
        self.map_err(|e| {
            let failure = CommandFailure::plain(e);
            log_fn(&failure.detail);
            failure
        })
    }
}

impl<T, E: std::fmt::Display> WithErrorCode<T> for Result<T, E> {
    fn with_error_code(self, code: &str) -> CmdResult<T> {
        // Alternate formatting expands the full `anyhow` context chain.
        self.map_err(|error| CommandFailure::coded(code, format_args!("{error:#}")))
    }
}

#[cfg(test)]
mod tests {
    use super::{CommandFailure, WithErrorCode as _, coded_error, proxy_aware_coded_error, proxy_aware_error};
    use crate::core::proxy_control::SysproxyFailure;
    use anyhow::Context as _;

    #[test]
    fn coded_error_preserves_stable_code_and_diagnostic_detail() {
        assert_eq!(
            coded_error("CORE_RESTART_FAILED", "connection refused"),
            CommandFailure {
                code: Some("CORE_RESTART_FAILED".to_owned()),
                detail: "connection refused".to_owned(),
            }
        );
    }

    #[test]
    fn with_error_code_preserves_whole_anyhow_context_chain() {
        let source: anyhow::Result<()> = Err(anyhow::anyhow!("connection refused"))
            .context("failed to reach the mihomo core")
            .context("failed to restart the core");

        let failure = source
            .with_error_code("CORE_RESTART_FAILED")
            .err()
            .unwrap_or_else(|| CommandFailure::plain("the call should have failed"));

        assert_eq!(
            failure,
            CommandFailure {
                code: Some("CORE_RESTART_FAILED".to_owned()),
                detail: "failed to restart the core: failed to reach the mihomo core: connection refused".to_owned(),
            }
        );
    }

    #[test]
    fn with_error_code_leaves_plain_display_errors_untouched() {
        let source: Result<(), &str> = Err("plain failure");

        let failure = source
            .with_error_code("PROFILE_READ_FAILED")
            .err()
            .unwrap_or_else(|| CommandFailure::plain("the call should have failed"));

        assert_eq!(
            failure,
            CommandFailure {
                code: Some("PROFILE_READ_FAILED".to_owned()),
                detail: "plain failure".to_owned(),
            }
        );
    }

    #[test]
    fn a_classification_outranks_the_code_naming_the_operation() {
        let failure = anyhow::Error::new(sysproxy::Error::RequiresAdminPrivileges)
            .context(SysproxyFailure::PrivilegeRequired)
            .context("failed to restart the core");

        let reported = proxy_aware_coded_error(&failure, "CORE_RESTART_FAILED");

        assert_eq!(reported.code.as_deref(), Some("SYSPROXY_PRIVILEGE_REQUIRED"));
        assert!(reported.detail.contains("failed to restart the core"), "{reported:?}");
        assert!(reported.detail.contains("admin privileges"), "{reported:?}");
    }

    #[test]
    fn without_a_classification_the_callers_code_is_used() {
        let failure = anyhow::anyhow!("connection refused").context("failed to start the core");

        let reported = proxy_aware_coded_error(&failure, "CORE_START_FAILED");

        assert_eq!(
            reported,
            CommandFailure {
                code: Some("CORE_START_FAILED".to_owned()),
                detail: "failed to start the core: connection refused".to_owned(),
            }
        );
    }

    #[test]
    fn commands_that_report_plain_text_stay_uncoded_without_a_classification() {
        let failure = anyhow::anyhow!("disk full").context("failed to save the configuration");

        let reported = proxy_aware_error(&failure);

        assert_eq!(
            reported,
            CommandFailure {
                code: None,
                detail: "failed to save the configuration: disk full".to_owned(),
            }
        );
    }

    #[test]
    fn commands_that_report_plain_text_still_carry_a_classification() {
        let failure = anyhow::Error::new(SysproxyFailure::DirectFallback {
            detail: "service could not set the proxy".to_owned(),
        })
        .context("failed to apply the verge patch");

        let reported = proxy_aware_error(&failure);

        assert_eq!(reported.code.as_deref(), Some("SYSPROXY_DIRECT_FALLBACK"));
        assert!(
            reported.detail.contains("failed to apply the verge patch"),
            "{reported:?}"
        );
        assert!(
            reported.detail.contains("service could not set the proxy"),
            "{reported:?}"
        );
    }

    #[test]
    fn the_serialised_shape_is_what_the_frontend_reads() {
        assert_eq!(
            serde_json::to_value(CommandFailure::coded("CORE_START_FAILED", "connection refused"))
                .unwrap_or(serde_json::Value::Null),
            serde_json::json!({ "code": "CORE_START_FAILED", "detail": "connection refused" })
        );

        assert_eq!(
            serde_json::to_value(CommandFailure::plain("disk full")).unwrap_or(serde_json::Value::Null),
            serde_json::json!({ "detail": "disk full" })
        );
    }
}
