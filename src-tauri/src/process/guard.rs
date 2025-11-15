use tauri_plugin_shell::process::CommandChild;

#[derive(Debug)]
pub struct CommandChildGuard(Option<CommandChild>);

impl Drop for CommandChildGuard {
    #[inline]
    fn drop(&mut self) {
        self.kill();
    }
}

impl CommandChildGuard {
    #[inline]
    pub const fn new(child: CommandChild) -> Self {
        Self(Some(child))
    }

    #[inline]
    pub fn kill(&mut self) {
        if let Some(child) = self.0.take() {
            let _ = child.kill();
        }
    }

    #[inline]
    pub fn pid(&self) -> Option<u32> {
        self.0.as_ref().map(|c| c.pid())
    }
}
