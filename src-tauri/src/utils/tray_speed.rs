//! macOS 托盘速率富文本渲染模块
//!
//! 通过 objc2 调用 NSAttributedString 实现托盘速率的富文本显示，
//! 支持等宽字体、自适应深色/浅色模式配色、两行定宽布局。

use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSBaselineOffsetAttributeName, NSColor, NSFont, NSFontAttributeName, NSFontWeightRegular,
    NSForegroundColorAttributeName, NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSStatusItem,
    NSTextAlignment,
};
use objc2_foundation::{NSAttributedString, NSDictionary, NSNumber, NSString};

/// 速率单位常量
const KB: u64 = 1024;
/// 速率展示单位顺序（按 1024 进位）
const SPEED_UNITS: [&str; 5] = ["B/s", "K/s", "M/s", "G/s", "T/s"];

/// 富文本渲染使用的字号（适配两行在托盘栏的高度）
const TRAY_FONT_SIZE: f64 = 9.5;

/// 每行速率数值的固定字符宽度（含单位，右对齐）
const SPEED_FIELD_WIDTH: usize = 7;
/// 两行文本的行间距（负值可压缩两行高度，便于与图标纵向居中）
const TRAY_LINE_SPACING: f64 = -1.0;
/// 两行文本整体行高倍数（用于进一步压缩文本块高度）
const TRAY_LINE_HEIGHT_MULTIPLE: f64 = 0.92;
/// 文本块段前偏移（用于将两行文本整体下移）
const TRAY_PARAGRAPH_SPACING_BEFORE: f64 = -5.0;
/// 文字基线偏移（负值向下移动，更容易与托盘图标垂直居中）
const TRAY_BASELINE_OFFSET: f64 = -4.0;

/// 将字节/秒格式化为可读速率字符串
///
/// # Arguments
/// * `bytes_per_sec` - 每秒字节数
fn normalize_speed_unit(bytes_per_sec: u64) -> (f64, usize) {
    // 当前可读速率值（按单位逐级缩放）
    let mut speed_value = bytes_per_sec as f64;
    // 当前展示单位索引
    let mut unit_index = 0usize;
    // 超过三位数时自动切换到下一个单位
    while speed_value >= 1000.0 && unit_index < SPEED_UNITS.len() - 1 {
        speed_value /= KB as f64;
        unit_index += 1;
    }
    (speed_value, unit_index)
}

/// 按业务规则格式化速率值
///
/// # Arguments
/// * `bytes_per_sec` - 原始每秒字节数
/// * `speed_value` - 归一化后的速率值
/// * `unit_index` - 归一化后的单位索引
fn format_speed_by_rule(bytes_per_sec: u64, speed_value: f64, unit_index: usize) -> String {
    // B/s 始终按整数展示
    if unit_index == 0 {
        return format!("{bytes_per_sec}{}", SPEED_UNITS[unit_index]);
    }
    // 仅当速率为个位数时展示 1 位小数
    if speed_value < 10.0 {
        return format!("{speed_value:.1}{}", SPEED_UNITS[unit_index]);
    }
    // 其余场景展示整数
    let rounded_speed = speed_value.round();
    // 避免四舍五入后超过三位，继续进位到下一个单位
    if rounded_speed >= 1000.0 && unit_index < SPEED_UNITS.len() - 1 {
        // 进位后的速率值
        let promoted_speed = speed_value / KB as f64;
        // 进位后的单位索引
        let promoted_unit_index = unit_index + 1;
        // 进位后仍遵循“个位显示 1 位小数”的规则
        if promoted_speed < 10.0 {
            return format!("{promoted_speed:.1}{}", SPEED_UNITS[promoted_unit_index]);
        }
        return format!("{promoted_speed:.0}{}", SPEED_UNITS[promoted_unit_index]);
    }
    format!("{rounded_speed:.0}{}", SPEED_UNITS[unit_index])
}

/// 将字节/秒格式化为可读速率字符串
///
/// # Arguments
/// * `bytes_per_sec` - 每秒字节数
fn format_speed(bytes_per_sec: u64) -> String {
    // 标准化后的速率值和单位
    let (speed_value, unit_index) = normalize_speed_unit(bytes_per_sec);
    format_speed_by_rule(bytes_per_sec, speed_value, unit_index)
}

/// 将上行/下行速率格式化为两行定宽文本
///
/// # Arguments
/// * `up` - 上行速率（字节/秒）
/// * `down` - 下行速率（字节/秒）
fn format_tray_speed(up: u64, down: u64) -> String {
    // 上行箭头标识
    let up_str = format_speed(up);
    // 下行箭头标识
    let down_str = format_speed(down);
    format!("{:>width$}↑\n{:>width$}↓", up_str, down_str, width = SPEED_FIELD_WIDTH)
}

/// 构造带富文本样式属性的 NSDictionary
///
/// 包含：等宽字体、自适应标签颜色、右对齐段落样式
fn build_attributes() -> Retained<NSDictionary<NSString, AnyObject>> {
    unsafe {
        // 等宽系统字体，确保数字不跳动
        let font = NSFont::monospacedSystemFontOfSize_weight(TRAY_FONT_SIZE, NSFontWeightRegular);
        // 自适应标签颜色（自动跟随深色/浅色模式）
        let color = NSColor::labelColor();
        // 段落样式：右对齐，保证定宽视觉一致
        let para_style = NSMutableParagraphStyle::new();
        para_style.setAlignment(NSTextAlignment::Right);
        para_style.setLineSpacing(TRAY_LINE_SPACING);
        para_style.setLineHeightMultiple(TRAY_LINE_HEIGHT_MULTIPLE);
        para_style.setParagraphSpacingBefore(TRAY_PARAGRAPH_SPACING_BEFORE);
        // 基线偏移：用于精确控制两行速率整体的纵向位置
        let baseline_offset = NSNumber::new_f64(TRAY_BASELINE_OFFSET);

        let keys: &[&NSString] = &[
            NSFontAttributeName,
            NSForegroundColorAttributeName,
            NSParagraphStyleAttributeName,
            NSBaselineOffsetAttributeName,
        ];
        let values: &[&AnyObject] = &[&font, &color, &para_style, &baseline_offset];
        NSDictionary::from_slices(keys, values)
    }
}

/// 创建带属性的富文本
///
/// # Arguments
/// * `text` - 富文本字符串内容
/// * `attrs` - 富文本属性字典
fn create_attributed_string(
    text: &NSString,
    attrs: Option<&NSDictionary<NSString, AnyObject>>,
) -> Retained<NSAttributedString> {
    unsafe {
        NSAttributedString::initWithString_attributes(<NSAttributedString as objc2::AnyThread>::alloc(), text, attrs)
    }
}

/// 将速率以富文本形式设置到 NSStatusItem 的按钮上
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
/// * `up` - 上行速率（字节/秒）
/// * `down` - 下行速率（字节/秒）
pub fn set_speed_attributed_title(status_item: &NSStatusItem, up: u64, down: u64) {
    let speed_text = format_tray_speed(up, down);
    let ns_string = NSString::from_str(&speed_text);
    let attrs = build_attributes();

    // 主线程下更新托盘 UI
    if let Some(mtm) = MainThreadMarker::new()
        && let Some(button) = status_item.button(mtm)
    {
        // 构造并设置富文本
        let attr_str = create_attributed_string(&ns_string, Some(&attrs));
        button.setAttributedTitle(&attr_str);
    }
}

/// 清除 NSStatusItem 按钮上的富文本速率显示
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
pub fn clear_speed_attributed_title(status_item: &NSStatusItem) {
    // 主线程下清空托盘 UI 文本
    if let Some(mtm) = MainThreadMarker::new()
        && let Some(button) = status_item.button(mtm)
    {
        // 空字符串用于清除 attributedTitle
        let empty = NSString::from_str("");
        // 构造并设置空富文本
        let attr_str = create_attributed_string(&empty, None);
        button.setAttributedTitle(&attr_str);
    }
}
