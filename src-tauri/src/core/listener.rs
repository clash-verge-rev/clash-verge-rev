use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_logging::{Type as LogType, logging};
#[cfg(target_os = "macos")]
use network_interface::{NetworkInterface, NetworkInterfaceConfig as _};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};
use socket2::{Domain, Protocol, SockAddr, Socket, Type};
use std::{
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    str::FromStr as _,
};

/// The config key of the Mixed Port, named once so callers stop spelling it out.
pub(crate) const MIXED_PORT_KEY: &str = "mixed-port";

const PROXY_LISTENERS: [(&str, &str, &[ListenerTransport]); 5] = [
    (
        MIXED_PORT_KEY,
        "mixed",
        &[ListenerTransport::Tcp, ListenerTransport::Udp],
    ),
    ("socks-port", "socks", &[ListenerTransport::Tcp, ListenerTransport::Udp]),
    ("port", "http", &[ListenerTransport::Tcp]),
    ("redir-port", "redir", &[ListenerTransport::Tcp]),
    (
        "tproxy-port",
        "tproxy",
        &[ListenerTransport::Tcp, ListenerTransport::Udp],
    ),
];

/// The config key of every proxy listener.
///
/// Callers that need "every listener except one" filter this rather than keeping their own
/// list, so adding a listener cannot be half-applied.
pub(crate) fn proxy_listener_keys() -> impl Iterator<Item = &'static str> {
    PROXY_LISTENERS.iter().map(|(key, _, _)| *key)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyPortSettings {
    pub mixed_port: u16,
    pub socks: ToggleableProxyPort,
    pub http: ToggleableProxyPort,
    pub redir: ToggleableProxyPort,
    pub tproxy: ToggleableProxyPort,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct ToggleableProxyPort {
    pub enabled: bool,
    pub port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerProbe {
    pub address: String,
    pub transports: Vec<ListenerTransport>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ListenerTransport {
    Tcp,
    Udp,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ListenerProbeOutcome {
    Available,
    Conflict { port: u16, transport: ListenerTransport },
    Invalid { message: String },
    Indeterminate { message: String },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveProxyPortsOutcome {
    Saved,
    Conflict { port: u16, transport: ListenerTransport },
}

#[derive(Clone, Debug)]
pub(crate) struct ListenerBindScope {
    addresses: Vec<IpAddr>,
}

impl ListenerBindScope {
    pub(crate) fn from_mapping(config: &Mapping) -> Result<Self> {
        Ok(Self {
            addresses: proxy_bind_addresses(config)?,
        })
    }

    pub(crate) fn probe_mixed_port(&self, port: u16) -> ListenerProbeOutcome {
        let claims = self
            .addresses
            .iter()
            .copied()
            .flat_map(|address| {
                [ListenerTransport::Tcp, ListenerTransport::Udp]
                    .into_iter()
                    .map(move |transport| BindClaim::new("mixed", address, port, transport))
            })
            .collect::<Vec<_>>();
        probe_claims(&claims)
    }

    /// Whether `port` is provably free — for picking a replacement, where anything short of
    /// proof should skip the candidate.
    pub(crate) fn mixed_port_is_available(&self, port: u16) -> bool {
        matches!(self.probe_mixed_port(port), ListenerProbeOutcome::Available)
    }
}

impl ProxyPortSettings {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.mixed_port == 0 {
            bail!("mixed proxy port must be between 1 and 65535");
        }
        for (name, listener) in [
            ("SOCKS", self.socks),
            ("HTTP", self.http),
            ("redir", self.redir),
            ("TProxy", self.tproxy),
        ] {
            if listener.port == 0 {
                bail!("{name} proxy port must be between 1 and 65535");
            }
        }
        Ok(())
    }
}

struct BindClaim {
    name: &'static str,
    address: IpAddr,
    port: u16,
    transport: ListenerTransport,
}

impl BindClaim {
    const fn new(name: &'static str, address: IpAddr, port: u16, transport: ListenerTransport) -> Self {
        Self {
            name,
            address,
            port,
            transport,
        }
    }

    const fn socket_addr(&self) -> SocketAddr {
        SocketAddr::new(self.address, self.port)
    }
}

pub(crate) fn probe_listener(request: &ListenerProbe) -> ListenerProbeOutcome {
    let (addresses, port) = match parse_listener_address(&request.address) {
        Ok(address) => address,
        Err(error) => {
            return ListenerProbeOutcome::Invalid {
                message: error.to_string(),
            };
        }
    };
    let mut transports = Vec::with_capacity(request.transports.len());
    for transport in request.transports.iter().copied() {
        if !transports.contains(&transport) {
            transports.push(transport);
        }
    }
    if transports.is_empty() {
        return ListenerProbeOutcome::Invalid {
            message: "listener transport list cannot be empty".into(),
        };
    }

    let claims = addresses
        .into_iter()
        .flat_map(|address| {
            transports
                .iter()
                .copied()
                .map(move |transport| BindClaim::new("listener", address, port, transport))
        })
        .collect::<Vec<_>>();
    probe_claims(&claims)
}

pub(crate) fn probe_proxy_port_change(
    current: &Mapping,
    candidate: &Mapping,
    current_core_is_running: bool,
) -> ListenerProbeOutcome {
    let current_claims = if current_core_is_running {
        match proxy_claims(current) {
            Ok(claims) => claims,
            Err(error) => {
                return ListenerProbeOutcome::Invalid {
                    message: format!("current proxy listener configuration is invalid: {error:#}"),
                };
            }
        }
    } else {
        Vec::new()
    };
    let mut candidate_claims = match proxy_claims(candidate) {
        Ok(claims) => claims,
        Err(error) => {
            return ListenerProbeOutcome::Invalid {
                message: format!("candidate proxy listener configuration is invalid: {error:#}"),
            };
        }
    };

    if let Some(conflict) = internal_conflict(&candidate_claims) {
        return conflict;
    }

    // A running core releases its proxy sockets during the coordinated restart.
    candidate_claims.retain(|candidate| !current_claims.iter().any(|current| claims_overlap(current, candidate)));
    probe_claims(&candidate_claims)
}

fn proxy_claims(config: &Mapping) -> Result<Vec<BindClaim>> {
    let addresses = proxy_bind_addresses(config)?;
    let mut claims = Vec::new();
    for (key, name, transports) in PROXY_LISTENERS {
        #[cfg(target_os = "windows")]
        if matches!(key, "redir-port" | "tproxy-port") {
            continue;
        }
        let Some(port) = mapping_port(config, key)? else {
            continue;
        };
        for address in &addresses {
            for transport in transports {
                claims.push(BindClaim::new(name, *address, port, *transport));
            }
        }
    }
    Ok(claims)
}

fn proxy_bind_addresses(config: &Mapping) -> Result<Vec<IpAddr>> {
    let ipv6 = config.get("ipv6").and_then(Value::as_bool).unwrap_or(true);
    let allow_lan = config.get("allow-lan").and_then(Value::as_bool).unwrap_or(false);

    if !allow_lan {
        return Ok(vec![IpAddr::V4(Ipv4Addr::LOCALHOST)]);
    }

    let bind_address = config
        .get("bind-address")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .unwrap_or("*");
    if bind_address == "*" {
        let mut addresses = vec![IpAddr::V4(Ipv4Addr::UNSPECIFIED)];
        if ipv6 {
            addresses.push(IpAddr::V6(Ipv6Addr::UNSPECIFIED));
        }
        return Ok(addresses);
    }
    if bind_address.eq_ignore_ascii_case("localhost") {
        return Ok(vec![IpAddr::V4(Ipv4Addr::LOCALHOST)]);
    }

    let normalized = bind_address
        .strip_prefix('[')
        .and_then(|address| address.strip_suffix(']'))
        .unwrap_or(bind_address);
    Ok(vec![
        IpAddr::from_str(normalized).with_context(|| format!("invalid bind-address {bind_address:?}"))?,
    ])
}

fn parse_listener_address(address: &str) -> Result<(Vec<IpAddr>, u16)> {
    let address = address.trim();
    if let Ok(socket) = SocketAddr::from_str(address) {
        if socket.port() == 0 {
            bail!("listener port must be between 1 and 65535");
        }
        return Ok((vec![socket.ip()], socket.port()));
    }

    let (host, port) = address
        .rsplit_once(':')
        .ok_or_else(|| anyhow!("listener address must include a port"))?;
    let port = port
        .parse::<u16>()
        .with_context(|| format!("invalid listener port {port:?}"))?;
    if port == 0 {
        bail!("listener port must be between 1 and 65535");
    }
    let host = host
        .trim()
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or_else(|| host.trim());
    if host.eq_ignore_ascii_case("localhost") {
        return Ok((vec![IpAddr::V4(Ipv4Addr::LOCALHOST)], port));
    }
    Ok((
        vec![IpAddr::from_str(host).with_context(|| format!("invalid listener host {host:?}"))?],
        port,
    ))
}

fn mapping_port(config: &Mapping, key: &str) -> Result<Option<u16>> {
    let Some(value) = config.get(key) else {
        return Ok(None);
    };
    let port = match value {
        Value::Number(port) => port.as_u64().and_then(|port| u16::try_from(port).ok()),
        Value::String(port) => port.parse().ok(),
        _ => None,
    }
    .ok_or_else(|| anyhow!("{key} must be an integer between 1 and 65535"))?;
    if port == 0 {
        bail!("{key} must be an integer between 1 and 65535");
    }
    Ok(Some(port))
}

fn internal_conflict(claims: &[BindClaim]) -> Option<ListenerProbeOutcome> {
    for (index, claim) in claims.iter().enumerate() {
        if claims[..index].iter().any(|existing| claims_overlap(existing, claim)) {
            return Some(conflict_outcome(claim));
        }
    }
    None
}

fn claims_overlap(left: &BindClaim, right: &BindClaim) -> bool {
    left.port == right.port
        && left.transport == right.transport
        && left.address.is_ipv4() == right.address.is_ipv4()
        && (left.address == right.address || left.address.is_unspecified() || right.address.is_unspecified())
}

/// Whether a refused bind can be dismissed because nothing is actually serving the claim.
///
/// A refused bind is not proof a port is in use: `SO_REUSEADDR` cannot reuse a `TIME_WAIT` socket
/// owned by a *different* user, and a service-managed Core runs as root while this process does
/// not. So every port the Core used is briefly unbindable here even though the Core itself could
/// rebind it at once (measured on macOS 26). "Is anything answering?" survives that asymmetry;
/// "can I bind?" does not.
///
/// Restrictions, both deliberate: a wildcard claim can be blocked by a listener on any address, so
/// one refused connection cannot clear it — leaving `allow-lan` setups exposed to the same false
/// positive. UDP has no lingering state, so a refused UDP bind is always a live socket.
fn nothing_is_serving(claim: &BindClaim) -> bool {
    const ANSWER_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(200);

    if claim.transport != ListenerTransport::Tcp || claim.address.is_unspecified() {
        return false;
    }
    // Only an explicit refusal proves absence; a timeout leaves the question open.
    matches!(
        std::net::TcpStream::connect_timeout(&claim.socket_addr(), ANSWER_TIMEOUT),
        Err(error) if error.kind() == io::ErrorKind::ConnectionRefused
    )
}

fn probe_claims(claims: &[BindClaim]) -> ListenerProbeOutcome {
    let mut sockets = Vec::with_capacity(claims.len());
    for claim in claims {
        match bind_claim(claim) {
            Ok(mut bound) => sockets.append(&mut bound),
            Err(error) if is_bind_conflict(&error) => {
                if nothing_is_serving(claim) {
                    logging!(
                        info,
                        LogType::Network,
                        "{} could not bind {} ({}), but nothing answers there; treating it as free",
                        claim.name,
                        claim.socket_addr(),
                        error
                    );
                    continue;
                }
                logging!(
                    warn,
                    LogType::Network,
                    "{} cannot claim {} over {}: {}",
                    claim.name,
                    claim.socket_addr(),
                    transport_name(claim.transport),
                    error
                );
                return conflict_outcome(claim);
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::AddrNotAvailable | io::ErrorKind::InvalidInput | io::ErrorKind::Unsupported
                ) =>
            {
                return ListenerProbeOutcome::Invalid {
                    message: format!(
                        "{} cannot listen on {} over {}: {}",
                        claim.name,
                        claim.socket_addr(),
                        transport_name(claim.transport),
                        error
                    ),
                };
            }
            Err(error) => {
                return ListenerProbeOutcome::Indeterminate {
                    message: format!(
                        "unable to verify {} on {} over {}: {}",
                        claim.name,
                        claim.socket_addr(),
                        transport_name(claim.transport),
                        error
                    ),
                };
            }
        }
    }
    // No one-socket-per-claim assertion: a dismissed claim is one this process never bound.
    drop(sockets);
    ListenerProbeOutcome::Available
}

fn bind_claim(claim: &BindClaim) -> io::Result<Vec<Socket>> {
    let mut sockets = Vec::new();
    #[cfg(target_os = "macos")]
    if claim.transport == ListenerTransport::Tcp {
        // Darwin permits live wildcard and specific listeners to coexist with SO_REUSEADDR.
        // Hold every overlapping form while probing so they still report a conflict.
        let mut guard_addresses = if claim.address.is_unspecified() {
            NetworkInterface::show()
                .unwrap_or_else(|error| {
                    // Losing the interface list shrinks the guard to loopback — say so.
                    logging!(
                        warn,
                        LogType::Network,
                        "unable to enumerate interfaces while probing {}; \
                         only loopback guards the wildcard claim: {error}",
                        claim.socket_addr()
                    );
                    Vec::new()
                })
                .into_iter()
                .flat_map(|interface| interface.addr)
                .map(|address| address.ip())
                .filter(|candidate| {
                    // Link-local addresses are the likeliest to vanish mid-probe.
                    candidate.is_ipv4() == claim.address.is_ipv4()
                        && match candidate {
                            IpAddr::V4(address) => !address.is_unspecified() && !address.is_link_local(),
                            IpAddr::V6(address) => !address.is_unspecified() && !address.is_unicast_link_local(),
                        }
                })
                .collect::<Vec<_>>()
        } else {
            vec![if claim.address.is_ipv4() {
                IpAddr::V4(Ipv4Addr::UNSPECIFIED)
            } else {
                IpAddr::V6(Ipv6Addr::UNSPECIFIED)
            }]
        };
        if claim.address.is_unspecified() {
            guard_addresses.push(if claim.address.is_ipv4() {
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            } else {
                IpAddr::V6(Ipv6Addr::LOCALHOST)
            });
        }
        guard_addresses.sort_unstable();
        guard_addresses.dedup();
        for address in guard_addresses {
            match bind_socket(&BindClaim::new(claim.name, address, claim.port, claim.transport)) {
                Ok(socket) => sockets.push(socket),
                // Only a conflict proves the port is taken; a vanished guard address proves nothing.
                Err(error) if is_bind_conflict(&error) => {
                    // The caller only sees the claim, so name the address that actually lost.
                    logging!(
                        warn,
                        LogType::Network,
                        "{} claiming {} could not hold the overlapping address {}: {}",
                        claim.name,
                        claim.socket_addr(),
                        SocketAddr::new(address, claim.port),
                        error
                    );
                    return Err(error);
                }
                Err(_) => {}
            }
        }
    }

    let socket = bind_socket(claim)?;
    if claim.transport == ListenerTransport::Tcp {
        socket.listen(1)?;
    }
    #[cfg(windows)]
    if claim.transport == ListenerTransport::Tcp
        && !claim.address.is_unspecified()
        && windows_wildcard_tcp_listener_exists(claim.address, claim.port)?
    {
        return Err(io::ErrorKind::AddrInUse.into());
    }
    sockets.push(socket);
    Ok(sockets)
}

fn bind_socket(claim: &BindClaim) -> io::Result<Socket> {
    let domain = if claim.address.is_ipv4() {
        Domain::IPV4
    } else {
        Domain::IPV6
    };
    let (socket_type, protocol) = match claim.transport {
        ListenerTransport::Tcp => (Type::STREAM, Protocol::TCP),
        ListenerTransport::Udp => (Type::DGRAM, Protocol::UDP),
    };
    let socket = Socket::new(domain, socket_type, Some(protocol))?;
    if claim.address.is_ipv6() {
        socket.set_only_v6(true)?;
    }
    // Unix can retain closed TCP connections after the previous listener exits.
    // Ignore that transient state. SO_REUSEPORT is intentionally never enabled;
    // Windows stays exclusive below, and macOS guards overlapping address forms above.
    socket.set_reuse_address(cfg!(unix) && matches!(claim.transport, ListenerTransport::Tcp))?;
    #[cfg(windows)]
    set_exclusive_address_use(&socket)?;
    socket.bind(&SockAddr::from(claim.socket_addr()))?;
    Ok(socket)
}

fn is_bind_conflict(error: &io::Error) -> bool {
    if error.kind() == io::ErrorKind::AddrInUse {
        return true;
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Networking::WinSock::WSAEACCES;

        error.raw_os_error() == Some(WSAEACCES)
    }
    #[cfg(not(windows))]
    false
}

#[cfg(windows)]
fn set_exclusive_address_use(socket: &Socket) -> io::Result<()> {
    use std::{mem::size_of, os::windows::io::AsRawSocket as _};
    use windows_sys::Win32::Networking::WinSock::{SO_EXCLUSIVEADDRUSE, SOCKET, SOCKET_ERROR, SOL_SOCKET, setsockopt};

    let enabled = 1i32;
    // Rust exposes `RawSocket` as `u64` for compatibility, while WinSock's
    // `SOCKET` is pointer-sized. The value originated from WinSock, so it fits
    // in `SOCKET` on every Windows target.
    let raw_socket = socket.as_raw_socket() as SOCKET;
    // SAFETY: the socket is valid and `enabled` remains alive for the duration of the call.
    let result = unsafe {
        setsockopt(
            raw_socket,
            SOL_SOCKET,
            SO_EXCLUSIVEADDRUSE,
            (&raw const enabled).cast(),
            size_of::<i32>() as i32,
        )
    };
    if result == SOCKET_ERROR {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn windows_wildcard_tcp_listener_exists(address: IpAddr, port: u16) -> io::Result<bool> {
    use windows_sys::Win32::{
        NetworkManagement::IpHelper::{MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID},
        Networking::WinSock::{AF_INET, AF_INET6},
    };

    let family = match address {
        IpAddr::V4(_) => u32::from(AF_INET),
        IpAddr::V6(_) => u32::from(AF_INET6),
    };
    let table = windows_tcp_listener_table(family)?;
    match address {
        IpAddr::V4(_) => Ok(windows_tcp_listener_rows::<MIB_TCPROW_OWNER_PID>(&table)?
            .iter()
            .any(|row| row.dwLocalAddr == 0 && windows_tcp_port(row.dwLocalPort) == port)),
        IpAddr::V6(_) => Ok(windows_tcp_listener_rows::<MIB_TCP6ROW_OWNER_PID>(&table)?
            .iter()
            .any(|row| row.ucLocalAddr == [0; 16] && windows_tcp_port(row.dwLocalPort) == port)),
    }
}

#[cfg(windows)]
fn windows_tcp_listener_table(family: u32) -> io::Result<Vec<u32>> {
    use std::{mem::size_of, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::ERROR_INSUFFICIENT_BUFFER,
        NetworkManagement::IpHelper::{GetExtendedTcpTable, TCP_TABLE_OWNER_PID_LISTENER},
    };

    let mut byte_count = 0;
    // SAFETY: a null table is the documented size-query form; `byte_count` is writable.
    let status = unsafe {
        GetExtendedTcpTable(
            null_mut(),
            &raw mut byte_count,
            0,
            family,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if status != ERROR_INSUFFICIENT_BUFFER {
        return Err(io::Error::from_raw_os_error(status.cast_signed()));
    }

    loop {
        let word_count = (byte_count as usize).div_ceil(size_of::<u32>());
        let mut table = vec![0u32; word_count];
        // SAFETY: `table` has at least `byte_count` writable bytes and the API updates
        // `byte_count` when the listener table grows between calls.
        let status = unsafe {
            GetExtendedTcpTable(
                table.as_mut_ptr().cast(),
                &raw mut byte_count,
                0,
                family,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        match status {
            0 => return Ok(table),
            ERROR_INSUFFICIENT_BUFFER => {}
            error => return Err(io::Error::from_raw_os_error(error.cast_signed())),
        }
    }
}

#[cfg(windows)]
fn windows_tcp_listener_rows<Row>(table: &[u32]) -> io::Result<&[Row]> {
    use std::mem::{align_of, size_of, size_of_val};

    let Some((&row_count, _)) = table.split_first() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Windows returned an empty TCP listener table",
        ));
    };
    let row_count = row_count as usize;
    let required_bytes = row_count
        .checked_mul(size_of::<Row>())
        .and_then(|rows| size_of::<u32>().checked_add(rows))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Windows TCP listener table is too large"))?;
    if required_bytes > size_of_val(table) || align_of::<Row>() > align_of::<u32>() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Windows returned a malformed TCP listener table",
        ));
    }

    // SAFETY: the size and alignment checks above cover `row_count` complete rows;
    // the API places them immediately after its u32 entry count.
    Ok(unsafe { std::slice::from_raw_parts(table.as_ptr().add(1).cast(), row_count) })
}

#[cfg(windows)]
const fn windows_tcp_port(raw_port: u32) -> u16 {
    u16::from_be(raw_port as u16)
}

const fn conflict_outcome(claim: &BindClaim) -> ListenerProbeOutcome {
    ListenerProbeOutcome::Conflict {
        port: claim.port,
        transport: claim.transport,
    }
}

const fn transport_name(transport: ListenerTransport) -> &'static str {
    match transport {
        ListenerTransport::Tcp => "TCP",
        ListenerTransport::Udp => "UDP",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BindClaim, ListenerBindScope, ListenerProbe, ListenerProbeOutcome, ListenerTransport, nothing_is_serving,
        probe_listener, probe_proxy_port_change,
    };
    use serde_json::json;
    use serde_yaml_ng::Mapping;
    #[cfg(unix)]
    use socket2::{Domain, Protocol, SockAddr, Socket, Type};
    use std::net::{IpAddr, Ipv4Addr, TcpListener, UdpSocket};
    #[cfg(unix)]
    use std::{
        io::Read as _,
        net::{Shutdown, SocketAddrV4, TcpStream},
    };

    fn mapping(yaml: &str) -> anyhow::Result<Mapping> {
        Ok(serde_yaml_ng::from_str(yaml)?)
    }

    /// The wildcard claim only reaches conflicts through the enumerated guards.
    #[cfg(target_os = "macos")]
    #[test]
    fn probe_reports_interface_tcp_listener_conflicts_for_the_wildcard_address() -> anyhow::Result<()> {
        use network_interface::{NetworkInterface, NetworkInterfaceConfig as _};
        use std::net::IpAddr;

        let Some(address) = NetworkInterface::show()?
            .into_iter()
            .flat_map(|interface| interface.addr)
            .map(|address| address.ip())
            .find(|address| match address {
                IpAddr::V4(address) => !address.is_loopback() && !address.is_unspecified() && !address.is_link_local(),
                IpAddr::V6(_) => false,
            })
        else {
            // A host with no routable IPv4 address cannot host this conflict.
            return Ok(());
        };

        let listener = TcpListener::bind((address, 0))?;
        let port = listener.local_addr()?.port();
        assert_eq!(
            probe_listener(&ListenerProbe {
                address: format!("0.0.0.0:{port}"),
                transports: vec![ListenerTransport::Tcp],
            }),
            ListenerProbeOutcome::Conflict {
                port,
                transport: ListenerTransport::Tcp
            }
        );
        Ok(())
    }

    #[test]
    fn probe_reports_tcp_conflicts_on_the_requested_address() -> anyhow::Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let outcome = probe_listener(&ListenerProbe {
            address: format!("127.0.0.1:{port}"),
            transports: vec![ListenerTransport::Tcp],
        });
        assert_eq!(
            outcome,
            ListenerProbeOutcome::Conflict {
                port,
                transport: ListenerTransport::Tcp
            }
        );
        Ok(())
    }

    #[test]
    fn probe_reports_wildcard_tcp_listener_conflicts_for_specific_address() -> anyhow::Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))?;
        let port = listener.local_addr()?.port();
        let outcome = probe_listener(&ListenerProbe {
            address: format!("127.0.0.1:{port}"),
            transports: vec![ListenerTransport::Tcp],
        });
        assert_eq!(
            outcome,
            ListenerProbeOutcome::Conflict {
                port,
                transport: ListenerTransport::Tcp
            }
        );
        Ok(())
    }

    /// Guards the startup false positive: another user's `TIME_WAIT` makes the kernel refuse the
    /// bind while nothing is serving. That refusal needs a second uid to stage, so this asserts
    /// on the classifier directly.
    #[test]
    fn a_refused_bind_with_nothing_answering_is_not_a_conflict() -> anyhow::Result<()> {
        let vacant = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = vacant.local_addr()?.port();
        drop(vacant);

        assert!(
            nothing_is_serving(&BindClaim::new(
                "mixed",
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                port,
                ListenerTransport::Tcp
            )),
            "a port nobody listens on must be dismissable"
        );

        let serving = TcpListener::bind((Ipv4Addr::LOCALHOST, port))?;
        assert!(
            !nothing_is_serving(&BindClaim::new(
                "mixed",
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                port,
                ListenerTransport::Tcp
            )),
            "a live listener must never be dismissed"
        );
        drop(serving);
        Ok(())
    }

    /// UDP has no lingering state, so a refused UDP bind is always a live socket.
    #[test]
    fn a_refused_udp_bind_is_never_dismissed() -> anyhow::Result<()> {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = socket.local_addr()?.port();
        assert!(!nothing_is_serving(&BindClaim::new(
            "mixed",
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            port,
            ListenerTransport::Udp
        )));
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn probe_reuses_port_held_only_by_a_stale_tcp_connection() -> anyhow::Result<()> {
        let listener = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
        listener.set_reuse_address(true)?;
        listener.bind(&SockAddr::from(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))?;
        listener.listen(1)?;
        let port = listener
            .local_addr()?
            .as_socket()
            .ok_or_else(|| anyhow::anyhow!("TCP listener did not expose an IP socket address"))?
            .port();

        let mut client = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
        let (connection, _) = listener.accept()?;
        drop(listener);
        connection.shutdown(Shutdown::Write)?;
        let mut eof = [0u8; 1];
        assert_eq!(client.read(&mut eof)?, 0);
        drop(connection);

        assert_eq!(
            probe_listener(&ListenerProbe {
                address: format!("127.0.0.1:{port}"),
                transports: vec![ListenerTransport::Tcp],
            }),
            ListenerProbeOutcome::Available
        );
        Ok(())
    }

    #[test]
    fn probe_reports_udp_conflicts_on_the_requested_address() -> anyhow::Result<()> {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = socket.local_addr()?.port();
        let outcome = probe_listener(&ListenerProbe {
            address: format!("127.0.0.1:{port}"),
            transports: vec![ListenerTransport::Udp],
        });
        assert_eq!(
            outcome,
            ListenerProbeOutcome::Conflict {
                port,
                transport: ListenerTransport::Udp
            }
        );
        Ok(())
    }

    #[test]
    fn probe_does_not_treat_invalid_addresses_as_available() {
        let outcome = probe_listener(&ListenerProbe {
            address: "not-a-listener".into(),
            transports: vec![ListenerTransport::Tcp],
        });
        assert!(matches!(outcome, ListenerProbeOutcome::Invalid { .. }));
    }

    #[test]
    fn localhost_matches_mihomo_ipv4_resolution() -> anyhow::Result<()> {
        let (addresses, port) = super::parse_listener_address("localhost:7890")?;
        assert_eq!(addresses, vec![std::net::IpAddr::V4(Ipv4Addr::LOCALHOST)]);
        assert_eq!(port, 7890);

        let proxy_addresses =
            super::proxy_bind_addresses(&mapping("allow-lan: true\nbind-address: localhost\nipv6: true\n")?)?;
        assert_eq!(proxy_addresses, addresses);
        Ok(())
    }

    #[test]
    fn proxy_probe_skips_sockets_owned_by_the_running_core() -> anyhow::Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let runtime = mapping(&format!("ipv6: false\nmixed-port: {port}\n"))?;
        assert_eq!(
            probe_proxy_port_change(&runtime, &runtime, true),
            ListenerProbeOutcome::Available
        );
        assert!(matches!(
            probe_proxy_port_change(&runtime, &runtime, false),
            ListenerProbeOutcome::Conflict { .. }
        ));
        Ok(())
    }

    #[test]
    fn proxy_probe_rejects_duplicate_candidate_ports() -> anyhow::Result<()> {
        let current = mapping("ipv6: false\nmixed-port: 31000\n")?;
        let candidate = mapping("ipv6: false\nmixed-port: 31001\nsocks-port: 31001\n")?;
        assert_eq!(
            probe_proxy_port_change(&current, &candidate, true),
            ListenerProbeOutcome::Conflict {
                port: 31001,
                transport: ListenerTransport::Tcp
            }
        );
        Ok(())
    }

    #[test]
    fn proxy_probe_checks_udp_for_mixed_and_socks_ports() -> anyhow::Result<()> {
        for key in ["mixed-port", "socks-port"] {
            let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
            let port = socket.local_addr()?.port();
            // Exclude the running core's TCP claim so this assertion isolates UDP
            // without depending on process-global TCP port availability.
            let current = mapping(&format!("ipv6: false\nport: {port}\n"))?;
            let candidate = mapping(&format!("ipv6: false\n{key}: {port}\n"))?;
            assert_eq!(
                probe_proxy_port_change(&current, &candidate, true),
                ListenerProbeOutcome::Conflict {
                    port,
                    transport: ListenerTransport::Udp
                }
            );
        }
        Ok(())
    }

    #[test]
    fn startup_scope_uses_the_runtime_lan_binding() -> anyhow::Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let scope =
            ListenerBindScope::from_mapping(&mapping("allow-lan: true\nbind-address: 0.0.0.0\nipv6: false\n")?)?;
        assert!(!scope.mixed_port_is_available(port));
        Ok(())
    }

    /// The startup fallback only moves on a proven `Conflict`, so a taken port must report one.
    #[test]
    fn startup_scope_reports_a_conflict_rather_than_an_unreachable_answer() -> anyhow::Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let scope = ListenerBindScope::from_mapping(&mapping("ipv6: false\n")?)?;
        assert!(matches!(
            scope.probe_mixed_port(port),
            ListenerProbeOutcome::Conflict { .. }
        ));
        Ok(())
    }

    #[test]
    fn startup_scope_rejects_udp_only_conflicts() -> anyhow::Result<()> {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = socket.local_addr()?.port();
        let scope = ListenerBindScope::from_mapping(&mapping("ipv6: false\n")?)?;
        assert!(!scope.mixed_port_is_available(port));
        Ok(())
    }

    #[test]
    fn proxy_settings_keep_the_camel_case_command_contract() -> anyhow::Result<()> {
        let settings = serde_json::from_value::<super::ProxyPortSettings>(json!({
            "mixedPort": 7897,
            "socks": { "enabled": false, "port": 7898 },
            "http": { "enabled": false, "port": 7899 },
            "redir": { "enabled": false, "port": 7895 },
            "tproxy": { "enabled": false, "port": 7896 }
        }))?;
        assert_eq!(settings.mixed_port, 7897);
        Ok(())
    }
}
