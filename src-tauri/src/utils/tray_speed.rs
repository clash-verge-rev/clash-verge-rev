//! macOS 托盘速率富文本渲染模块
//!
//! 通过 objc2 调用 NSAttributedString 实现托盘速率的富文本显示，
//! 支持等宽字体、自适应深色/浅色模式配色、两行定宽布局。

use std::cell::RefCell;

use crate::utils::speed::format_bytes_per_second;
use crate::{Type, logging};
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSBaselineOffsetAttributeName, NSColor, NSFont, NSFontAttributeName, NSFontWeightRegular,
    NSForegroundColorAttributeName, NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSStatusBarButton,
    NSStatusItem, NSTextAlignment,
};
use objc2_foundation::{NSAttributedString, NSDictionary, NSNumber, NSString};

/// 富文本渲染使用的字号（适配两行在托盘栏的高度）
const TRAY_FONT_SIZE: f64 = 9.5;
/// 两行文本的行间距（负值可压缩两行高度，便于与图标纵向居中）
const TRAY_LINE_SPACING: f64 = -1.0;
/// 两行文本整体行高倍数（用于进一步压缩文本块高度）
const TRAY_LINE_HEIGHT_MULTIPLE: f64 = 1.00;
/// 文本块段前偏移（用于将两行文本整体下移）
const TRAY_PARAGRAPH_SPACING_BEFORE: f64 = -5.0;
/// 文字基线偏移（负值向下移动，更容易与托盘图标垂直居中）
const TRAY_BASELINE_OFFSET: f64 = -4.0;

thread_local! {
    /// 托盘速率富文本属性字典（主线程缓存，避免每帧重建 ObjC 对象）。
    /// 仅在首次调用时初始化，后续复用同一实例。
    static TRAY_SPEED_ATTRS: Retained<NSDictionary<NSString, AnyObject>> = build_attributes();
    static LAST_DISPLAY_STR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// 将上行/下行速率格式化为两行定宽文本
///
/// # Arguments
/// * `up` - 上行速率（字节/秒）
/// * `down` - 下行速率（字节/秒）
fn format_tray_speed(up: u64, down: u64) -> String {
    // 上行放在第一行，下行放在第二行；通过上下布局表达方向，不再显示箭头字符。
    let up_str = format_bytes_per_second(up);
    let down_str = format_bytes_per_second(down);
    format!("{:>6}\n{:>6}", up_str, down_str)
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

fn sync_click_target_frame(button: &NSStatusBarButton) {
    let bounds = button.bounds();
    let subviews = button.subviews();

    for index in 0..subviews.count() {
        let subview = subviews.objectAtIndex(index);
        subview.setFrame(bounds);
    }
}

/// 在主线程下设置 NSStatusItem 按钮的富文本标题
///
/// 依赖 Tauri `with_inner_tray_icon` 保证回调在主线程执行；
/// 若意外在非主线程调用，`MainThreadMarker::new()` 返回 `None` 并记录警告。
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
    let Some(mtm) = MainThreadMarker::new() else {
        logging!(warn, Type::Tray, "托盘速率富文本设置跳过：非主线程调用");
        return;
    };
    let Some(button) = status_item.button(mtm) else {
        return;
    };
    let attr_str = create_attributed_string(text, attrs);
    button.setAttributedTitle(&attr_str);
    sync_click_target_frame(&button);
}

/// 将速率以富文本形式设置到 NSStatusItem 的按钮上
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
/// * `up` - 上行速率（字节/秒）
/// * `down` - 下行速率（字节/秒）
pub fn set_speed_attributed_title(status_item: &NSStatusItem, up: u64, down: u64) {
    let speed_text = format_tray_speed(up, down);
    let changed = LAST_DISPLAY_STR.with(|last| {
        let mut last_borrow = last.borrow_mut();
        if *last_borrow == speed_text {
            false
        } else {
            *last_borrow = speed_text.clone();
            true
        }
    });

    if !changed {
        return;
    }
    let ns_string = NSString::from_str(&speed_text);
    TRAY_SPEED_ATTRS.with(|attrs| {
        apply_status_item_attributed_title(status_item, &ns_string, Some(&**attrs));
    });
}

/// 清除 NSStatusItem 按钮上的富文本速率显示
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
pub fn clear_speed_attributed_title(status_item: &NSStatusItem) {
    let empty = NSString::from_str("");
    apply_status_item_attributed_title(status_item, &empty, None);
}
