//! macOS 托盘速率富文本渲染模块
//!
//! 通过 objc2 调用 NSAttributedString 实现托盘速率的富文本显示，
//! 支持等宽字体、自适应深色/浅色模式配色、两行定宽布局。

use crate::utils::speed::format_bytes_per_second;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSBaselineOffsetAttributeName, NSColor, NSFont, NSFontAttributeName, NSFontWeightRegular,
    NSForegroundColorAttributeName, NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSStatusItem,
    NSTextAlignment,
};
use objc2_foundation::{NSAttributedString, NSDictionary, NSNumber, NSString};

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

/// 将上行/下行速率格式化为两行定宽文本
///
/// # Arguments
/// * `up` - 上行速率（字节/秒）
/// * `down` - 下行速率（字节/秒）
fn format_tray_speed(up: u64, down: u64) -> String {
    // 上行放在第一行，下行放在第二行；通过上下布局表达方向，不再显示箭头字符。
    let up_str = format_bytes_per_second(up);
    let down_str = format_bytes_per_second(down);
    format!("{:>width$}\n{:>width$}", up_str, down_str, width = SPEED_FIELD_WIDTH)
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

/// 在主线程下设置 NSStatusItem 按钮的富文本标题
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
/// * `text` - 富文本字符串内容
/// * `attrs` - 富文本属性字典
fn apply_status_item_attributed_title(
    status_item: &NSStatusItem,
    text: &NSString,
    attrs: Option<&NSDictionary<NSString, AnyObject>>,
) {
    if let Some(mtm) = MainThreadMarker::new()
        && let Some(button) = status_item.button(mtm)
    {
        let attr_str = create_attributed_string(text, attrs);
        button.setAttributedTitle(&attr_str);
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
    apply_status_item_attributed_title(status_item, &ns_string, Some(&attrs));
}

/// 清除 NSStatusItem 按钮上的富文本速率显示
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
pub fn clear_speed_attributed_title(status_item: &NSStatusItem) {
    let empty = NSString::from_str("");
    apply_status_item_attributed_title(status_item, &empty, None);
}
