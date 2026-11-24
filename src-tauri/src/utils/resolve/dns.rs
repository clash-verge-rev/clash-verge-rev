use anyhow::{Context as _, bail, ensure};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::{Mapping, Value};
use std::{
    io::Read as _,
    os::unix::process::CommandExt as _,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

// Any address routed into TUN works, since dns-hijack answers it; the value only matters if left behind.
const PLACEHOLDER_DNS: &str = "114.114.114.114\n223.5.5.5\n1.1.1.1";
// Scripts run under lifecycle_lock, and networksetup waits for other preference writers without a limit.
pub(crate) const DNS_SCRIPT_TIMEOUT: Duration = Duration::from_secs(5);

static DNS_LOCK: Mutex<()> = Mutex::const_new(());

fn dns_state_dir() -> anyhow::Result<PathBuf> {
    // The DNS scripts persist their backups relative to their working directory.
    let dir = crate::utils::dirs::app_home_dir()?;
    std::fs::create_dir_all(&dir).with_context(|| format!("failed to create DNS state directory {}", dir.display()))?;
    Ok(dir)
}

fn needs_public_dns(config: &Mapping) -> bool {
    let section = |name: &str| config.get(name).and_then(Value::as_mapping);
    let (Some(tun), Some(dns)) = (section("tun"), section("dns")) else {
        return false;
    };
    let enabled = |section: &Mapping| section.get("enable").and_then(Value::as_bool) == Some(true);
    if !enabled(tun) || !enabled(dns) {
        return false;
    }

    match dns.get("enhanced-mode").and_then(Value::as_str) {
        Some("fake-ip") => true,
        Some("redir-host") => uses_legacy_tun_dns_hijack(tun),
        _ => false,
    }
}

fn uses_legacy_tun_dns_hijack(tun: &Mapping) -> bool {
    // Leave explicit TUN DNS modes to Mihomo. Without routing and interception,
    // the public DNS placeholders would be contacted directly instead.
    let legacy_mode = tun.get("dns-mode").is_none_or(|value| value.as_str() == Some(""));
    let auto_route = tun.get("auto-route").is_none_or(|value| value.as_bool() == Some(true));
    let hijacks_public_dns = match tun.get("dns-hijack") {
        // Mihomo defaults to the IPv4 wildcard when this setting is absent.
        None => true,
        Some(rules) => rules.as_sequence().is_some_and(|rules| {
            rules.iter().filter_map(Value::as_str).any(|rule| {
                let address = rule.split_once("://").map_or(rule, |(_, address)| address);
                matches!(address, "any:53" | "0.0.0.0:53")
            })
        }),
    };
    // Custom routes can send the public placeholders outside TUN.
    let default_routes = [
        "route-address",
        "route-exclude-address",
        "inet4-route-address",
        "inet4-route-exclude-address",
    ]
    .iter()
    .all(|key| {
        tun.get(*key)
            .is_none_or(|routes| routes.as_sequence().is_some_and(Vec::is_empty))
    });
    legacy_mode && auto_route && hijacks_public_dns && default_routes
}

/// Sets the placeholder DNS while the running config needs it, and restores the system DNS otherwise.
pub async fn sync_public_dns() {
    use crate::{
        config::Config,
        core::{CoreManager, handle::Handle, manager::RunningMode},
    };

    let _guard = DNS_LOCK.lock().await;
    // Exit cleanup restores DNS on its own budget; a sync queued behind it must not undo that.
    if Handle::global().is_exiting() {
        return;
    }
    let core_running = !matches!(*CoreManager::global().get_running_mode(), RunningMode::NotRunning);
    let runtime = Config::runtime().await.latest_arc();
    if core_running && runtime.config.as_ref().is_some_and(needs_public_dns) {
        set_public_dns().await;
    } else {
        let _ = unset_public_dns().await;
    }
}

pub async fn restore_public_dns() -> anyhow::Result<()> {
    let _guard = DNS_LOCK.lock().await;
    unset_public_dns().await
}

async fn set_public_dns() {
    logging!(debug, Type::Config, "try to set system dns");
    let result = run_dns_script("set_dns.sh", true).await;
    match result {
        Ok(DnsScriptOutcome::Complete) => logging!(info, Type::Config, "set system dns successfully"),
        Ok(DnsScriptOutcome::Deferred) => {
            logging!(debug, Type::Config, "system DNS waits for a primary network service")
        }
        Err(err) => logging!(error, Type::Config, "set system dns failed: {err:#}"),
    }
}

async fn unset_public_dns() -> anyhow::Result<()> {
    logging!(debug, Type::Config, "try to unset system dns");
    let result = run_dns_script("unset_dns.sh", false).await.map(|_| ());
    match &result {
        Ok(()) => logging!(info, Type::Config, "unset system dns successfully"),
        Err(err) => logging!(error, Type::Config, "unset system dns failed: {err:#}"),
    }
    result
}

enum DnsScriptOutcome {
    Complete,
    Deferred,
}

/// On timeout the script's whole process group is killed, so no networksetup it started writes late.
async fn run_dns_script(script_name: &str, allow_deferred: bool) -> anyhow::Result<DnsScriptOutcome> {
    let resource_dir = crate::utils::dirs::app_resources_dir()?;
    let script = resource_dir.join(script_name);
    let dir = dns_state_dir()?;
    ensure!(script.exists(), "DNS script not found: {}", script.display());
    let mut child = Command::new("bash")
        .arg(&script)
        .arg(PLACEHOLDER_DNS)
        .arg(resource_dir)
        .current_dir(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .with_context(|| format!("failed to run {}", script.display()))?;
    crate::process::AsyncHandler::spawn_blocking(move || {
        let deadline = Instant::now() + DNS_SCRIPT_TIMEOUT;
        let status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }
            if Instant::now() >= deadline {
                unsafe { libc::killpg(libc::pid_t::try_from(child.id())?, libc::SIGKILL) };
                child.wait()?;
                bail!("timed out after {} s", DNS_SCRIPT_TIMEOUT.as_secs());
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        let mut stderr = String::new();
        if let Some(mut pipe) = child.stderr.take() {
            pipe.read_to_string(&mut stderr)?;
        }
        // EX_TEMPFAIL is reserved by set_dns.sh for a network service that is not ready.
        if allow_deferred && status.code() == Some(75) {
            return Ok(DnsScriptOutcome::Deferred);
        }
        ensure!(
            status.success(),
            "exit code {}: {}",
            status.code().unwrap_or(-1),
            stderr.trim()
        );
        Ok(DnsScriptOutcome::Complete)
    })
    .await
    .context("DNS script task failed")?
}

#[cfg(test)]
mod tests {
    #[test]
    #[allow(clippy::expect_used)]
    fn public_dns_follows_tun_and_dns_for_both_modes() {
        for mode in ["fake-ip", "redir-host"] {
            for (tun_enabled, dns_enabled) in [(true, true), (true, false), (false, true), (false, false)] {
                let config: serde_yaml_ng::Mapping = serde_yaml_ng::from_str(&format!(
                    "tun:\n  enable: {tun_enabled}\ndns:\n  enable: {dns_enabled}\n  enhanced-mode: {mode}\n"
                ))
                .expect("valid DNS configuration");

                assert_eq!(
                    super::needs_public_dns(&config),
                    tun_enabled && dns_enabled,
                    "TUN={tun_enabled}, DNS={dns_enabled}, mode={mode}"
                );
            }
        }
    }

    #[test]
    #[allow(clippy::expect_used)]
    fn redir_host_only_uses_the_placeholder_with_legacy_tun_dns() {
        for (tun_options, expected) in [
            ("  dns-mode: ''\n  auto-route: true\n  dns-hijack: ['any:53']\n", true),
            ("  dns-mode: disabled\n", false),
            ("  dns-mode: native\n", false),
            ("  dns-mode: hijack\n", false),
            ("  auto-route: false\n", false),
            ("  route-exclude-address: []\n", true),
            ("  route-exclude-address: ['1.1.1.1/32']\n", false),
            ("  inet4-route-address: ['192.168.0.0/16']\n", false),
            ("  dns-hijack: []\n", false),
            ("  dns-hijack: ['udp://0.0.0.0:53']\n", true),
            ("  dns-hijack: ['192.168.1.1:53']\n", false),
        ] {
            let config: serde_yaml_ng::Mapping = serde_yaml_ng::from_str(&format!(
                "tun:\n  enable: true\n{tun_options}dns:\n  enable: true\n  enhanced-mode: redir-host\n"
            ))
            .expect("valid DNS configuration");

            assert_eq!(super::needs_public_dns(&config), expected, "{tun_options}");
        }
    }
}
