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

pub fn is_wayland() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var("XDG_SESSION_TYPE").is_ok_and(|session| session.to_lowercase() == "wayland")
    } else {
        false
    }
}
