#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(feature = "tokio-trace")]
    console_subscriber::init();

    app_lib::run();
}
