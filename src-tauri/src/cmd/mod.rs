use anyhow::Result;
use smartstring::alias::String;

pub type CmdResult<T = ()> = Result<T, String>;

const USER_ERROR_PREFIX: &str = "CVR_ERROR:";

pub fn coded_error(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{USER_ERROR_PREFIX}{code}\n{detail}").into()
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
    use super::{WithErrorCode as _, coded_error};
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
}
