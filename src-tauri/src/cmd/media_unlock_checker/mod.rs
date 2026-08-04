pub use clash_verge_media_unlock::UnlockItem;
use tauri::command;

#[command]
pub async fn get_unlock_items() -> Result<Vec<UnlockItem>, String> {
    Ok(clash_verge_media_unlock::default_unlock_items())
}

#[command]
pub async fn check_media_unlock() -> Result<Vec<UnlockItem>, String> {
    clash_verge_media_unlock::check_media_unlock().await
}
