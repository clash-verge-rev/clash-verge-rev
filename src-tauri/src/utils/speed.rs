/// Promote units before the rendered value exceeds three digits.
const SPEED_DISPLAY_THRESHOLD: f64 = 1000.0;
const SPEED_UNITS: [&str; 5] = ["B/s", "K/s", "M/s", "G/s", "T/s"];
const SCALES: [f64; 5] = [
    1.0,
    1024.0,
    1024.0 * 1024.0,
    1024.0 * 1024.0 * 1024.0,
    1024.0 * 1024.0 * 1024.0 * 1024.0,
];

pub fn format_bytes_per_second(bytes_per_sec: u64) -> String {
    if bytes_per_sec < SPEED_DISPLAY_THRESHOLD as u64 {
        return format!("{bytes_per_sec}B/s");
    }

    let mut unit_index = (bytes_per_sec.ilog2() / 10) as usize;
    unit_index = unit_index.min(SPEED_UNITS.len() - 1);

    let mut value = bytes_per_sec as f64 / SCALES[unit_index];

    if value.round() >= SPEED_DISPLAY_THRESHOLD && unit_index < SPEED_UNITS.len() - 1 {
        unit_index += 1;
        value = bytes_per_sec as f64 / SCALES[unit_index];
    }

    if value < 9.95 {
        format!("{value:.1}{}", SPEED_UNITS[unit_index])
    } else {
        format!("{:.0}{}", value.round(), SPEED_UNITS[unit_index])
    }
}

#[cfg(test)]
mod tests {
    use super::format_bytes_per_second;

    #[test]
    fn format_handles_byte_boundaries() {
        assert_eq!(format_bytes_per_second(0), "0B/s");
        assert_eq!(format_bytes_per_second(999), "999B/s");
        assert_eq!(format_bytes_per_second(1000), "1.0K/s");
        assert_eq!(format_bytes_per_second(1024), "1.0K/s");
    }

    #[test]
    fn format_handles_decimal_and_integer_rules() {
        assert_eq!(format_bytes_per_second(9 * 1024), "9.0K/s");
        assert_eq!(format_bytes_per_second(10 * 1024 - 1), "10K/s");
        assert_eq!(format_bytes_per_second(10 * 1024), "10K/s");
        assert_eq!(format_bytes_per_second(123 * 1024), "123K/s");
    }

    #[test]
    fn format_handles_unit_promotion_after_rounding() {
        assert_eq!(format_bytes_per_second(999 * 1024 + 512), "1.0M/s");
        assert_eq!(format_bytes_per_second(1024 * 1024), "1.0M/s");
        assert_eq!(format_bytes_per_second(1536 * 1024), "1.5M/s");
    }
}
