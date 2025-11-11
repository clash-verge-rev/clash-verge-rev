use anyhow::Result;
use tauri_plugin_shell::process::CommandChild;

use crate::{logging, utils::logging::Type};

#[derive(Debug)]
pub struct CommandChildGuard(Option<CommandChild>);

impl Drop for CommandChildGuard {
    #[inline]
    fn drop(&mut self) {
        if let Err(err) = self.kill() {
            logging!(
                error,
                Type::Service,
                "Failed to kill child process: {}",
                err
            );
        }
    }
}

impl CommandChildGuard {
    #[inline]
    pub const fn new(child: CommandChild) -> Self {
        Self(Some(child))
    }

    #[inline]
    pub fn kill(&mut self) -> Result<()> {
        if let Some(child) = self.0.take() {
            let _ = child.kill();
        }
        Ok(())
    }

    #[inline]
    pub fn pid(&self) -> Option<u32> {
        self.0.as_ref().map(|c| c.pid())
    }
}
