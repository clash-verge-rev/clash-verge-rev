pub use clash_verge_media_unlock::UnlockItem;
use tauri::{command, ipc::Channel};

#[command]
pub async fn get_unlock_items() -> Result<Vec<UnlockItem>, String> {
    Ok(clash_verge_media_unlock::default_unlock_items())
}

#[command]
pub async fn check_media_unlock(on_complete: Channel<UnlockItem>) -> Result<Vec<UnlockItem>, String> {
    clash_verge_media_unlock::check_media_unlock_with_callback(|item| {
        let _ = on_complete.send(item.clone());
    })
    .await
}

#[command]
pub async fn check_media_unlock_item(name: String) -> Result<UnlockItem, String> {
    clash_verge_media_unlock::check_media_unlock_item(&name).await
}
