//! 网络速率格式化工具

/// 速率单位换算基数（1024 进位，IEC 二进制）
const SPEED_SCALE: f64 = 1024.0;
/// 速率显示升档阈值：保证显示值不超过三位数（显示层约定，与换算基数无关）
const SPEED_DISPLAY_THRESHOLD: f64 = 1000.0;
/// 速率展示单位顺序
const SPEED_UNITS: [&str; 5] = ["B/s", "K/s", "M/s", "G/s", "T/s"];

/// 将字节/秒格式化为可读速率字符串
///
/// # Arguments
/// * `bytes_per_sec` - 每秒字节数
pub fn format_bytes_per_second(bytes_per_sec: u64) -> String {
    let (value, unit_index) = normalize_speed_unit(bytes_per_sec);
    format_speed_by_rule(bytes_per_sec, value, unit_index)
}

/// 归一化速率值与单位索引
///
/// 升档阈值使用 `SPEED_DISPLAY_THRESHOLD`（1000），保证归一化后的显示值不超过三位数；
/// 换算除数使用 `SPEED_SCALE`（1024），保持 IEC 二进制精度。
///
/// # Arguments
/// * `bytes_per_sec` - 每秒字节数
fn normalize_speed_unit(bytes_per_sec: u64) -> (f64, usize) {
    let mut speed_value = bytes_per_sec as f64;
    let mut unit_index = 0usize;
    while speed_value >= SPEED_DISPLAY_THRESHOLD && unit_index < SPEED_UNITS.len() - 1 {
        speed_value /= SPEED_SCALE;
        unit_index += 1;
    }
    (speed_value, unit_index)
}

/// 按展示规则格式化速率值
///
/// # Arguments
/// * `bytes_per_sec` - 原始每秒字节数
/// * `speed_value` - 归一化后的速率值
/// * `unit_index` - 归一化后的单位索引
fn format_speed_by_rule(bytes_per_sec: u64, speed_value: f64, unit_index: usize) -> String {
    if unit_index == 0 {
        return format!("{bytes_per_sec}{}", SPEED_UNITS[unit_index]);
    }
    // 先将值四舍五入到一位小数，再判断是否为个位数。
    // 避免直接对原始浮点判断后格式化时产生进位：如 9.999 < 10.0 满足，
    // 但 format!("{:.1}", 9.999) = "10.0"，导致两位数出现小数。
    let rounded_1dp = (speed_value * 10.0).round() / 10.0;
    if rounded_1dp < 10.0 {
        return format!("{rounded_1dp:.1}{}", SPEED_UNITS[unit_index]);
    }
    let rounded_speed = speed_value.round();
    // 四舍五入后超过显示阈值（≥1000）时升档，避免出现四位数
    if rounded_speed >= SPEED_DISPLAY_THRESHOLD && unit_index < SPEED_UNITS.len() - 1 {
        let promoted_speed = speed_value / SPEED_SCALE;
        let promoted_unit_index = unit_index + 1;
        if promoted_speed < 10.0 {
            return format!("{promoted_speed:.1}{}", SPEED_UNITS[promoted_unit_index]);
        }
        return format!("{promoted_speed:.0}{}", SPEED_UNITS[promoted_unit_index]);
    }
    format!("{rounded_speed:.0}{}", SPEED_UNITS[unit_index])
}

#[cfg(test)]
mod tests {
    use super::format_bytes_per_second;

    #[test]
    fn format_handles_byte_boundaries() {
        assert_eq!(format_bytes_per_second(0), "0B/s");
        assert_eq!(format_bytes_per_second(999), "999B/s");
        // 1000 >= SPEED_DISPLAY_THRESHOLD，升档为 K/s（保证不超过三位数）
        assert_eq!(format_bytes_per_second(1000), "1.0K/s");
        assert_eq!(format_bytes_per_second(1024), "1.0K/s");
    }

    #[test]
    fn format_handles_decimal_and_integer_rules() {
        assert_eq!(format_bytes_per_second(9 * 1024), "9.0K/s");
        // 9.999 K/s：rounded_1dp = 10.0，不满足 < 10，应显示整数 "10K/s"
        assert_eq!(format_bytes_per_second(10 * 1024 - 1), "10K/s");
        assert_eq!(format_bytes_per_second(10 * 1024), "10K/s");
        assert_eq!(format_bytes_per_second(123 * 1024), "123K/s");
    }

    #[test]
    fn format_handles_unit_promotion_after_rounding() {
        // 999.5 K/s 四舍五入为 1000，≥ SPEED_DISPLAY_THRESHOLD，升档为 1.0M/s
        assert_eq!(format_bytes_per_second(999 * 1024 + 512), "1.0M/s");
        assert_eq!(format_bytes_per_second(1024 * 1024), "1.0M/s");
        assert_eq!(format_bytes_per_second(1536 * 1024), "1.5M/s");
    }
}
