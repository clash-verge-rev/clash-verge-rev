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

#[cfg(target_os = "linux")]
pub fn is_rendered_by_nvidia_only() -> bool {
    use std::process::Command;

    let output = Command::new("bash").args(["-c", "lspci | grep -i vga"]).output();
    match output {
        Ok(output) => {
            if output.stdout.is_empty() {
                false
            } else {
                let output_str = String::from_utf8_lossy(&output.stdout);
                let vgas = output_str.trim().split("\n").collect::<Vec<&str>>();
                tracing::debug!("Vga Output: {:#?}", vgas);
                vgas.len() == 1 && String::from_utf8_lossy(&output.stdout).contains("NVIDIA")
            }
        }
        Err(_) => false,
    }
}
