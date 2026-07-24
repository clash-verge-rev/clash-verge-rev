use super::{CmdResult, StringifyErr as _};
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use smartstring::alias::String as SmartString;
use socket2::{Domain, Protocol, Socket, Type};
use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddrV4, UdpSocket},
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub supported: bool,
    pub forwarding_enabled: bool,
    pub platform: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DhcpServerConfig {
    pub interface: String,
    pub server_address: String,
    pub pool_start: String,
    pub pool_end: String,
    pub subnet_mask: String,
    pub router: String,
    pub dns: String,
    pub lease_time_secs: u32,
    #[serde(default)]
    pub reservations: Vec<DhcpReservation>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DhcpReservation {
    pub mac_address: String,
    pub ip_address: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DhcpLease {
    pub mac_address: String,
    pub ip_address: String,
    pub hostname: String,
    pub expires_at: u64,
    pub last_seen: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DhcpServerStatus {
    pub running: bool,
    pub interface: String,
    pub listen_address: String,
    pub error: Option<String>,
    pub leases: Vec<DhcpLease>,
}

struct DhcpRuntime {
    stop: Arc<AtomicBool>,
    interface: String,
    leases: Arc<Mutex<HashMap<String, DhcpLease>>>,
    error: Arc<Mutex<Option<String>>>,
    privileged_label: Option<String>,
    lease_file: Option<std::path::PathBuf>,
    configured_address: Option<String>,
}

static DHCP_RUNTIME: LazyLock<Mutex<Option<DhcpRuntime>>> = LazyLock::new(|| Mutex::new(None));

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn parse_ipv4(value: &str, field: &str) -> CmdResult<Ipv4Addr> {
    value
        .parse::<Ipv4Addr>()
        .map_err(|_| format!("Invalid {field} IPv4 address: {value}").into())
}

fn ipv4_u32(value: Ipv4Addr) -> u32 {
    u32::from_be_bytes(value.octets())
}

fn normalize_mac(value: &str) -> String {
    value
        .split([':', '-'])
        .map(str::trim)
        .map(str::to_ascii_uppercase)
        .collect::<Vec<_>>()
        .join(":")
}

fn validate_dhcp_config(config: &DhcpServerConfig) -> CmdResult<()> {
    validate_interface(&config.interface)?;
    let server = parse_ipv4(&config.server_address, "server")?;
    let start = parse_ipv4(&config.pool_start, "pool start")?;
    let end = parse_ipv4(&config.pool_end, "pool end")?;
    let mask = parse_ipv4(&config.subnet_mask, "subnet mask")?;
    let router = parse_ipv4(&config.router, "router")?;
    parse_ipv4(&config.dns, "DNS")?;
    if ipv4_u32(start) > ipv4_u32(end) {
        return Err("DHCP pool start must not be greater than pool end".into());
    }
    if ipv4_u32(start) & ipv4_u32(mask) != ipv4_u32(server) & ipv4_u32(mask)
        || ipv4_u32(end) & ipv4_u32(mask) != ipv4_u32(server) & ipv4_u32(mask)
    {
        return Err("DHCP pool and server address must be in the same subnet".into());
    }
    if (ipv4_u32(start)..=ipv4_u32(end)).contains(&ipv4_u32(server)) {
        return Err("DHCP pool must not contain the gateway address".into());
    }
    if router != server {
        return Err("DHCP router must match the server address configured on the downstream interface".into());
    }
    if !(60..=604800).contains(&config.lease_time_secs) {
        return Err("DHCP lease time must be between 60 and 604800 seconds".into());
    }
    let mut reserved_macs = std::collections::HashSet::new();
    let mut reserved_ips = std::collections::HashSet::new();
    for reservation in &config.reservations {
        let mac = normalize_mac(&reservation.mac_address);
        if mac.split(':').count() != 6
            || mac
                .split(':')
                .any(|part| part.len() != 2 || u8::from_str_radix(part, 16).is_err())
        {
            return Err(format!("Invalid reservation MAC address: {}", reservation.mac_address).into());
        }
        let ip = parse_ipv4(&reservation.ip_address, "reservation")?;
        if ipv4_u32(ip) & ipv4_u32(mask) != ipv4_u32(server) & ipv4_u32(mask) {
            return Err(format!("Reserved IP {} must be in the DHCP subnet", reservation.ip_address).into());
        }
        if ip == server {
            return Err("A reserved IP must not equal the gateway address".into());
        }
        if !reserved_macs.insert(mac) {
            return Err(format!("Duplicate reservation MAC address: {}", reservation.mac_address).into());
        }
        if !reserved_ips.insert(ip) {
            return Err(format!("Duplicate reserved IP address: {}", reservation.ip_address).into());
        }
    }
    Ok(())
}

fn dhcp_option(packet: &[u8], wanted: u8) -> Option<&[u8]> {
    if packet.len() < 240 || packet[236..240] != [99, 130, 83, 99] {
        return None;
    }
    let mut offset = 240;
    while offset < packet.len() {
        let code = packet[offset];
        offset += 1;
        if code == 255 {
            break;
        }
        if code == 0 {
            continue;
        }
        let length = *packet.get(offset)? as usize;
        offset += 1;
        let value = packet.get(offset..offset + length)?;
        if code == wanted {
            return Some(value);
        }
        offset += length;
    }
    None
}

fn allocate_address(
    mac: &str,
    requested: Option<Ipv4Addr>,
    config: &DhcpServerConfig,
    leases: &HashMap<String, DhcpLease>,
) -> Option<Ipv4Addr> {
    let normalized_mac = normalize_mac(mac);
    if let Some(reservation) = config
        .reservations
        .iter()
        .find(|reservation| normalize_mac(&reservation.mac_address) == normalized_mac)
    {
        return reservation.ip_address.parse().ok();
    }
    if let Some(existing) = leases.get(mac)
        && let Ok(ip) = existing.ip_address.parse::<Ipv4Addr>()
    {
        return Some(ip);
    }
    let start = ipv4_u32(config.pool_start.parse().ok()?);
    let end = ipv4_u32(config.pool_end.parse().ok()?);
    let reserved_for_other = |candidate: Ipv4Addr| {
        config.reservations.iter().any(|reservation| {
            normalize_mac(&reservation.mac_address) != normalized_mac && reservation.ip_address == candidate.to_string()
        })
    };
    let used = |candidate: Ipv4Addr| {
        reserved_for_other(candidate)
            || leases
                .values()
                .any(|lease| lease.ip_address == candidate.to_string() && lease.expires_at > now_epoch())
    };
    if let Some(candidate) = requested
        && (start..=end).contains(&ipv4_u32(candidate))
        && !used(candidate)
    {
        return Some(candidate);
    }
    (start..=end).map(Ipv4Addr::from).find(|candidate| !used(*candidate))
}

fn push_option(packet: &mut Vec<u8>, code: u8, value: &[u8]) {
    packet.push(code);
    packet.push(value.len() as u8);
    packet.extend_from_slice(value);
}

fn build_dhcp_reply(request: &[u8], message_type: u8, offered: Ipv4Addr, config: &DhcpServerConfig) -> Option<Vec<u8>> {
    if request.len() < 240 {
        return None;
    }
    let server = config.server_address.parse::<Ipv4Addr>().ok()?;
    let mask = config.subnet_mask.parse::<Ipv4Addr>().ok()?;
    let router = config.router.parse::<Ipv4Addr>().ok()?;
    let dns = config.dns.parse::<Ipv4Addr>().ok()?;
    let mut reply = vec![0_u8; 240];
    reply[0] = 2;
    reply[1] = request[1];
    reply[2] = request[2];
    reply[3] = request[3];
    reply[4..8].copy_from_slice(&request[4..8]);
    reply[8..12].copy_from_slice(&request[8..12]);
    reply[16..20].copy_from_slice(&offered.octets());
    reply[20..24].copy_from_slice(&server.octets());
    reply[28..44].copy_from_slice(&request[28..44]);
    reply[236..240].copy_from_slice(&[99, 130, 83, 99]);
    push_option(&mut reply, 53, &[message_type]);
    push_option(&mut reply, 54, &server.octets());
    push_option(&mut reply, 1, &mask.octets());
    push_option(&mut reply, 3, &router.octets());
    push_option(&mut reply, 6, &dns.octets());
    push_option(&mut reply, 51, &config.lease_time_secs.to_be_bytes());
    push_option(&mut reply, 58, &(config.lease_time_secs / 2).to_be_bytes());
    push_option(&mut reply, 59, &(config.lease_time_secs * 7 / 8).to_be_bytes());
    reply.push(255);
    Some(reply)
}

fn run_dhcp_server(
    socket: UdpSocket,
    config: DhcpServerConfig,
    stop: Arc<AtomicBool>,
    leases: Arc<Mutex<HashMap<String, DhcpLease>>>,
    error: Arc<Mutex<Option<String>>>,
    lease_file: Option<std::path::PathBuf>,
) {
    let mut buffer = [0_u8; 1500];
    while !stop.load(Ordering::Relaxed) {
        let size = match socket.recv(&mut buffer) {
            Ok(size) => size,
            Err(err)
                if matches!(
                    err.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue;
            }
            Err(err) => {
                *error.lock().unwrap_or_else(|e| e.into_inner()) = Some(err.to_string());
                break;
            }
        };
        let packet = &buffer[..size];
        let Some(message_type) = dhcp_option(packet, 53).and_then(|value| value.first()).copied() else {
            continue;
        };
        if packet.len() < 44 || packet[1] != 1 || packet[2] < 6 {
            continue;
        }
        let mac = packet[28..34]
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join(":");
        if message_type == 7 {
            leases.lock().unwrap_or_else(|e| e.into_inner()).remove(&mac);
            if let Some(path) = lease_file.as_ref() {
                let current = leases.lock().unwrap_or_else(|e| e.into_inner());
                let _ = write_lease_snapshot(path, &current);
            }
            continue;
        }
        if !matches!(message_type, 1 | 3) {
            continue;
        }
        let requested = dhcp_option(packet, 50)
            .filter(|value| value.len() == 4)
            .map(|value| Ipv4Addr::new(value[0], value[1], value[2], value[3]));
        let hostname = dhcp_option(packet, 12)
            .and_then(|value| std::str::from_utf8(value).ok())
            .unwrap_or("")
            .trim_matches(char::from(0))
            .to_string();
        let offered = {
            let current = leases.lock().unwrap_or_else(|e| e.into_inner());
            allocate_address(&mac, requested, &config, &current)
        };
        let Some(offered) = offered else { continue };
        let reply_type = if message_type == 1 { 2 } else { 5 };
        if let Some(reply) = build_dhcp_reply(packet, reply_type, offered, &config) {
            if socket
                .send_to(&reply, SocketAddrV4::new(Ipv4Addr::BROADCAST, 68))
                .is_ok()
            {
                let now = now_epoch();
                leases.lock().unwrap_or_else(|e| e.into_inner()).insert(
                    mac.clone(),
                    DhcpLease {
                        mac_address: mac,
                        ip_address: offered.to_string(),
                        hostname,
                        expires_at: now + u64::from(config.lease_time_secs),
                        last_seen: now,
                    },
                );
                if let Some(path) = lease_file.as_ref() {
                    let current = leases.lock().unwrap_or_else(|e| e.into_inner());
                    let _ = write_lease_snapshot(path, &current);
                }
            }
        }
    }
}

fn write_lease_snapshot(path: &std::path::Path, leases: &HashMap<String, DhcpLease>) -> std::io::Result<()> {
    use std::io::Write as _;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt as _;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o644).custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(path)?;
    file.write_all(&serde_json::to_vec(leases).unwrap_or_default())
}

pub fn run_privileged_dhcp_daemon(encoded_config: &str, lease_file: &str) -> CmdResult<()> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded_config)
        .stringify_err()?;
    let config: DhcpServerConfig = serde_json::from_slice(&bytes).stringify_err()?;
    validate_dhcp_config(&config)?;
    let socket = bind_dhcp_socket(&config.interface).stringify_err()?;
    socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .stringify_err()?;
    let stop = Arc::new(AtomicBool::new(false));
    let leases = Arc::new(Mutex::new(HashMap::new()));
    let error = Arc::new(Mutex::new(None));
    run_dhcp_server(
        socket,
        config,
        stop,
        leases,
        error,
        Some(std::path::PathBuf::from(lease_file)),
    );
    Ok(())
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn interface_has_ipv4(interface: &str, address: &str) -> bool {
    std::process::Command::new("/sbin/ifconfig")
        .arg(interface)
        .output()
        .is_ok_and(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                    line.split_whitespace()
                        .collect::<Vec<_>>()
                        .windows(2)
                        .any(|fields| fields == ["inet", address])
                })
        })
}

#[cfg(target_os = "macos")]
fn stop_privileged_dhcp(label: &str, interface: &str, configured_address: Option<&str>) {
    let remove_address = configured_address.map_or_else(String::new, |address| {
        format!(
            "; /sbin/ifconfig {} -alias {} 2>/dev/null || true",
            shell_quote(interface),
            shell_quote(address),
        )
    });
    let command = format!(
        "/bin/launchctl remove {} 2>/dev/null || true{remove_address}",
        shell_quote(label),
    );
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    let _ = std::process::Command::new("/usr/bin/osascript")
        .args([
            "-e",
            &format!("do shell script \"{escaped}\" with administrator privileges"),
        ])
        .status();
}

#[cfg(target_os = "macos")]
fn start_privileged_dhcp(config: &DhcpServerConfig) -> CmdResult<(String, std::path::PathBuf, bool)> {
    use base64::Engine as _;
    let executable = std::env::current_exe().stringify_err()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(serde_json::to_vec(config).stringify_err()?);
    let nonce = nanoid::nanoid!();
    let service_label = format!("io.github.clash-verge-rev.gateway-dhcp.{nonce}");
    let lease_file = std::env::temp_dir().join(format!("clash-verge-gateway-dhcp-{nonce}-leases.json"));
    let log_file = std::env::temp_dir().join(format!("clash-verge-gateway-dhcp-{nonce}-daemon.log"));
    let _ = std::fs::remove_file(&lease_file);
    let _ = std::fs::remove_file(&log_file);
    // A direct Ethernet/USB link commonly only has a 169.254/16 self-assigned
    // address. DHCP handing out a private subnet is not sufficient: the Mac
    // must own the advertised router address so clients can resolve it by ARP.
    let address_was_present = interface_has_ipv4(&config.interface, &config.server_address);
    let configure_address = if address_was_present {
        String::new()
    } else {
        format!(
            "/sbin/ifconfig {} inet {} netmask {} alias && ",
            shell_quote(&config.interface),
            shell_quote(&config.server_address),
            shell_quote(&config.subnet_mask),
        )
    };
    // `do shell script "... &"` can still wait for the spawned child on
    // macOS, leaving the Tauri command and UI permanently pending. Submit a
    // transient launchd job instead: launchctl returns immediately and the
    // label gives us a reliable handle for shutdown.
    let command = format!(
        "{configure_address}/bin/launchctl submit -l {} -o {} -e {} -- {} --dhcp-daemon {} {}",
        shell_quote(&service_label),
        shell_quote(&log_file.to_string_lossy()),
        shell_quote(&log_file.to_string_lossy()),
        shell_quote(&executable.to_string_lossy()),
        shell_quote(&encoded),
        shell_quote(&lease_file.to_string_lossy()),
    );
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    let output = std::process::Command::new("/usr/bin/osascript")
        .args([
            "-e",
            &format!("do shell script \"{escaped}\" with administrator privileges"),
        ])
        .output()
        .stringify_err()?;
    if !output.status.success() {
        return Err(format!(
            "Failed to start privileged DHCP service: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    std::thread::sleep(Duration::from_millis(300));
    if let Ok(log) = std::fs::read_to_string(&log_file)
        && !log.trim().is_empty()
    {
        stop_privileged_dhcp(
            &service_label,
            &config.interface,
            (!address_was_present).then_some(config.server_address.as_str()),
        );
        let _ = std::fs::remove_file(&lease_file);
        let _ = std::fs::remove_file(&log_file);
        return Err(format!("DHCP service failed: {}", log.trim()).into());
    }
    Ok((service_label, lease_file, !address_was_present))
}

fn bind_dhcp_socket(interface: &str) -> std::io::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_broadcast(true)?;

    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::fd::AsRawFd};
        let name = CString::new(interface)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid interface name"))?;
        let index = unsafe { libc::if_nametoindex(name.as_ptr()) };
        if index == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let index = index as libc::c_int;
        let result = unsafe {
            libc::setsockopt(
                socket.as_raw_fd(),
                libc::IPPROTO_IP,
                libc::IP_BOUND_IF,
                (&index as *const libc::c_int).cast(),
                std::mem::size_of_val(&index) as libc::socklen_t,
            )
        };
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }

    socket.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 67).into())?;
    Ok(socket.into())
}

fn validate_interface(interface: &str) -> CmdResult<()> {
    if interface.is_empty() {
        return Err("A LAN interface must be selected".into());
    }

    let interfaces = tauri_plugin_clash_verge_sysinfo::list_network_interfaces();
    if !interfaces.iter().any(|candidate| candidate == interface) {
        return Err(format!("Unknown network interface: {interface}").into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn forwarding_enabled() -> bool {
    std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "net.inet.ip.forwarding"])
        .output()
        .is_ok_and(|output| output.status.success() && output.stdout.starts_with(b"1"))
}

#[cfg(target_os = "windows")]
fn forwarding_enabled() -> bool {
    use std::os::windows::process::CommandExt as _;

    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[bool](Get-NetIPInterface -AddressFamily IPv4 | Where-Object Forwarding -eq Enabled)",
        ])
        .creation_flags(0x08000000)
        .output()
        .is_ok_and(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .eq_ignore_ascii_case("true")
        })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const fn forwarding_enabled() -> bool {
    false
}

#[tauri::command]
pub fn get_gateway_status() -> GatewayStatus {
    GatewayStatus {
        supported: cfg!(any(target_os = "macos", target_os = "windows")),
        forwarding_enabled: forwarding_enabled(),
        platform: std::env::consts::OS,
    }
}

#[cfg(target_os = "macos")]
fn apply_forwarding(enable: bool, _interface: &str) -> CmdResult<()> {
    let value = if enable { "1" } else { "0" };
    let script =
        format!("do shell script \"/usr/sbin/sysctl -w net.inet.ip.forwarding={value}\" with administrator privileges");
    let status = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .status()
        .stringify_err()?;
    if !status.success() {
        return Err("Failed to change macOS IP forwarding".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_forwarding(enable: bool, interface: &str) -> CmdResult<()> {
    let state = if enable { "enabled" } else { "disabled" };
    let assignment = format!("forwarding={state}");
    let status = runas::Command::new("netsh.exe")
        .args(["interface", "ipv4", "set", "interface", interface, &assignment])
        .show(false)
        .status()
        .stringify_err()?;
    if !status.success() {
        return Err("Failed to change Windows IP forwarding".into());
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_forwarding(_enable: bool, _interface: &str) -> CmdResult<()> {
    Err("Gateway mode is currently supported on macOS and Windows only".into())
}

/// Enables packet forwarding for the selected LAN interface. This deliberately
/// does not start DHCP or modify client machines in v1.
#[tauri::command]
pub async fn set_gateway_forwarding(enable: bool, lan_interface: String) -> CmdResult<GatewayStatus> {
    validate_interface(&lan_interface)?;
    tauri::async_runtime::spawn_blocking(move || apply_forwarding(enable, &lan_interface))
        .await
        .stringify_err()??;
    Ok(get_gateway_status())
}

#[tauri::command]
pub fn get_dhcp_server_status() -> DhcpServerStatus {
    let runtime = DHCP_RUNTIME.lock().unwrap_or_else(|e| e.into_inner());
    let Some(runtime) = runtime.as_ref() else {
        return DhcpServerStatus {
            running: false,
            interface: String::new(),
            listen_address: "0.0.0.0:67".into(),
            error: None,
            leases: Vec::new(),
        };
    };
    if let Some(path) = runtime.lease_file.as_ref()
        && let Ok(bytes) = std::fs::read(path)
        && let Ok(from_daemon) = serde_json::from_slice::<HashMap<String, DhcpLease>>(&bytes)
    {
        *runtime.leases.lock().unwrap_or_else(|e| e.into_inner()) = from_daemon;
    }
    let mut leases = runtime
        .leases
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .cloned()
        .collect::<Vec<_>>();
    leases.sort_by(|left, right| left.ip_address.cmp(&right.ip_address));
    DhcpServerStatus {
        running: !runtime.stop.load(Ordering::Relaxed),
        interface: runtime.interface.clone(),
        listen_address: "0.0.0.0:67".into(),
        error: runtime.error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        leases,
    }
}

#[tauri::command]
pub fn start_dhcp_server(config: DhcpServerConfig) -> CmdResult<DhcpServerStatus> {
    validate_dhcp_config(&config)?;
    let mut runtime = DHCP_RUNTIME.lock().unwrap_or_else(|e| e.into_inner());
    if runtime
        .as_ref()
        .is_some_and(|server| !server.stop.load(Ordering::Relaxed))
    {
        return Err("DHCP server is already running".into());
    }
    #[cfg(target_os = "macos")]
    let (privileged_label, lease_file, configured_address) = {
        let (label, path, address_added) = start_privileged_dhcp(&config)?;
        (
            Some(label),
            Some(path),
            address_added.then(|| config.server_address.clone()),
        )
    };

    #[cfg(not(target_os = "macos"))]
    let (privileged_label, lease_file, configured_address) = (None, None, None);

    #[cfg(not(target_os = "macos"))]
    let socket = bind_dhcp_socket(&config.interface).map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            SmartString::from(
                "DHCP needs permission to bind UDP port 67. Install/start the privileged service and try again",
            )
        } else if error.kind() == std::io::ErrorKind::AddrInUse {
            SmartString::from(
                "UDP port 67 is already in use. Disable the other DHCP server on this network before continuing",
            )
        } else {
            SmartString::from(format!("Failed to bind DHCP UDP port 67: {error}"))
        }
    })?;
    #[cfg(not(target_os = "macos"))]
    socket.set_broadcast(true).stringify_err()?;
    #[cfg(not(target_os = "macos"))]
    socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .stringify_err()?;
    let stop = Arc::new(AtomicBool::new(false));
    let leases = Arc::new(Mutex::new(HashMap::new()));
    let error = Arc::new(Mutex::new(None));
    #[cfg(not(target_os = "macos"))]
    {
        let thread_stop = Arc::clone(&stop);
        let thread_leases = Arc::clone(&leases);
        let thread_error = Arc::clone(&error);
        let thread_config = config.clone();
        std::thread::Builder::new()
            .name("clash-verge-gateway-dhcp".into())
            .spawn(move || run_dhcp_server(socket, thread_config, thread_stop, thread_leases, thread_error, None))
            .stringify_err()?;
    }
    *runtime = Some(DhcpRuntime {
        stop,
        interface: config.interface,
        leases,
        error,
        privileged_label,
        lease_file,
        configured_address,
    });
    drop(runtime);
    Ok(get_dhcp_server_status())
}

#[tauri::command]
pub fn stop_dhcp_server() -> DhcpServerStatus {
    let mut runtime = DHCP_RUNTIME.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(server) = runtime.as_ref() {
        server.stop.store(true, Ordering::Relaxed);
        #[cfg(target_os = "macos")]
        if let Some(label) = server.privileged_label.as_ref() {
            stop_privileged_dhcp(label, &server.interface, server.configured_address.as_deref());
        }
        if let Some(path) = server.lease_file.as_ref() {
            let _ = std::fs::remove_file(path);
        }
    }
    *runtime = None;
    DhcpServerStatus {
        running: false,
        interface: String::new(),
        listen_address: "0.0.0.0:67".into(),
        error: None,
        leases: Vec::new(),
    }
}

#[tauri::command]
pub fn clear_dhcp_leases() -> DhcpServerStatus {
    if let Some(server) = DHCP_RUNTIME.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        server.leases.lock().unwrap_or_else(|e| e.into_inner()).clear();
        if let Some(path) = server.lease_file.as_ref() {
            let empty = HashMap::new();
            let _ = write_lease_snapshot(path, &empty);
        }
    }
    get_dhcp_server_status()
}

#[cfg(test)]
mod dhcp_tests {
    use super::*;

    #[test]
    fn validates_pool_and_builds_offer() {
        let config = DhcpServerConfig {
            interface: "test".into(),
            server_address: "192.168.50.1".into(),
            pool_start: "192.168.50.100".into(),
            pool_end: "192.168.50.200".into(),
            subnet_mask: "255.255.255.0".into(),
            router: "192.168.50.1".into(),
            dns: "192.168.50.1".into(),
            lease_time_secs: 3600,
            reservations: Vec::new(),
        };
        let mut discover = vec![0_u8; 244];
        discover[1] = 1;
        discover[2] = 6;
        discover[4..8].copy_from_slice(&[1, 2, 3, 4]);
        discover[28..34].copy_from_slice(&[0, 1, 2, 3, 4, 5]);
        discover[236..240].copy_from_slice(&[99, 130, 83, 99]);
        discover[240..244].copy_from_slice(&[53, 1, 1, 255]);
        let reply = build_dhcp_reply(&discover, 2, "192.168.50.100".parse().unwrap(), &config).unwrap();
        assert_eq!(dhcp_option(&reply, 53), Some(&[2][..]));
        assert_eq!(&reply[16..20], &[192, 168, 50, 100]);
    }

    #[test]
    fn reservation_wins_and_is_excluded_from_dynamic_pool() {
        let config = DhcpServerConfig {
            interface: "test".into(),
            server_address: "192.168.50.1".into(),
            pool_start: "192.168.50.120".into(),
            pool_end: "192.168.50.130".into(),
            subnet_mask: "255.255.255.0".into(),
            router: "192.168.50.1".into(),
            dns: "192.168.50.1".into(),
            lease_time_secs: 3600,
            reservations: vec![DhcpReservation {
                mac_address: "60:7D:09:94:57:2A".into(),
                ip_address: "192.168.50.120".into(),
            }],
        };
        let leases = HashMap::new();
        assert_eq!(
            allocate_address("60:7d:09:94:57:2a", None, &config, &leases),
            Some("192.168.50.120".parse().unwrap())
        );
        assert_eq!(
            allocate_address("00:11:22:33:44:55", None, &config, &leases),
            Some("192.168.50.121".parse().unwrap())
        );
    }
}
