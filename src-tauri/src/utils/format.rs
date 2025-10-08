/// Format bytes into human readable string (B, KB, MB, GB)
#[allow(unused)]
pub fn fmt_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
    let (mut val, mut unit) = (bytes as f64, 0);
    while val >= 1024.0 && unit < 3 {
        val /= 1024.0;
        unit += 1;
    }
    format!("{:.1}{}", val, UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fmt_bytes() {
        assert_eq!(fmt_bytes(0), "0.0B");
        assert_eq!(fmt_bytes(512), "512.0B");
        assert_eq!(fmt_bytes(1024), "1.0KB");
        assert_eq!(fmt_bytes(1536), "1.5KB");
        assert_eq!(fmt_bytes(1024 * 1024), "1.0MB");
        assert_eq!(fmt_bytes(1024 * 1024 * 1024), "1.0GB");
    }
}
