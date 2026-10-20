//! Detect whether the physical underlay network currently offers usable native IPv6.
//!
//! Interface addresses are inspected instead of routes or the default route: with the TUN
//! active the system default route may point into Mihomo's own tunnel, so a route lookup can
//! mistake the tunnel's fake IPv6 addresses for native connectivity. No third-party endpoint is
//! contacted, to keep the probe inside the machine. An assigned address is a best-effort signal
//! only: it does not guarantee a working route.

use std::{
    collections::BTreeMap,
    ffi::CStr,
    io,
    net::{Ipv4Addr, Ipv6Addr},
    ptr,
    sync::atomic::{AtomicU8, Ordering},
};

/// Flags an interface needs before its addresses are considered.
const REQUIRED_FLAGS: libc::c_uint = (libc::IFF_UP | libc::IFF_RUNNING) as libc::c_uint;
const LOOPBACK_FLAG: libc::c_uint = libc::IFF_LOOPBACK as libc::c_uint;

/// Names that never denote the physical underlay: loopback, tunnels, VPNs, bridges, container
/// pairs and Apple's internal links.
const VIRTUAL_PREFIXES: [&str; 23] = [
    "lo",
    "utun",
    "tun",
    "tap",
    "wg",
    "ipsec",
    "ppp",
    "bridge",
    "br-",
    "virbr",
    "docker",
    "veth",
    "vmnet",
    "vmenet",
    "gif",
    "stf",
    "awdl",
    "llw",
    "anpi",
    "p2p",
    "zt",
    "tailscale",
    "ap",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Ipv6Underlay {
    Unknown = 0,
    Available = 1,
    Unavailable = 2,
}

impl Ipv6Underlay {
    const fn encode(self) -> u8 {
        self as u8
    }

    const fn decode(value: u8) -> Self {
        match value {
            1 => Self::Available,
            2 => Self::Unavailable,
            _ => Self::Unknown,
        }
    }
}

// The cache guards no other memory; a stale read only delays the decision, so Relaxed is enough.
static UNDERLAY: AtomicU8 = AtomicU8::new(Ipv6Underlay::Unknown.encode());

pub(crate) fn cached() -> Ipv6Underlay {
    Ipv6Underlay::decode(UNDERLAY.load(Ordering::Relaxed))
}

pub(crate) fn store(state: Ipv6Underlay) {
    UNDERLAY.store(state.encode(), Ordering::Relaxed);
}

/// Blocking. Returns [`Ipv6Underlay::Unknown`] only when the interface list cannot be read.
pub(crate) fn probe() -> Ipv6Underlay {
    match read_interfaces() {
        Ok(interfaces) => classify(&interfaces),
        Err(_) => Ipv6Underlay::Unknown,
    }
}

struct Interface {
    name: String,
    up: bool,
    v4: Vec<Ipv4Addr>,
    v6: Vec<Ipv6Addr>,
}

fn classify(interfaces: &[Interface]) -> Ipv6Underlay {
    let available = interfaces.iter().any(|interface| {
        interface.up
            && !is_virtual_interface(&interface.name)
            && !has_mihomo_address(interface)
            && interface.v6.iter().any(is_usable_v6)
    });
    if available {
        Ipv6Underlay::Available
    } else {
        Ipv6Underlay::Unavailable
    }
}

fn is_virtual_interface(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    VIRTUAL_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

fn has_mihomo_address(interface: &Interface) -> bool {
    interface.v4.iter().any(|addr| is_mihomo_v4(*addr)) || interface.v6.iter().any(is_mihomo_v6)
}

const fn is_mihomo_v4(addr: Ipv4Addr) -> bool {
    let octets = addr.octets();
    octets[0] == 198 && octets[1] == 18
}

const fn is_mihomo_v6(addr: &Ipv6Addr) -> bool {
    let o = addr.octets();
    matches!(o, [0x20, 0x01, 0x00, 0x02, 0, 0, 0, 0, ..]) || matches!(o, [0xfd, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0, 0, ..])
}

const fn is_usable_v6(addr: &Ipv6Addr) -> bool {
    let o = addr.octets();
    if matches!(o, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        || matches!(o, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
        || o[0] == 0xff
        || (o[0] == 0xfe && (o[1] & 0xc0) == 0x80)
        || is_mihomo_v6(addr)
    {
        return false;
    }
    (o[0] & 0xe0) == 0x20 || (o[0] & 0xfe) == 0xfc
}

/// Owns the list returned by `getifaddrs`, so both the success and the error path free it.
struct IfAddrs(*mut libc::ifaddrs);

impl Drop for IfAddrs {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the pointer is the list head returned by `getifaddrs`, freed exactly once.
            unsafe { libc::freeifaddrs(self.0) };
        }
    }
}

fn read_interfaces() -> io::Result<Vec<Interface>> {
    let mut list = ptr::null_mut();
    // SAFETY: `list` is a valid out-parameter for the duration of the call.
    if unsafe { libc::getifaddrs(&mut list) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let list = IfAddrs(list);

    let mut interfaces: BTreeMap<String, Interface> = BTreeMap::new();
    let mut cursor = list.0;
    while !cursor.is_null() {
        // SAFETY: `cursor` is a non-null node of the list owned by `list`.
        let entry = unsafe { &*cursor };
        cursor = entry.ifa_next;

        if entry.ifa_name.is_null() {
            continue;
        }
        // SAFETY: `ifa_name` is a NUL-terminated string owned by the list.
        let name = unsafe { CStr::from_ptr(entry.ifa_name) }.to_string_lossy().into_owned();
        let interface = interfaces.entry(name).or_insert_with_key(|name| Interface {
            name: name.clone(),
            up: false,
            v4: Vec::new(),
            v6: Vec::new(),
        });

        let flags = entry.ifa_flags;
        interface.up |= (flags & REQUIRED_FLAGS) == REQUIRED_FLAGS && (flags & LOOPBACK_FLAG) == 0;

        if entry.ifa_addr.is_null() {
            continue;
        }
        // SAFETY: a non-null `ifa_addr` points to a valid `sockaddr`, whose family selects the
        // concrete layout below.
        match unsafe { (*entry.ifa_addr).sa_family as libc::c_int } {
            libc::AF_INET => {
                // SAFETY: `sa_family == AF_INET` means the `sockaddr` is a `sockaddr_in`.
                let addr = unsafe { &*entry.ifa_addr.cast::<libc::sockaddr_in>() };
                // `s_addr` is network-order; in-memory bytes are the octets in address order.
                let octets = addr.sin_addr.s_addr.to_ne_bytes();
                interface
                    .v4
                    .push(Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]));
            }
            libc::AF_INET6 => {
                // SAFETY: `sa_family == AF_INET6` means the `sockaddr` is a `sockaddr_in6`.
                let addr = unsafe { &*entry.ifa_addr.cast::<libc::sockaddr_in6>() };
                interface.v6.push(Ipv6Addr::from(addr.sin6_addr.s6_addr));
            }
            _ => {}
        }
    }

    Ok(interfaces.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GLOBAL: [u16; 8] = [0x2606, 0x4700, 0, 0, 0, 0, 0, 1];
    const LINK_LOCAL: [u16; 8] = [0xfe80, 0, 0, 0, 0, 0, 0, 1];
    const ULA: [u16; 8] = [0xfd00, 0, 0, 0, 0, 0, 0, 1];

    fn interface(name: &str, up: bool, v4: Vec<Ipv4Addr>, v6: Vec<Ipv6Addr>) -> Interface {
        Interface {
            name: name.to_owned(),
            up,
            v4,
            v6,
        }
    }

    fn v6(segments: [u16; 8]) -> Ipv6Addr {
        Ipv6Addr::new(
            segments[0],
            segments[1],
            segments[2],
            segments[3],
            segments[4],
            segments[5],
            segments[6],
            segments[7],
        )
    }

    fn v4(a: u8, b: u8, c: u8, d: u8) -> Ipv4Addr {
        Ipv4Addr::new(a, b, c, d)
    }

    #[test]
    fn physical_interface_with_global_address_is_available() {
        let interfaces = [interface("en0", true, Vec::new(), vec![v6(GLOBAL)])];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Available);
    }

    #[test]
    fn tunnel_interface_is_not_available() {
        let interfaces = [interface("utun4", true, Vec::new(), vec![v6(GLOBAL)])];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Unavailable);
    }

    #[test]
    fn link_local_only_is_not_available() {
        let interfaces = [interface("en0", true, Vec::new(), vec![v6(LINK_LOCAL)])];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Unavailable);
    }

    #[test]
    fn loopback_interface_is_not_available() {
        let interfaces = [interface("lo0", true, Vec::new(), vec![Ipv6Addr::LOCALHOST])];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Unavailable);
    }

    #[test]
    fn interface_carrying_mihomo_fake_ipv4_is_not_available() {
        let interfaces = [interface("en9", true, vec![v4(198, 18, 0, 1)], vec![v6(GLOBAL)])];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Unavailable);
    }

    #[test]
    fn down_interface_is_not_available() {
        let interfaces = [interface("en0", false, Vec::new(), vec![v6(GLOBAL)])];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Unavailable);
    }

    #[test]
    fn ipv4_only_interface_is_not_available() {
        let interfaces = [interface("en0", true, vec![v4(192, 168, 1, 2)], Vec::new())];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Unavailable);
    }

    #[test]
    fn unique_local_address_is_available() {
        let interfaces = [interface("en0", true, Vec::new(), vec![v6(ULA)])];
        assert_eq!(classify(&interfaces), Ipv6Underlay::Available);
    }

    #[test]
    fn mihomo_fake_ipv6_ranges_are_not_available() {
        let nat64 = [0x2001, 0x0002, 0, 0, 0, 0, 0, 1];
        let fake = [0xfdfe, 0xdcba, 0x9876, 0, 0, 0, 0, 1];
        for segments in [nat64, fake] {
            let interfaces = [interface("en0", true, Vec::new(), vec![v6(segments)])];
            assert_eq!(classify(&interfaces), Ipv6Underlay::Unavailable);
        }
    }

    #[test]
    fn cache_round_trips_states() {
        store(Ipv6Underlay::Available);
        assert_eq!(cached(), Ipv6Underlay::Available);
        store(Ipv6Underlay::Unavailable);
        assert_eq!(cached(), Ipv6Underlay::Unavailable);
    }
}
