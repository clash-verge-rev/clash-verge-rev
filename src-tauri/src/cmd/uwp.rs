use super::CmdResult;

/// Platform-specific implementation for UWP functionality
#[cfg(windows)]
mod platform {
    use super::CmdResult;
    use crate::{core::win_uwp, wrap_err};

    pub async fn invoke_uwp_tool() -> CmdResult {
        wrap_err!(win_uwp::invoke_uwptools().await)
    }
}

/// Stub implementation for non-Windows platforms
#[cfg(not(windows))]
mod platform {
    use super::CmdResult;

    pub async fn invoke_uwp_tool() -> CmdResult {
        Ok(())
    }
}

/// Command exposed to Tauri
#[tauri::command]
pub async fn invoke_uwp_tool() -> CmdResult {
    platform::invoke_uwp_tool().await
}
