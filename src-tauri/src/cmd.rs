use tauri::api::process::CommandChild;

#[tauri::command]
fn set_clash_port(process: Option<CommandChild>, port: i32) {}
