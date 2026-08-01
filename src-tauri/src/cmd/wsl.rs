use serde::Serialize;

use crate::cmd::CmdResult;
#[cfg(windows)]
use crate::{
    config::{Config, IVerge, MixedPort},
    feat,
};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum WslProxySupport {
    Ready,
    NotWindows,
    NotInstalled,
    UpdateWindows,
    UpdateWsl,
    NoDistribution,
    NoWsl2Distribution,
    NoUserDistribution,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistribution {
    name: String,
    version: Option<u8>,
    running: bool,
    manageable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslProxyStatus {
    support: WslProxySupport,
    integration_enabled: bool,
    configuration_managed: bool,
    configuration_ready: bool,
    auto_proxy_enabled: bool,
    mirrored_networking: bool,
    restart_required: bool,
    proxy_port: Option<u16>,
    configured_proxy_port: Option<u16>,
    wsl_version: Option<String>,
    windows_build: Option<u32>,
    distributions: Vec<WslDistribution>,
}

impl WslProxyStatus {
    const fn unsupported(support: WslProxySupport) -> Self {
        Self {
            support,
            integration_enabled: false,
            configuration_managed: false,
            configuration_ready: false,
            auto_proxy_enabled: false,
            mirrored_networking: false,
            restart_required: false,
            proxy_port: None,
            configured_proxy_port: None,
            wsl_version: None,
            windows_build: None,
            distributions: Vec::new(),
        }
    }

    #[cfg(windows)]
    fn unsupported_with_configuration(
        support: WslProxySupport,
        configured_state: Option<bool>,
        configured_proxy_port: Option<u16>,
        proxy_port: u16,
    ) -> Self {
        let mut status = Self::unsupported(support);
        status.integration_enabled = configured_state.unwrap_or(false);
        status.configuration_managed = configured_state.is_some();
        status.configuration_ready = configured_state == Some(false);
        status.proxy_port = Some(proxy_port);
        status.configured_proxy_port = configured_proxy_port;
        status
    }
}

#[cfg(any(windows, test))]
mod implementation {
    use super::WslDistribution;
    #[cfg(windows)]
    use super::{WslProxyStatus, WslProxySupport};
    use anyhow::{Context as _, Result, ensure};
    #[cfg(windows)]
    use anyhow::{anyhow, bail};
    #[cfg(windows)]
    use std::path::Path;

    #[cfg(windows)]
    const MINIMUM_WINDOWS_BUILD: u32 = 22_621;
    #[cfg(windows)]
    const MINIMUM_WSL_VERSION: [u32; 3] = [2, 0, 0];
    #[cfg(windows)]
    const MANAGED_PROFILE_PATH: &str = "/etc/profile.d/clash-verge-rev-proxy.sh";

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum TextEncoding {
        Utf8,
        Utf8Bom,
        Utf16Le,
        Utf16Be,
    }

    #[derive(Debug, Eq, PartialEq)]
    struct WslConfigView {
        auto_proxy_enabled: bool,
        mirrored_networking: bool,
    }

    fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String> {
        ensure!(bytes.len().is_multiple_of(2), "UTF-16 data has an odd byte length");
        let words = bytes.chunks_exact(2).map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        });
        String::from_utf16(&words.collect::<Vec<_>>()).context("invalid UTF-16 text")
    }

    fn decode_config(bytes: &[u8]) -> Result<(String, TextEncoding)> {
        if let Some(body) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
            return Ok((
                String::from_utf8(body.to_vec()).context("invalid UTF-8 .wslconfig")?,
                TextEncoding::Utf8Bom,
            ));
        }
        if let Some(body) = bytes.strip_prefix(&[0xFF, 0xFE]) {
            return Ok((decode_utf16(body, true)?, TextEncoding::Utf16Le));
        }
        if let Some(body) = bytes.strip_prefix(&[0xFE, 0xFF]) {
            return Ok((decode_utf16(body, false)?, TextEncoding::Utf16Be));
        }
        Ok((
            String::from_utf8(bytes.to_vec()).context("invalid UTF-8 .wslconfig")?,
            TextEncoding::Utf8,
        ))
    }

    fn encode_config(content: &str, encoding: TextEncoding) -> Vec<u8> {
        match encoding {
            TextEncoding::Utf8 => content.as_bytes().to_vec(),
            TextEncoding::Utf8Bom => [0xEF, 0xBB, 0xBF].into_iter().chain(content.bytes()).collect(),
            TextEncoding::Utf16Le => [0xFF, 0xFE]
                .into_iter()
                .chain(content.encode_utf16().flat_map(u16::to_le_bytes))
                .collect(),
            TextEncoding::Utf16Be => [0xFE, 0xFF]
                .into_iter()
                .chain(content.encode_utf16().flat_map(u16::to_be_bytes))
                .collect(),
        }
    }

    fn decode_wsl_output(bytes: &[u8]) -> String {
        let looks_utf16_le = bytes.starts_with(&[0xFF, 0xFE])
            || (bytes.len() >= 4
                && bytes.len().is_multiple_of(2)
                && (bytes.contains(&0) || std::str::from_utf8(bytes).is_err()));
        if looks_utf16_le {
            let body = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
            if let Ok(decoded) = decode_utf16(body, true) {
                return decoded;
            }
        }
        String::from_utf8_lossy(bytes).replace('\0', "")
    }

    fn parse_version(output: &str) -> Option<(String, [u32; 3])> {
        output
            .split(|character: char| !character.is_ascii_digit() && character != '.')
            .filter(|token| token.matches('.').count() >= 2)
            .find_map(|token| {
                let mut parts = token.split('.').filter_map(|part| part.parse::<u32>().ok());
                let version = [parts.next()?, parts.next()?, parts.next()?];
                Some((token.to_owned(), version))
            })
    }

    fn parse_names(output: &str) -> Vec<String> {
        output
            .lines()
            .map(|line| line.trim().trim_matches('\0'))
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    }

    fn distribution_version(verbose_output: &str, name: &str) -> Option<u8> {
        verbose_output.lines().find_map(|line| {
            let line = line.trim().trim_start_matches('*').trim_start();
            let remainder = line.strip_prefix(name)?;
            if !remainder.starts_with(char::is_whitespace) {
                return None;
            }
            remainder
                .split_whitespace()
                .next_back()
                .and_then(|value| value.parse::<u8>().ok())
                .filter(|version| matches!(version, 1 | 2))
        })
    }

    fn parse_distributions(quiet_output: &str, running_output: &str, verbose_output: &str) -> Vec<WslDistribution> {
        let running = parse_names(running_output);
        parse_names(quiet_output)
            .into_iter()
            .map(|name| WslDistribution {
                version: distribution_version(verbose_output, &name),
                running: running
                    .iter()
                    .any(|running_name| running_name.eq_ignore_ascii_case(&name)),
                manageable: !is_infrastructure_distribution(&name),
                name,
            })
            .collect()
    }

    fn is_infrastructure_distribution(name: &str) -> bool {
        let name = name.to_ascii_lowercase();
        name.starts_with("docker-desktop") || name.starts_with("rancher-desktop") || name.starts_with("podman-machine-")
    }

    fn parse_section(line: &str) -> Option<&str> {
        let trimmed = line.trim();
        trimmed.strip_prefix('[')?.strip_suffix(']').map(str::trim)
    }

    fn parse_assignment(line: &str) -> Option<(&str, &str)> {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || trimmed.starts_with(';') {
            return None;
        }
        let (key, value) = trimmed.split_once('=')?;
        Some((key.trim(), value.trim()))
    }

    const fn relevant_section(section: &str) -> bool {
        section.eq_ignore_ascii_case("wsl2") || section.eq_ignore_ascii_case("experimental")
    }

    fn value_without_inline_comment(value: &str) -> &str {
        let comment = value.char_indices().find_map(|(index, character)| {
            let is_comment = matches!(character, '#' | ';');
            let has_separator = index == 0 || value[..index].ends_with(char::is_whitespace);
            (is_comment && has_separator).then_some(index)
        });
        value[..comment.unwrap_or(value.len())].trim()
    }

    fn inspect_wsl_config(content: &str) -> WslConfigView {
        let mut section = "";
        let mut auto_proxy: Option<(u8, String)> = None;
        let mut networking_mode: Option<(u8, String)> = None;

        for line in content.lines() {
            if let Some(next_section) = parse_section(line) {
                section = next_section;
                continue;
            }
            if !relevant_section(section) {
                continue;
            }
            let priority = u8::from(section.eq_ignore_ascii_case("wsl2"));
            let Some((key, value)) = parse_assignment(line) else {
                continue;
            };
            let value = value_without_inline_comment(value).to_owned();
            if key.eq_ignore_ascii_case("autoProxy") && auto_proxy.as_ref().is_none_or(|current| priority >= current.0)
            {
                auto_proxy = Some((priority, value));
            } else if key.eq_ignore_ascii_case("networkingMode")
                && networking_mode.as_ref().is_none_or(|current| priority >= current.0)
            {
                networking_mode = Some((priority, value));
            }
        }

        WslConfigView {
            auto_proxy_enabled: auto_proxy.is_none_or(|(_, value)| !value.eq_ignore_ascii_case("false")),
            mirrored_networking: networking_mode.is_some_and(|(_, value)| value.eq_ignore_ascii_case("mirrored")),
        }
    }

    fn replace_assignment(line: &str, value: &str) -> String {
        let Some(equals) = line.find('=') else {
            return line.to_owned();
        };
        let after_equals = &line[equals + 1..];
        let spacing_len = after_equals.len() - after_equals.trim_start().len();
        let spacing = &after_equals[..spacing_len];
        let existing_value = &after_equals[spacing_len..];
        let comment_index = existing_value.char_indices().find_map(|(index, character)| {
            let is_comment = matches!(character, '#' | ';');
            let has_separator = index > 0 && existing_value[..index].ends_with(char::is_whitespace);
            (is_comment && has_separator).then_some(index)
        });
        let suffix = comment_index.map_or("", |index| &existing_value[index..]);
        let suffix_spacing = if suffix.is_empty() { "" } else { " " };
        format!("{}{spacing}{value}{suffix_spacing}{suffix}", &line[..=equals])
    }

    fn set_ini_value(content: &str, key: &str, value: &str) -> String {
        let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
        let had_final_newline = content.ends_with('\n');
        let mut lines: Vec<String> = content
            .lines()
            .map(|line| line.strip_suffix('\r').unwrap_or(line).to_owned())
            .collect();
        let mut section = String::new();
        let mut updated = false;

        for line in &mut lines {
            if let Some(next_section) = parse_section(line) {
                section = next_section.to_owned();
                continue;
            }
            if !relevant_section(&section) {
                continue;
            }
            if parse_assignment(line).is_some_and(|(existing_key, _)| existing_key.eq_ignore_ascii_case(key)) {
                *line = replace_assignment(line, value);
                updated = true;
            }
        }

        if !updated {
            let wsl2_header = lines
                .iter()
                .position(|line| parse_section(line).is_some_and(|section| section.eq_ignore_ascii_case("wsl2")));
            if let Some(header) = wsl2_header {
                let mut insert_at = lines
                    .iter()
                    .enumerate()
                    .skip(header + 1)
                    .find_map(|(index, line)| parse_section(line).map(|_| index))
                    .unwrap_or(lines.len());
                while insert_at > header + 1 && lines[insert_at - 1].trim().is_empty() {
                    insert_at -= 1;
                }
                lines.insert(insert_at, format!("{key}={value}"));
            } else {
                if lines.last().is_some_and(|line| !line.trim().is_empty()) {
                    lines.push(String::new());
                }
                lines.push("[wsl2]".to_owned());
                lines.push(format!("{key}={value}"));
            }
        }

        let mut result = lines.join(newline);
        if had_final_newline || content.is_empty() {
            result.push_str(newline);
        }
        result
    }

    fn set_proxy_integration(content: &str, enabled: bool) -> String {
        // Direct proxy environment variables make the WSL switch independent from the
        // Windows System Proxy switch. WSL autoProxy must therefore stay off in both states.
        let content = set_ini_value(content, "autoProxy", "false");
        if enabled {
            set_ini_value(&content, "networkingMode", "mirrored")
        } else {
            content
        }
    }

    fn proxy_environment(port: u16) -> String {
        format!(
            "# Managed by Clash Verge Rev. Changes will be replaced.\n\
             CVR_PROXY_HTTP=\"http://127.0.0.1:{port}\"\n\
             CVR_PROXY_SOCKS=\"socks5://127.0.0.1:{port}\"\n\
             export HTTP_PROXY=\"$CVR_PROXY_HTTP\"\n\
             export HTTPS_PROXY=\"$CVR_PROXY_HTTP\"\n\
             export ALL_PROXY=\"$CVR_PROXY_SOCKS\"\n\
             export http_proxy=\"$CVR_PROXY_HTTP\"\n\
             export https_proxy=\"$CVR_PROXY_HTTP\"\n\
             export all_proxy=\"$CVR_PROXY_SOCKS\"\n\
             unset CVR_PROXY_HTTP CVR_PROXY_SOCKS\n"
        )
    }

    fn configuration_is_ready(
        config: &WslConfigView,
        configured_state: Option<bool>,
        configured_proxy_port: Option<u16>,
        proxy_port: u16,
    ) -> bool {
        configured_state.is_some()
            && !config.auto_proxy_enabled
            && if configured_state == Some(true) {
                config.mirrored_networking && configured_proxy_port == Some(proxy_port)
            } else {
                true
            }
    }

    #[cfg(windows)]
    fn run_wsl(arguments: &[&str]) -> Result<std::process::Output> {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        std::process::Command::new("wsl.exe")
            .args(arguments)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .with_context(|| format!("failed to run wsl.exe {}", arguments.join(" ")))
    }

    #[cfg(windows)]
    fn run_wsl_with_input(arguments: &[&str], input: &[u8]) -> Result<std::process::Output> {
        use std::{io::Write as _, os::windows::process::CommandExt as _, process::Stdio};
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let mut child = std::process::Command::new("wsl.exe")
            .args(arguments)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("failed to run wsl.exe {}", arguments.join(" ")))?;
        child
            .stdin
            .take()
            .context("failed to open WSL command input")?
            .write_all(input)
            .context("failed to send the managed proxy environment to WSL")?;
        child.wait_with_output().context("failed to wait for the WSL command")
    }

    #[cfg(windows)]
    fn successful_wsl_output(arguments: &[&str]) -> Result<String> {
        let output = run_wsl(arguments)?;
        if !output.status.success() {
            let detail = decode_wsl_output(&output.stderr);
            bail!("wsl.exe {} failed: {}", arguments.join(" "), detail.trim());
        }
        Ok(decode_wsl_output(&output.stdout))
    }

    #[cfg(windows)]
    fn manage_distribution(name: &str, enabled: bool, port: u16) -> Result<()> {
        let install_script = format!(
            "set -eu; target='{MANAGED_PROFILE_PATH}'; temporary=\"${{target}}.tmp.$$\"; \
             trap 'rm -f \"$temporary\"' EXIT; mkdir -p /etc/profile.d; umask 022; \
             cat > \"$temporary\"; chmod 0644 \"$temporary\"; mv -f \"$temporary\" \"$target\"; trap - EXIT"
        );
        let remove_script = format!("rm -f '{MANAGED_PROFILE_PATH}'");
        let arguments = [
            "--distribution",
            name,
            "--user",
            "root",
            "--exec",
            "/bin/sh",
            "-c",
            if enabled { &install_script } else { &remove_script },
        ];
        let input = enabled.then(|| proxy_environment(port)).unwrap_or_default();
        let output = run_wsl_with_input(&arguments, input.as_bytes())?;
        if !output.status.success() {
            let detail = decode_wsl_output(&output.stderr);
            bail!(
                "failed to {} the managed proxy environment in {name}: {}",
                if enabled { "install" } else { "remove" },
                detail.trim()
            );
        }
        Ok(())
    }

    #[cfg(windows)]
    fn windows_build() -> Option<u32> {
        use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};

        let key = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
            .ok()?;
        let build: String = key.get_value("CurrentBuildNumber").ok()?;
        build.parse().ok()
    }

    #[cfg(windows)]
    fn config_path() -> Result<std::path::PathBuf> {
        let profile = std::env::var_os("USERPROFILE").ok_or_else(|| anyhow!("USERPROFILE is not available"))?;
        Ok(std::path::PathBuf::from(profile).join(".wslconfig"))
    }

    #[cfg(windows)]
    fn read_config(path: &Path) -> Result<(String, TextEncoding)> {
        match std::fs::read(path) {
            Ok(bytes) => decode_config(&bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((String::new(), TextEncoding::Utf8)),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    #[cfg(windows)]
    fn create_backup_once(path: &Path, original: &[u8]) -> Result<()> {
        use std::io::Write as _;

        if original.is_empty() {
            return Ok(());
        }
        let backup = path.with_file_name(".wslconfig.clash-verge-rev.bak");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        match options.open(&backup) {
            Ok(mut file) => {
                file.write_all(original)?;
                file.sync_all()?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error).with_context(|| format!("failed to create {}", backup.display())),
        }
        Ok(())
    }

    #[cfg(windows)]
    fn replace_file_atomic(source: &Path, destination: &Path) -> Result<()> {
        use std::os::windows::ffi::OsStrExt as _;
        use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW};

        let source: Vec<u16> = source.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error()).context("failed to replace .wslconfig");
        }
        Ok(())
    }

    #[cfg(windows)]
    fn write_config(path: &Path, content: &str, encoding: TextEncoding) -> Result<()> {
        use std::io::Write as _;

        if let Ok(metadata) = std::fs::symlink_metadata(path) {
            ensure!(
                !metadata.file_type().is_symlink(),
                "refusing to replace a symlinked .wslconfig"
            );
        }
        let original = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error).with_context(|| format!("failed to read {}", path.display())),
        };
        create_backup_once(path, &original)?;

        let temporary = path.with_file_name(format!(
            ".wslconfig.clash-verge-rev.tmp-{}-{}",
            std::process::id(),
            nanoid::nanoid!(8)
        ));
        let result = (|| -> Result<()> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            let mut file = options
                .open(&temporary)
                .with_context(|| format!("failed to create {}", temporary.display()))?;
            file.write_all(&encode_config(content, encoding))?;
            file.sync_all()?;
            drop(file);
            replace_file_atomic(&temporary, path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    }

    #[cfg(windows)]
    pub fn get_status(
        configured_state: Option<bool>,
        configured_proxy_port: Option<u16>,
        proxy_port: u16,
    ) -> Result<WslProxyStatus> {
        let quiet = match run_wsl(&["--list", "--quiet"]) {
            Ok(output) if output.status.success() => decode_wsl_output(&output.stdout),
            Ok(_) | Err(_) => {
                return Ok(WslProxyStatus::unsupported_with_configuration(
                    WslProxySupport::NotInstalled,
                    configured_state,
                    configured_proxy_port,
                    proxy_port,
                ));
            }
        };
        let version_output = run_wsl(&["--version"])
            .ok()
            .filter(|output| output.status.success())
            .map(|output| decode_wsl_output(&output.stdout));
        let parsed_version = version_output.as_deref().and_then(parse_version);
        let build = windows_build();
        let running = successful_wsl_output(&["--list", "--running", "--quiet"])?;
        let verbose = successful_wsl_output(&["--list", "--verbose"])?;
        let distributions = parse_distributions(&quiet, &running, &verbose);

        let support = if build.is_none_or(|value| value < MINIMUM_WINDOWS_BUILD) {
            WslProxySupport::UpdateWindows
        } else if parsed_version
            .as_ref()
            .is_none_or(|(_, value)| *value < MINIMUM_WSL_VERSION)
        {
            WslProxySupport::UpdateWsl
        } else if distributions.is_empty() {
            WslProxySupport::NoDistribution
        } else if !distributions.iter().any(|distribution| distribution.version == Some(2)) {
            WslProxySupport::NoWsl2Distribution
        } else if !distributions
            .iter()
            .any(|distribution| distribution.version == Some(2) && distribution.manageable)
        {
            WslProxySupport::NoUserDistribution
        } else {
            WslProxySupport::Ready
        };

        let (content, _) = read_config(&config_path()?)?;
        let config = inspect_wsl_config(&content);
        let integration_enabled = configured_state.unwrap_or(false);
        let configuration_managed = configured_state.is_some();
        let configuration_ready = configuration_is_ready(&config, configured_state, configured_proxy_port, proxy_port);
        Ok(WslProxyStatus {
            support,
            integration_enabled,
            configuration_managed,
            configuration_ready,
            auto_proxy_enabled: config.auto_proxy_enabled,
            mirrored_networking: config.mirrored_networking,
            restart_required: false,
            proxy_port: Some(proxy_port),
            configured_proxy_port,
            wsl_version: parsed_version.map(|(display, _)| display),
            windows_build: build,
            distributions,
        })
    }

    #[cfg(windows)]
    pub fn set_enabled(enabled: bool, proxy_port: u16) -> Result<WslProxyStatus> {
        let status = get_status(None, None, proxy_port)?;
        if enabled {
            ensure!(
                matches!(status.support, WslProxySupport::Ready),
                "WSL proxy integration is not supported on this system"
            );
        }

        let path = config_path()?;
        let (content, encoding) = read_config(&path)?;
        let updated = set_proxy_integration(&content, enabled);
        if updated != content {
            write_config(&path, &updated, encoding)?;
        }

        let targets: Vec<_> = status
            .distributions
            .iter()
            .filter(|distribution| distribution.version == Some(2) && distribution.manageable)
            .collect();
        for distribution in &targets {
            manage_distribution(&distribution.name, enabled, proxy_port)?;
        }

        let mut updated_status = get_status(Some(enabled), Some(proxy_port), proxy_port)?;
        updated_status.restart_required = updated != content || !targets.is_empty();
        Ok(updated_status)
    }

    #[cfg(windows)]
    pub fn restart() -> Result<()> {
        let output = run_wsl(&["--shutdown"])?;
        if !output.status.success() {
            let detail = decode_wsl_output(&output.stderr);
            bail!("wsl.exe --shutdown failed: {}", detail.trim());
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::{
            TextEncoding, configuration_is_ready, decode_config, decode_wsl_output, encode_config, inspect_wsl_config,
            parse_distributions, parse_version, proxy_environment, set_proxy_integration,
        };

        #[test]
        fn enables_direct_integration_without_discarding_existing_settings() {
            let input = "# user settings\r\n[wsl2]\r\nmemory=8GB\r\nautoProxy = true # keep comment\r\n\r\n[experimental]\r\nsparseVhd=true\r\n";
            let updated = set_proxy_integration(input, true);

            assert!(updated.contains("memory=8GB\r\n"));
            assert!(updated.contains("autoProxy = false # keep comment\r\n"));
            assert!(updated.contains("networkingMode=mirrored\r\n\r\n[experimental]"));
            assert!(!inspect_wsl_config(&updated).auto_proxy_enabled);
            assert!(inspect_wsl_config(&updated).mirrored_networking);
        }

        #[test]
        fn creates_wsl2_section_for_an_empty_config() {
            assert_eq!(
                set_proxy_integration("", true),
                "[wsl2]\nautoProxy=false\nnetworkingMode=mirrored\n"
            );
        }

        #[test]
        fn updates_legacy_and_current_duplicate_values_consistently() {
            let input = "[wsl2]\nautoProxy=true\n[experimental]\nautoProxy=true\nnetworkingMode=nat\n";
            let updated = set_proxy_integration(input, true);

            assert_eq!(updated.matches("autoProxy=false").count(), 2);
            assert!(updated.contains("networkingMode=mirrored"));
        }

        #[test]
        fn disabling_does_not_change_the_users_networking_mode() {
            let input = "[wsl2]\nautoProxy=true\nnetworkingMode=mirrored\n";
            let updated = set_proxy_integration(input, false);

            assert!(updated.contains("autoProxy=false"));
            assert!(updated.contains("networkingMode=mirrored"));
            assert!(!inspect_wsl_config(&updated).auto_proxy_enabled);
        }

        #[test]
        fn default_config_uses_auto_proxy_but_not_mirrored_networking() {
            let view = inspect_wsl_config("");
            assert!(view.auto_proxy_enabled);
            assert!(!view.mirrored_networking);
        }

        #[test]
        fn managed_environment_points_directly_to_the_mixed_port() {
            let environment = proxy_environment(7897);

            assert!(environment.contains("HTTP_PROXY=\"$CVR_PROXY_HTTP\""));
            assert!(environment.contains("http://127.0.0.1:7897"));
            assert!(environment.contains("socks5://127.0.0.1:7897"));
            assert!(!environment.contains("autoProxy"));
        }

        #[test]
        fn managed_on_and_off_states_are_independent_from_auto_proxy() {
            let enabled = inspect_wsl_config("[wsl2]\nautoProxy=false\nnetworkingMode=mirrored\n");
            let disabled = inspect_wsl_config("[wsl2]\nautoProxy=false\nnetworkingMode=nat\n");
            let inherited = inspect_wsl_config("[wsl2]\nautoProxy=true\nnetworkingMode=mirrored\n");

            assert!(configuration_is_ready(&enabled, Some(true), Some(7897), 7897));
            assert!(configuration_is_ready(&disabled, Some(false), Some(7897), 7897));
            assert!(!configuration_is_ready(&inherited, Some(false), Some(7897), 7897));
            assert!(!configuration_is_ready(&enabled, Some(true), Some(7898), 7897));
        }

        #[test]
        fn config_encoding_round_trips() -> anyhow::Result<()> {
            let content = "[wsl2]\r\nautoProxy=true\r\n";
            for encoding in [
                TextEncoding::Utf8,
                TextEncoding::Utf8Bom,
                TextEncoding::Utf16Le,
                TextEncoding::Utf16Be,
            ] {
                let encoded = encode_config(content, encoding);
                let (decoded, detected) = decode_config(&encoded)?;
                assert_eq!(decoded, content);
                assert_eq!(detected, encoding);
            }
            Ok(())
        }

        #[test]
        fn decodes_utf16_wsl_output() {
            let bytes: Vec<u8> = "Ubuntu\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
            assert_eq!(decode_wsl_output(&bytes), "Ubuntu\r\n");
        }

        #[test]
        fn parses_localized_version_output_by_number() {
            assert_eq!(
                parse_version("WSL 版本: 2.3.26.0\r\n内核版本: 5.15.167.4"),
                Some(("2.3.26.0".to_owned(), [2, 3, 26]))
            );
        }

        #[test]
        fn correlates_quiet_and_verbose_distribution_output() {
            let distributions = parse_distributions(
                "Ubuntu 24.04\r\ndocker-desktop\r\n",
                "Ubuntu 24.04\r\n",
                "  NAME             STATE        VERSION\r\n* Ubuntu 24.04     Running      2\r\n  docker-desktop   Stopped      2\r\n",
            );

            assert_eq!(distributions.len(), 2);
            assert_eq!(distributions[0].name, "Ubuntu 24.04");
            assert_eq!(distributions[0].version, Some(2));
            assert!(distributions[0].running);
            assert!(distributions[0].manageable);
            assert!(!distributions[1].running);
            assert!(!distributions[1].manageable);
        }
    }
}

#[cfg(windows)]
mod platform {
    pub use super::implementation::{get_status, restart, set_enabled};
}

#[cfg(not(windows))]
mod platform {
    use super::{WslProxyStatus, WslProxySupport};

    pub const fn get_status() -> WslProxyStatus {
        WslProxyStatus::unsupported(WslProxySupport::NotWindows)
    }
}

#[tauri::command]
pub async fn get_wsl_proxy_status() -> CmdResult<WslProxyStatus> {
    #[cfg(windows)]
    {
        let verge = Config::verge().await.latest_arc();
        let configured_state = verge.enable_wsl_proxy;
        let configured_proxy_port = verge.wsl_proxy_port;
        let proxy_port = MixedPort::effective().await;
        return tokio::task::spawn_blocking(move || {
            platform::get_status(configured_state, configured_proxy_port, proxy_port)
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string().into());
    }
    #[cfg(not(windows))]
    Ok(platform::get_status())
}

#[tauri::command]
pub async fn set_wsl_proxy_enabled(enabled: bool) -> CmdResult<WslProxyStatus> {
    #[cfg(windows)]
    {
        let proxy_port = MixedPort::effective().await;
        let mut status = tokio::task::spawn_blocking(move || platform::set_enabled(enabled, proxy_port))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
        let patch = IVerge {
            enable_wsl_proxy: Some(enabled),
            wsl_proxy_port: Some(proxy_port),
            ..IVerge::default()
        };
        feat::patch_verge(&patch, false)
            .await
            .map_err(|error| error.to_string())?;
        status.configuration_managed = true;
        status.configuration_ready = true;
        return Ok(status);
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("WSL proxy integration is only available on Windows".into())
    }
}

#[tauri::command]
pub async fn restart_wsl() -> CmdResult {
    #[cfg(windows)]
    {
        return tokio::task::spawn_blocking(platform::restart)
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string().into());
    }
    #[cfg(not(windows))]
    Err("WSL proxy integration is only available on Windows".into())
}
