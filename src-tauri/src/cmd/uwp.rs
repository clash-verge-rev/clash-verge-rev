use crate::cmd::CmdResult;

/// Platform-specific implementation for UWP functionality
#[cfg(windows)]
mod platform {
    use crate::cmd::CmdResult;
    use crate::cmd::StringifyErr as _;
    use crate::core::win_uwp;

    pub fn invoke_uwp_tool() -> CmdResult {
        win_uwp::invoke_uwptools().stringify_err()
    }
}

/// Stub implementation for non-Windows platforms
#[cfg(not(windows))]
mod platform {
    use super::CmdResult;

    #[allow(clippy::unnecessary_wraps)]
    pub const fn invoke_uwp_tool() -> CmdResult {
        Ok(())
    }
}

/// Command exposed to Tauri
#[tauri::command]
pub async fn invoke_uwp_tool() -> CmdResult {
    platform::invoke_uwp_tool()
}
