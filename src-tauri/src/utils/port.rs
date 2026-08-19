use std::collections::HashSet;

pub const MIN_FALLBACK_PORT: u16 = 1025;

pub fn find_next_available_port<F>(current: u16, reserved: &HashSet<u16>, mut is_available: F) -> Option<u16>
where
    F: FnMut(u16) -> bool,
{
    let mut candidate = next_candidate(current);

    for _ in MIN_FALLBACK_PORT..=u16::MAX {
        if candidate != current && !reserved.contains(&candidate) && is_available(candidate) {
            return Some(candidate);
        }
        candidate = next_candidate(candidate);
    }

    None
}

const fn next_candidate(port: u16) -> u16 {
    if port < MIN_FALLBACK_PORT || port == u16::MAX {
        MIN_FALLBACK_PORT
    } else {
        port + 1
    }
}

#[cfg(test)]
mod tests {
    use super::{MIN_FALLBACK_PORT, find_next_available_port};
    use std::collections::HashSet;

    #[test]
    fn skips_reserved_and_unavailable_ports() {
        let reserved = HashSet::from([7898, 7899]);
        let port = find_next_available_port(7897, &reserved, |candidate| candidate != 7900);
        assert_eq!(port, Some(7901));
    }

    #[test]
    fn wraps_after_the_highest_port() {
        let reserved = HashSet::from([MIN_FALLBACK_PORT]);
        let port = find_next_available_port(u16::MAX, &reserved, |_| true);
        assert_eq!(port, Some(MIN_FALLBACK_PORT + 1));
    }

    #[test]
    fn never_returns_the_current_port() {
        let port = find_next_available_port(20_000, &HashSet::new(), |candidate| candidate == 20_000);
        assert_eq!(port, None);
    }
}
