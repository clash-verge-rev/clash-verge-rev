#[cfg(target_os = "linux")]
pub fn linux_elevator() -> &'static str {
    use std::process::Command;
    match Command::new("which").arg("pkexec").output() {
        Ok(output) => {
            if output.stdout.is_empty() {
                "sudo"
            } else {
                "pkexec"
            }
        }
        Err(_) => "sudo",
    }
}
