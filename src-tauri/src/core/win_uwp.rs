#![cfg(target_os = "windows")]

use crate::utils::dirs;
use anyhow::{bail, Result};
use std::ffi::OsString;
use std::os::windows::ffi::OsStrExt;
use winapi::um::shellapi::ShellExecuteW;
use winapi::um::winuser::SW_SHOWNORMAL;
use winapi::shared::windef::HWND;
use winapi::shared::minwindef::UINT;

pub async fn invoke_uwptools() -> Result<()> {
    let resource_dir = dirs::app_resources_dir()?;
    let tool_path = resource_dir.join("enableLoopback.exe");

    if !tool_path.exists() {
        bail!("enableLoopback exe not found");
    }

    let exe_path: Vec<u16> = tool_path.as_os_str()
        .encode_wide()
        .chain(Some(0).into_iter())
        .collect();

    let verb: Vec<u16> = OsString::from("runas").encode_wide()
        .chain(Some(0).into_iter())
        .collect();

    // 使用 ShellExecuteW 以管理员权限运行
    unsafe {
        let result = ShellExecuteW(
            std::ptr::null_mut() as HWND,
            verb.as_ptr(),
            exe_path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL
        );

        let result_code = result as UINT;
        if result_code <= 32 {
            match result_code {
                1223 => bail!("UAC prompt was cancelled by user"), // SE_ERR_CANCELLED
                31 => bail!("No application associated with the specified file"), // SE_ERR_NOASSOC
                _ => bail!("Failed to run with administrator privileges: {}", result_code),
            }
        }
    }

    Ok(())
}
