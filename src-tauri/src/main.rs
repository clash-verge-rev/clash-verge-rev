#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(feature = "tokio-trace")]
    console_subscriber::init();

    // Check for --no-tray command line argument
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--no-tray".to_string()) {
        unsafe {
            std::env::set_var("CLASH_VERGE_DISABLE_TRAY", "1");
        }
    }

    app_lib::run();
}
