use objc2::{class, msg_send, runtime::AnyObject, sel};
use tauri::WebviewWindow;

#[tauri::command]
async fn perf_state(window: WebviewWindow, action: String) -> Result<serde_json::Value, String> {
    if !matches!(action.as_str(), "hide" | "show" | "state") {
        return Err("unknown measurement action".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .with_webview(move |view| unsafe {
            let native = &*(view.ns_window() as *const AnyObject);
            let sender = std::ptr::null::<AnyObject>();
            if action == "show" {
                let _: () = msg_send![native, orderBack: sender];
            } else if action == "hide" {
                let _: () = msg_send![native, orderOut: sender];
            }
            let visible: bool = msg_send![native, isVisible];
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
            let _ = tx.send((pid, visible, focused, active, click_through));
        })
        .map_err(|e| e.to_string())?;
    let (pid, visible, focused, active, click_through) = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    if pid <= 0 {
        return Err("WKWebView process ownership unavailable".into());
    }
    let top = window.is_always_on_top().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"main": std::process::id(), "webview": pid,
        "visible": visible, "nativeFocused": focused, "appActive": active,
        "top": top, "clickThrough": click_through,
        "token": std::env::var("PERF_TOKEN").map_err(|e| e.to_string())?}))
}
pub fn run() -> std::process::ExitCode {
    #[cfg(feature = "clippy")]
    let context = tauri::test::mock_context(tauri::test::noop_assets());
    #[cfg(not(feature = "clippy"))]
    let context = tauri::generate_context!();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_wdio_webdriver::init())
        .invoke_handler(tauri::generate_handler![perf_state])
        .setup(|app| {
            app.handle().set_activation_policy(tauri::ActivationPolicy::Accessory)?;
            let port: u16 = std::env::var("PERF_REPLAY_PORT")?.parse()?;
            tauri::WebviewWindowBuilder::new(
                app,
                "perf",
                tauri::WebviewUrl::App(format!("index.html?port={port}").into()),
            )
            .title("Clash Verge - performance replay")
            .inner_size(1000., 700.)
            .visible(false)
            .focused(false)
            .always_on_top(true)
            .incognito(true)
            .build()?
            .set_ignore_cursor_events(true)?;
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
