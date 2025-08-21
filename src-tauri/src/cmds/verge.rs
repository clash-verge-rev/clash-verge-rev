use crate::{
    config::{Config, IVerge},
    error::AppResult,
    feat,
};

#[tauri::command]
pub fn get_verge_config() -> AppResult<IVerge> {
    Ok(Config::verge().data().clone())
}

#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> AppResult<()> {
    feat::patch_verge(payload).await
}

#[tauri::command]
pub async fn test_delay(url: String) -> AppResult<u32> {
    Ok(feat::test_delay(url).await.unwrap_or(5000u32))
}
