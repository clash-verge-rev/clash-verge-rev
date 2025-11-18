use super::CmdResult;
use crate::{cmd::StringifyErr as _, config::IVerge, feat};
use clash_verge_draft::SharedBox;

/// 获取Verge配置
#[tauri::command]
pub async fn get_verge_config() -> CmdResult<SharedBox<IVerge>> {
    feat::fetch_verge_config().await.stringify_err()
}

/// 修改Verge配置
#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    feat::patch_verge(&payload, false).await.stringify_err()
}
