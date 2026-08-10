use super::{CmdResult, proxy_aware_error};
use crate::{cmd::StringifyErr as _, config::IVerge, feat};
use clash_verge_draft::SharedDraft;

/// 获取Verge配置
#[tauri::command]
pub async fn get_verge_config() -> CmdResult<SharedDraft<IVerge>> {
    feat::fetch_verge_config().await.stringify_err()
}

/// 修改Verge配置
#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    feat::patch_verge(&payload, false)
        .await
        .map_err(|error| proxy_aware_error(&error))
}
