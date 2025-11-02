use super::CmdResult;
use crate::{cmd::StringifyErr, config::*, feat, utils::draft::SharedBox};

/// 获取Verge配置
#[tauri::command]
pub async fn get_verge_config() -> CmdResult<SharedBox<IVerge>> {
    let verge = Config::verge().await;
    Ok(verge.latest_arc())
}

/// 修改Verge配置
#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    feat::patch_verge(&payload, false).await.stringify_err()
}
