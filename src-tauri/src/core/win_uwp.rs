#![cfg(target_os = "windows")]

use crate::{core::service, utils::dirs};
use anyhow::{Result, bail};

pub fn invoke_uwptools() -> Result<()> {
    let resource_dir = dirs::app_resources_dir()?;
    let tool_path = resource_dir.join("enableLoopback.exe");

    if !tool_path.exists() {
        bail!("enableLoopback exe not found");
    }

    service::run_maybe_elevated(&tool_path, false)?;

    Ok(())
}
