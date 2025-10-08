use anyhow::Result;
use tauri_plugin_shell::process::CommandChild;

#[derive(Debug)]
pub struct CommandChildGuard(Option<CommandChild>);

impl Drop for CommandChildGuard {
    fn drop(&mut self) {
        if let Err(err) = self.kill() {
            log::error!(target: "app", "Failed to kill child process: {}", err);
        }
    }
}

impl CommandChildGuard {
    pub fn new(child: CommandChild) -> Self {
        Self(Some(child))
    }

    pub fn kill(&mut self) -> Result<()> {
        if let Some(child) = self.0.take() {
            let _ = child.kill();
        }
        Ok(())
    }

    pub fn pid(&self) -> Option<u32> {
        self.0.as_ref().map(|c| c.pid())
    }
}
