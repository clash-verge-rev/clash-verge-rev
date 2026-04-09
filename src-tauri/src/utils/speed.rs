//! 网络速率格式化工具

/// 速率单位换算基数（1024 进位）
const SPEED_SCALE: f64 = 1024.0;
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
/// # Arguments
/// * `bytes_per_sec` - 每秒字节数
fn normalize_speed_unit(bytes_per_sec: u64) -> (f64, usize) {
    let mut speed_value = bytes_per_sec as f64;
    let mut unit_index = 0usize;
    while speed_value >= 1000.0 && unit_index < SPEED_UNITS.len() - 1 {
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
    if speed_value < 10.0 {
        return format!("{speed_value:.1}{}", SPEED_UNITS[unit_index]);
    }
    let rounded_speed = speed_value.round();
    if rounded_speed >= 1000.0 && unit_index < SPEED_UNITS.len() - 1 {
        let promoted_speed = speed_value / SPEED_SCALE;
        let promoted_unit_index = unit_index + 1;
        if promoted_speed < 10.0 {
            return format!("{promoted_speed:.1}{}", SPEED_UNITS[promoted_unit_index]);
        }
        return format!("{promoted_speed:.0}{}", SPEED_UNITS[promoted_unit_index]);
    }
    format!("{rounded_speed:.0}{}", SPEED_UNITS[unit_index])
}
