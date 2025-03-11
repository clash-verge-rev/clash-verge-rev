use tauri_plugin_mihomo::models::Protocol;

// Learn more about Tauri commands at https://v2.tauri.app/develop/calling-rust/#commands
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .plugin(
            tauri_plugin_mihomo::MihomoBuilder::new()
                .protocol(Protocol::Http)
                .external_host("127.0.0.1".into())
                .external_port(9090)
                .secret(Some("ofY_JpdwekVcyO1DY3q61".into()))
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
