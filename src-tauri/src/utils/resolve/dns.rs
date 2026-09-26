use anyhow::{Context as _, bail};
use clash_verge_logging::{Type, logging};
#[cfg(target_os = "macos")]
use serde_yaml_ng::{Mapping, Value};
#[cfg(target_os = "macos")]
use tokio::sync::Mutex;

#[cfg(target_os = "macos")]
static DNS_LOCK: Mutex<()> = Mutex::const_new(());

async fn run_script(name: &str, args: &[&str]) -> anyhow::Result<()> {
    use crate::{core::handle::Handle, utils::dirs};
    use tauri_plugin_shell::ShellExt as _;

    let resources = dirs::app_resources_dir()?;
    let state = dirs::app_home_dir()?;
    std::fs::create_dir_all(&state).context("create DNS state directory")?;
    // Legacy backups lack service identity and cannot safely be restored after a network change.
    if resources.join(".original_dns.txt").exists() || state.join(".original_dns.txt").exists() {
        bail!("legacy DNS backup has no network service identity; preserve it for manual recovery");
    }
    let output = Handle::app_handle()
        .shell()
        .command("bash")
        .arg(resources.join(name).to_string_lossy().into_owned())
        .args(args.iter().copied())
        .current_dir(state)
        .output()
        .await?;
    if !output.status.success() {
        bail!("DNS operation failed: {}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn needs_public_dns(config: &Mapping) -> bool {
    let section = |name: &str| config.get(Value::from(name)).and_then(Value::as_mapping);
    let enabled =
        |map: Option<&Mapping>| map.and_then(|m| m.get(Value::from("enable"))).and_then(Value::as_bool) == Some(true);
    enabled(section("tun"))
        && enabled(section("dns"))
        && section("dns")
            .and_then(|m| m.get(Value::from("enhanced-mode")))
            .and_then(Value::as_str)
            == Some("fake-ip")
}

// Called while the core's configuration/lifecycle serialization is held, after application succeeds.
#[cfg(target_os = "macos")]
pub async fn apply_runtime_dns() {
    let _guard = DNS_LOCK.lock().await;
    if crate::core::handle::Handle::global().is_exiting() {
        return;
    }
    let runtime = crate::config::Config::runtime().await;
    let enabled = !matches!(
        *crate::core::CoreManager::global().get_running_mode(),
        crate::core::manager::RunningMode::NotRunning
    ) && runtime.latest_arc().config.as_ref().is_some_and(needs_public_dns);
    let result = if enabled {
        run_script("set_dns.sh", &["114.114.114.114"]).await
    } else {
        run_script("unset_dns.sh", &[]).await
    };
    if let Err(error) = result {
        logging!(error, Type::Config, "Failed to apply system DNS: {error:#}");
    }
}

#[cfg(target_os = "macos")]
pub async fn restore_public_dns() -> anyhow::Result<()> {
    let _guard = DNS_LOCK.lock().await;
    run_script("unset_dns.sh", &[]).await
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::needs_public_dns;

    #[test]
    fn follows_final_runtime_dns_and_tun_settings() {
        for (yaml, expected) in [
            ("tun: {enable: true}\ndns: {enable: true, enhanced-mode: fake-ip}", true),
            (
                "tun: {enable: false}\ndns: {enable: true, enhanced-mode: fake-ip}",
                false,
            ),
            (
                "tun: {enable: true}\ndns: {enable: false, enhanced-mode: fake-ip}",
                false,
            ),
            (
                "tun: {enable: true}\ndns: {enable: true, enhanced-mode: redir-host}",
                false,
            ),
        ] {
            let config = serde_yaml_ng::from_str(yaml).expect("valid fixture");
            assert_eq!(needs_public_dns(&config), expected);
        }
    }
}
