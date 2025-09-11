use std::{io, process::Command as StdCommand};

use deelevate::{PrivilegeLevel, Token};
use runas::Command as RunasCommand;

use crate::{
    error::{AppError, AppResult},
    utils::dirs,
};

pub async fn invoke_uwptools() -> AppResult<()> {
    let resource_dir = dirs::app_resources_dir()?;
    let tool_path = resource_dir.join("enableLoopback.exe");

    if !tool_path.exists() {
        return Err(AppError::Io(io::Error::new(
            io::ErrorKind::NotFound,
            "enableLoopback exe not found",
        )));
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;

    match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(tool_path).status()?,
        _ => StdCommand::new(tool_path).status()?,
    };

    Ok(())
}
