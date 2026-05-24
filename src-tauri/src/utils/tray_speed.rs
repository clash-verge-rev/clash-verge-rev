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
    NSAttributedStringNSStringDrawing as _, NSBaselineOffsetAttributeName, NSColor, NSFont, NSFontAttributeName,
    NSFontWeightRegular, NSForegroundColorAttributeName, NSLineBreakMode, NSMutableParagraphStyle,
    NSParagraphStyleAttributeName, NSStatusBarButton, NSStatusItem, NSTextAlignment,
};
use objc2_foundation::{NSAttributedString, NSDictionary, NSNumber, NSString};

/// 富文本渲染使用的字号（适配两行在托盘栏的高度）
const TRAY_FONT_SIZE: f64 = 9.5;
/// 两行文本的固定行高，避免不同菜单栏高度/缩放下使用系统默认行高导致裁剪
const TRAY_LINE_HEIGHT: f64 = 10.0;
/// 两行文本的行间距
const TRAY_LINE_SPACING: f64 = 0.0;
/// 两行文本整体行高倍数（用于进一步压缩文本块高度）
const TRAY_LINE_HEIGHT_MULTIPLE: f64 = 1.00;
/// 文本块段前偏移（用于将两行文本整体下移）
const TRAY_PARAGRAPH_SPACING_BEFORE: f64 = 0.0;
/// 基线基准位移按字体上沿比例生成（避免硬编码常量）
const TRAY_BASELINE_OFFSET_GLYPH_HEIGHT_RATIO: f64 = 3.0;
/// Tauri tray-icon 将图标缩放为 18pt；这里额外预留图标、图文间距与系统内边距
const TRAY_STATUS_ITEM_EXTRA_WIDTH: f64 = 30.0;
/// 典型 6 字符速率文本的最小宽度，避免 0B/s 等短文本让状态项反复收缩
const TRAY_STATUS_ITEM_MIN_LENGTH: f64 = 58.0;
/// AppKit 的 NSVariableStatusItemLength。清空速率标题后恢复系统按图标自适应
const NS_VARIABLE_STATUS_ITEM_LENGTH: f64 = -1.0;

thread_local! {
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

fn build_attributes(button_height: f64) -> Retained<NSDictionary<NSString, AnyObject>> {
    unsafe {
        // 等宽系统字体，确保数字不跳动
        let font = NSFont::monospacedSystemFontOfSize_weight(TRAY_FONT_SIZE, NSFontWeightRegular);
        // 自适应标签颜色（自动跟随深色/浅色模式）
        let color = NSColor::labelColor();
        // 段落样式：右对齐，保证定宽视觉一致
        let para_style = NSMutableParagraphStyle::new();
        para_style.setAlignment(NSTextAlignment::Right);
        para_style.setLineBreakMode(NSLineBreakMode::ByClipping);
        para_style.setLineSpacing(TRAY_LINE_SPACING);
        para_style.setLineHeightMultiple(TRAY_LINE_HEIGHT_MULTIPLE);
        para_style.setMinimumLineHeight(TRAY_LINE_HEIGHT);
        para_style.setMaximumLineHeight(TRAY_LINE_HEIGHT);
        para_style.setParagraphSpacingBefore(TRAY_PARAGRAPH_SPACING_BEFORE);
        let glyph_height = font.ascender() - font.descender();
        let base_offset = -(glyph_height / TRAY_BASELINE_OFFSET_GLYPH_HEIGHT_RATIO);
        let free_space = TRAY_LINE_HEIGHT * 2.0 - button_height;
        let baseline_offset = NSNumber::new_f64(base_offset + free_space / 2.0);

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
/// * `attrs` - 可选富文本属性字典（None 表示用默认属性）
fn create_attributed_string(
    text: &NSString,
    attrs: Option<&NSDictionary<NSString, AnyObject>>,
) -> Retained<NSAttributedString> {
    unsafe {
        NSAttributedString::initWithString_attributes(<NSAttributedString as objc2::AnyThread>::alloc(), text, attrs)
    }
}

fn status_item_length_for_speed(attr_str: &NSAttributedString) -> f64 {
    (attr_str.size().width.ceil() + TRAY_STATUS_ITEM_EXTRA_WIDTH).max(TRAY_STATUS_ITEM_MIN_LENGTH)
}

fn sync_click_target_frame(button: &NSStatusBarButton) {
    let bounds = button.bounds();
    let subviews = button.subviews();

    for index in 0..subviews.count() {
        let subview = subviews.objectAtIndex(index);
        subview.setFrame(bounds);
    }
}

/// 在主线程下设置 NSStatusItem 按钮的标题内容
///
/// 依赖 Tauri `with_inner_tray_icon` 保证回调在主线程执行；
/// 若意外在非主线程调用，`MainThreadMarker::new()` 返回 `None` 并记录警告。
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
/// * `text` - 标题字符串内容
/// * `show_speed` - 是否以速率富文本样式绘制；false 时清空为普通空标题
fn apply_status_item_attributed_title(status_item: &NSStatusItem, text: &NSString, show_speed: bool) {
    let Some(mtm) = MainThreadMarker::new() else {
        logging!(warn, Type::Tray, "托盘速率富文本设置跳过：非主线程调用");
        return;
    };
    let Some(button) = status_item.button(mtm) else {
        return;
    };
    let attr_str = if show_speed {
        let attrs = build_attributes(button.bounds().size.height);
        let attrs: &NSDictionary<NSString, AnyObject> = &attrs;
        let attr_str = create_attributed_string(text, Some(attrs));
        status_item.setLength(status_item_length_for_speed(&attr_str));
        attr_str
    } else {
        create_attributed_string(text, None)
    };
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
    apply_status_item_attributed_title(status_item, &ns_string, true);
}

/// 清除 NSStatusItem 按钮上的富文本速率显示
///
/// # Arguments
/// * `status_item` - macOS 托盘 NSStatusItem 引用
pub fn clear_speed_attributed_title(status_item: &NSStatusItem) {
    LAST_DISPLAY_STR.with(|last| {
        last.borrow_mut().clear();
    });
    let empty = NSString::from_str("");
    status_item.setLength(NS_VARIABLE_STATUS_ITEM_LENGTH);
    apply_status_item_attributed_title(status_item, &empty, false);
}
