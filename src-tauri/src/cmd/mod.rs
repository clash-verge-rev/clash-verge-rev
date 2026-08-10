use anyhow::Result;
use smartstring::alias::String;

pub type CmdResult<T = ()> = Result<T, String>;

const USER_ERROR_PREFIX: &str = "CVR_ERROR:";

pub fn coded_error(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{USER_ERROR_PREFIX}{code}\n{detail}").into()
}

/// Prefer an actionable proxy classification over the operation's fallback code.
pub fn proxy_aware_coded_error(error: &anyhow::Error, fallback: &str) -> String {
    let code =
        crate::core::proxy_control::SysproxyFailure::from_chain(error).map_or(fallback, |failure| failure.code());
    coded_error(code, format_args!("{error:#}"))
}

/// Preserve uncoded failures unless the chain contains a proxy classification.
pub fn proxy_aware_error(error: &anyhow::Error) -> String {
    match crate::core::proxy_control::SysproxyFailure::from_chain(error) {
        Some(failure) => coded_error(failure.code(), format_args!("{error:#}")),
        None => format!("{error:#}").into(),
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
        self.map_err(|e| e.to_string().into())
    }

    fn stringify_err_log<F>(self, log_fn: F) -> CmdResult<T>
    where
        F: Fn(&str),
    {
        self.map_err(|e| {
            let msg = String::from(e.to_string());
            log_fn(&msg);
            msg
        })
    }
}

impl<T, E: std::fmt::Display> WithErrorCode<T> for Result<T, E> {
    fn with_error_code(self, code: &str) -> CmdResult<T> {
        // Alternate formatting expands the full `anyhow` context chain.
        self.map_err(|error| coded_error(code, format_args!("{error:#}")))
    }
}

#[cfg(test)]
mod tests {
    use super::{WithErrorCode as _, coded_error, proxy_aware_coded_error, proxy_aware_error};
    use crate::core::proxy_control::SysproxyFailure;
    use anyhow::Context as _;

    #[test]
    fn coded_error_preserves_stable_code_and_diagnostic_detail() {
        assert_eq!(
            coded_error("CORE_RESTART_FAILED", "connection refused"),
            "CVR_ERROR:CORE_RESTART_FAILED\nconnection refused"
        );
    }

    #[test]
    fn with_error_code_preserves_whole_anyhow_context_chain() {
        let source: anyhow::Result<()> = Err(anyhow::anyhow!("connection refused"))
            .context("failed to reach the mihomo core")
            .context("failed to restart the core");

        let detail = source.with_error_code("CORE_RESTART_FAILED").err().unwrap_or_default();

        assert_eq!(
            detail,
            "CVR_ERROR:CORE_RESTART_FAILED\n\
             failed to restart the core: failed to reach the mihomo core: connection refused"
        );
    }

    #[test]
    fn with_error_code_leaves_plain_display_errors_untouched() {
        let source: Result<(), &str> = Err("plain failure");

        let detail = source.with_error_code("PROFILE_READ_FAILED").err().unwrap_or_default();

        assert_eq!(detail, "CVR_ERROR:PROFILE_READ_FAILED\nplain failure");
    }

    #[test]
    fn a_classification_outranks_the_code_naming_the_operation() {
        let failure = anyhow::Error::new(sysproxy::Error::RequiresAdminPrivileges)
            .context(SysproxyFailure::PrivilegeRequired)
            .context("failed to restart the core");

        let reported = proxy_aware_coded_error(&failure, "CORE_RESTART_FAILED");

        assert!(
            reported.starts_with("CVR_ERROR:SYSPROXY_PRIVILEGE_REQUIRED\n"),
            "{reported}"
        );
        assert!(reported.contains("failed to restart the core"), "{reported}");
        assert!(reported.contains("admin privileges"), "{reported}");
    }

    #[test]
    fn without_a_classification_the_callers_code_is_used() {
        let failure = anyhow::anyhow!("connection refused").context("failed to start the core");

        let reported = proxy_aware_coded_error(&failure, "CORE_START_FAILED");

        assert_eq!(
            reported,
            "CVR_ERROR:CORE_START_FAILED\nfailed to start the core: connection refused"
        );
    }

    #[test]
    fn commands_that_report_plain_text_stay_uncoded_without_a_classification() {
        let failure = anyhow::anyhow!("disk full").context("failed to save the configuration");

        let reported = proxy_aware_error(&failure);

        assert!(!reported.starts_with("CVR_ERROR:"), "{reported}");
        assert_eq!(reported, "failed to save the configuration: disk full");
    }

    #[test]
    fn commands_that_report_plain_text_still_carry_a_classification() {
        let failure = anyhow::Error::new(SysproxyFailure::DirectFallback {
            detail: "service could not set the proxy".to_owned(),
        })
        .context("failed to apply the verge patch");

        let reported = proxy_aware_error(&failure);

        assert!(
            reported.starts_with("CVR_ERROR:SYSPROXY_DIRECT_FALLBACK\n"),
            "{reported}"
        );
        assert!(reported.contains("failed to apply the verge patch"), "{reported}");
        assert!(reported.contains("service could not set the proxy"), "{reported}");
    }
}
