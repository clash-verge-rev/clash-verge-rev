//! macOS tray speed rendering via `NSAttributedString`.

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

const TRAY_FONT_SIZE: f64 = 9.5;
/// Fixed metrics prevent clipping across menu-bar scales.
const TRAY_LINE_HEIGHT: f64 = 10.0;
const TRAY_LINE_SPACING: f64 = 0.0;
const TRAY_LINE_HEIGHT_MULTIPLE: f64 = 1.00;
const TRAY_PARAGRAPH_SPACING_BEFORE: f64 = 0.0;
const TRAY_BASELINE_OFFSET_GLYPH_HEIGHT_RATIO: f64 = 3.0;
/// Tauri uses an 18pt icon; reserve room for the icon and system padding.
const TRAY_STATUS_ITEM_EXTRA_WIDTH: f64 = 30.0;
/// Avoid status-item width jitter for short values such as `0B/s`.
const TRAY_STATUS_ITEM_MIN_LENGTH: f64 = 58.0;
const NS_VARIABLE_STATUS_ITEM_LENGTH: f64 = -1.0;

/// (button_height, mono_advance, attributes).
type CachedAttrs = (f64, f64, Retained<NSDictionary<NSString, AnyObject>>);

thread_local! {
    static LAST_DISPLAY_STR: RefCell<String> = const { RefCell::new(String::new()) };
    static CACHED_ATTRS: RefCell<Option<CachedAttrs>> = const { RefCell::new(None) };
}

fn format_tray_speed(up: u64, down: u64) -> String {
    let up_str = format_bytes_per_second(up);
    let down_str = format_bytes_per_second(down);
    format!("{:>6}\n{:>6}", up_str, down_str)
}

fn build_attributes(button_height: f64) -> Retained<NSDictionary<NSString, AnyObject>> {
    unsafe {
        let font = NSFont::monospacedSystemFontOfSize_weight(TRAY_FONT_SIZE, NSFontWeightRegular);
        let color = NSColor::controlTextColor();
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

fn create_attributed_string(
    text: &NSString,
    attrs: Option<&NSDictionary<NSString, AnyObject>>,
) -> Retained<NSAttributedString> {
    unsafe {
        NSAttributedString::initWithString_attributes(<NSAttributedString as objc2::AnyThread>::alloc(), text, attrs)
    }
}

/// Attributes and per-glyph advance, rebuilt only when the button height changes.
fn cached_attributes(button_height: f64) -> (f64, Retained<NSDictionary<NSString, AnyObject>>) {
    CACHED_ATTRS.with(|cache| {
        if let Some((height, advance, attrs)) = cache.borrow().as_ref()
            && *height == button_height
        {
            return (*advance, attrs.clone());
        }
        let attrs = build_attributes(button_height);
        let probe = NSString::from_str("0");
        let advance = create_attributed_string(&probe, Some(&attrs)).size().width;
        *cache.borrow_mut() = Some((button_height, advance, attrs.clone()));
        (advance, attrs)
    })
}

/// Longest line times the monospaced advance; matches `size().width` for the ASCII-only speed text.
fn arithmetic_width(text: &str, advance: f64) -> f64 {
    let glyphs = text.split('\n').map(str::len).max().unwrap_or(0) as f64;
    glyphs * advance
}

fn sync_click_target_frame(button: &NSStatusBarButton) {
    let bounds = button.bounds();
    let subviews = button.subviews();

    for index in 0..subviews.count() {
        let subview = subviews.objectAtIndex(index);
        subview.setFrame(bounds);
    }
}

/// `with_inner_tray_icon` should run this on the main thread; fail safely if it does not.
fn apply_status_item_attributed_title(status_item: &NSStatusItem, text: &str, show_speed: bool) {
    let Some(mtm) = MainThreadMarker::new() else {
        logging!(warn, Type::Tray, "托盘速率富文本设置跳过：非主线程调用");
        return;
    };
    let Some(button) = status_item.button(mtm) else {
        return;
    };
    let ns_string = NSString::from_str(text);
    let attr_str = if show_speed {
        let (advance, attrs) = cached_attributes(button.bounds().size.height);
        let attrs: &NSDictionary<NSString, AnyObject> = &attrs;
        let attr_str = create_attributed_string(&ns_string, Some(attrs));
        let width = arithmetic_width(text, advance);
        let length = (width.ceil() + TRAY_STATUS_ITEM_EXTRA_WIDTH).max(TRAY_STATUS_ITEM_MIN_LENGTH);
        if status_item.length() != length {
            status_item.setLength(length);
        }
        attr_str
    } else {
        create_attributed_string(&ns_string, None)
    };
    button.setAttributedTitle(&attr_str);
    sync_click_target_frame(&button);
}

pub fn set_speed_attributed_title(status_item: &NSStatusItem, up: u64, down: u64) {
    let speed_text = format_tray_speed(up, down);
    LAST_DISPLAY_STR.with(|last| {
        let mut last = last.borrow_mut();
        if last.as_str() == speed_text {
            return;
        }
        *last = speed_text;
        apply_status_item_attributed_title(status_item, last.as_str(), true);
    });
}

pub fn clear_speed_attributed_title(status_item: &NSStatusItem) {
    LAST_DISPLAY_STR.with(|last| {
        last.borrow_mut().clear();
    });
    status_item.setLength(NS_VARIABLE_STATUS_ITEM_LENGTH);
    apply_status_item_attributed_title(status_item, "", false);
}
