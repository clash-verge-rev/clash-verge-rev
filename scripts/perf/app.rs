use objc2::{class, msg_send, runtime::AnyObject, sel};
use objc2_foundation::{NSPoint, NSRect, ns_string};
use tauri::{Manager as _, WebviewWindow};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGDisplayCopyDisplayMode(display: u32) -> *mut std::ffi::c_void;
    fn CGDisplayModeGetRefreshRate(mode: *mut std::ffi::c_void) -> f64;
    fn CGDisplayModeRelease(mode: *mut std::ffi::c_void);
    fn CGMainDisplayID() -> u32;
    fn CGDisplayIsInMirrorSet(display: u32) -> u32;
    fn CGDisplayModeGetWidth(mode: *mut std::ffi::c_void) -> usize;
    fn CGDisplayModeGetHeight(mode: *mut std::ffi::c_void) -> usize;
    fn CGDisplayModeGetPixelWidth(mode: *mut std::ffi::c_void) -> usize;
    fn CGDisplayModeGetPixelHeight(mode: *mut std::ffi::c_void) -> usize;
}

fn expected_display() -> Result<Option<u32>, String> {
    match std::env::var("PERF_DISPLAY_MODE").as_deref() {
        Ok("physical") | Err(std::env::VarError::NotPresent) => Ok(None),
        Ok("virtual") => {
            let id = std::env::var("PERF_DISPLAY_ID")
                .map_err(|e| e.to_string())?
                .parse::<u32>()
                .map_err(|e| e.to_string())?;
            if id == 0 {
                return Err("invalid owned display ID".into());
            }
            Ok(Some(id))
        }
        _ => Err("unknown measurement display mode".into()),
    }
}
const fn bounds(rect: NSRect) -> [f64; 4] {
    [rect.origin.x, rect.origin.y, rect.size.width, rect.size.height]
}
fn contained(frame: NSRect, screen: NSRect) -> bool {
    frame.origin.x >= screen.origin.x
        && frame.origin.y >= screen.origin.y
        && frame.origin.x + frame.size.width <= screen.origin.x + screen.size.width
        && frame.origin.y + frame.size.height <= screen.origin.y + screen.size.height
}
unsafe fn screen_id(screen: *mut AnyObject) -> u32 {
    unsafe {
        if screen.is_null() {
            return 0;
        }
        let dictionary: *mut AnyObject = msg_send![screen, deviceDescription];
        let value: *mut AnyObject = msg_send![dictionary, objectForKey: ns_string!("NSScreenNumber")];
        msg_send![value, unsignedIntValue]
    }
}
unsafe fn display_state(native: &AnyObject) -> Result<Option<serde_json::Value>, String> {
    let Some(wanted) = expected_display()? else {
        return Ok(None);
    };
    unsafe {
        let screen: *mut AnyObject = msg_send![native, screen];
        let id = screen_id(screen);
        if id == 0 || id != wanted || id == CGMainDisplayID() || CGDisplayIsInMirrorSet(id) != 0 {
            return Err("owned virtual screen unavailable".into());
        }
        let frame: NSRect = msg_send![screen, frame];
        let visible: NSRect = msg_send![screen, visibleFrame];
        let window_frame: NSRect = msg_send![native, frame];
        let scale: f64 = msg_send![screen, backingScaleFactor];
        let behavior: usize = msg_send![native, collectionBehavior];
        let mode = CGDisplayCopyDisplayMode(id);
        if mode.is_null() {
            return Err("owned display mode unavailable".into());
        }
        let rate = CGDisplayModeGetRefreshRate(mode);
        let logical = [CGDisplayModeGetWidth(mode), CGDisplayModeGetHeight(mode)];
        let pixels = [CGDisplayModeGetPixelWidth(mode), CGDisplayModeGetPixelHeight(mode)];
        CGDisplayModeRelease(mode);
        if logical != [1280, 900]
            || pixels != [2560, 1800]
            || scale != 2.0
            || (rate - 60.0).abs() > 0.01
            || frame.size.width != 1280.0
            || frame.size.height != 900.0
            || !contained(window_frame, visible)
            || behavior & 1 == 0
            || behavior & 2 != 0
        {
            return Err("owned virtual screen geometry/mode changed".into());
        }
        Ok(Some(
            serde_json::json!({"id": id, "frame": bounds(frame), "visibleFrame": bounds(visible), "windowFrame": bounds(window_frame), "scale": scale, "refreshHz": rate, "collectionBehavior": behavior, "contained": true, "main": false, "mirrored": false, "logical": logical, "pixels": pixels}),
        ))
    }
}
unsafe fn target_screen(wanted: u32) -> Result<*mut AnyObject, String> {
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        let count: usize = msg_send![screens, count];
        let mut target = std::ptr::null_mut::<AnyObject>();
        for index in 0..count {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex: index];
            if screen_id(screen) == wanted {
                target = screen;
                break;
            }
        }
        if target.is_null() || wanted == CGMainDisplayID() {
            return Err("exact owned virtual display missing".into());
        }
        Ok(target)
    }
}
unsafe fn place_virtual(window: &WebviewWindow) -> Result<(), String> {
    unsafe {
        let Some(wanted) = expected_display()? else {
            return Ok(());
        };
        let target = target_screen(wanted)?;
        let native = &*(window.ns_window().map_err(|e| e.to_string())? as *const AnyObject);
        let visible: NSRect = msg_send![target, visibleFrame];
        let frame: NSRect = msg_send![native, frame];
        if frame.size.width > visible.size.width || frame.size.height > visible.size.height {
            return Err("owned window does not fit virtual visibleFrame".into());
        }
        let behavior: usize = msg_send![native, collectionBehavior];
        let _: () = msg_send![native, setCollectionBehavior: (behavior & !2usize) | 1usize];
        let origin = NSPoint::new(
            visible.origin.x + (visible.size.width - frame.size.width) / 2.0,
            visible.origin.y + (visible.size.height - frame.size.height) / 2.0,
        );
        let _: () = msg_send![native, setFrameOrigin: origin];
        display_state(native)?;
        Ok(())
    }
}

#[tauri::command]
async fn perf_state(window: WebviewWindow, action: String) -> Result<serde_json::Value, String> {
    if !matches!(action.as_str(), "hide" | "show" | "state") {
        return Err("unknown measurement action".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let fail_app = window.app_handle().clone();
    window
        .with_webview(move |view| unsafe {
            let native = &*(view.ns_window() as *const AnyObject);
            let sender = std::ptr::null::<AnyObject>();
            let display = match display_state(native) {
                Ok(state) => state,
                Err(error) => {
                    let _: () = msg_send![native, orderOut: sender];
                    let _ = tx.send(Err(error));
                    fail_app.exit(2);
                    return;
                }
            };
            if action == "show" {
                let _: () = msg_send![native, orderBack: sender];
            } else if action == "hide" {
                let _: () = msg_send![native, orderOut: sender];
            }
            let visible: bool = msg_send![native, isVisible];
            let occlusion: usize = msg_send![native, occlusionState];
            let active_space: bool = msg_send![native, isOnActiveSpace];
            let focused: bool = msg_send![native, isKeyWindow];
            let click_through: bool = msg_send![native, ignoresMouseEvents];
            let app: *const AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let active: bool = msg_send![app, isActive];
            let webview = &*(view.inner() as *const AnyObject);
            let supported: bool = msg_send![webview, respondsToSelector: sel!(_webProcessIdentifier)];
            let pid: i32 = if supported {
                msg_send![webview, _webProcessIdentifier]
            } else {
                0
            };
            let _ = tx.send(Ok((
                pid,
                visible,
                focused,
                active,
                click_through,
                occlusion & 2 == 0,
                active_space,
                display,
            )));
        })
        .map_err(|e| e.to_string())?;
    let (pid, visible, focused, active, click_through, occluded, active_space, display) = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())??;
    if pid <= 0 {
        return Err("WKWebView process ownership unavailable".into());
    }
    let top = window.is_always_on_top().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"main": std::process::id(), "webview": pid,
        "visible": visible, "nativeFocused": focused, "appActive": active,
        "virtualScreen": display, "expectedDisplayID": expected_display()?,
        "top": top, "occluded": occluded, "activeSpace": active_space, "clickThrough": click_through,
        "token": std::env::var("PERF_TOKEN").map_err(|e| e.to_string())?}))
}
#[tauri::command]
const fn get_clash_logs() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
fn get_verge_config() -> serde_json::Value {
    serde_json::json!({"language": "en", "theme_mode": "light"})
}

pub fn run() -> std::process::ExitCode {
    #[cfg(feature = "clippy")]
    let context = tauri::test::mock_context(tauri::test::noop_assets());
    #[cfg(not(feature = "clippy"))]
    let context = tauri::generate_context!();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_wdio_webdriver::init())
        .invoke_handler(tauri::generate_handler![perf_state, get_clash_logs, get_verge_config])
        .setup(|app| {
            let startup = (|| -> Result<(), Box<dyn std::error::Error>> {
                app.handle()
                    .set_activation_policy(tauri::ActivationPolicy::Prohibited)?;
                let scenario = std::env::var("PERF_SCENARIO").unwrap_or_else(|_| "traffic".into());
                let layer = std::env::var("PERF_LAYER").unwrap_or_else(|_| "component".into());
                if !matches!(scenario.as_str(), "traffic" | "logs" | "connections")
                    || !matches!(layer.as_str(), "page" | "component" | "dom")
                {
                    return Err("invalid perf scene".into());
                }
                if let Some(wanted) = expected_display().map_err(std::io::Error::other)? {
                    unsafe {
                        target_screen(wanted).map_err(std::io::Error::other)?;
                    }
                }
                let port: u16 = std::env::var("PERF_REPLAY_PORT")?.parse()?;
                let window = tauri::WebviewWindowBuilder::new(
                    app,
                    "perf",
                    tauri::WebviewUrl::App(format!("index.html?port={port}&scenario={scenario}&layer={layer}").into()),
                )
                .title("Clash Verge - performance replay")
                .inner_size(1000., 700.)
                .visible(false)
                .focused(false)
                .focusable(false)
                .always_on_top(true)
                .incognito(true)
                .build()?;
                window.set_ignore_cursor_events(true)?;
                unsafe {
                    place_virtual(&window).map_err(std::io::Error::other)?;
                }
                if expected_display().map_err(std::io::Error::other)?.is_some() {
                    let handle = app.handle().clone();
                    window.on_window_event(move |event| {
                        if matches!(
                            event,
                            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                        ) && let Some(window) = handle.get_webview_window("perf")
                        {
                            let valid = window
                                .ns_window()
                                .ok()
                                .is_some_and(|native| unsafe { display_state(&*(native as *const AnyObject)).is_ok() });
                            if !valid {
                                let _ = window.hide();
                                handle.exit(2);
                            }
                        }
                    });
                }
                Ok(())
            })();
            if let Err(error) = startup {
                eprintln!("Measurement startup failed: {error}");
                app.handle().exit(1);
            }
            Ok(())
        })
        .build(context);
    match result {
        Ok(mut app) => {
            app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
            app.run(|_, _| {});
        }
        Err(error) => {
            eprintln!("{error}");
            return std::process::ExitCode::FAILURE;
        }
    }
    std::process::ExitCode::SUCCESS
}
