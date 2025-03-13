use super::CmdResult;
use crate::{config::*, feat, wrap_err};

/// 获取Verge配置
#[tauri::command]
pub fn get_verge_config() -> CmdResult<IVergeResponse> {
    let verge = Config::verge();
    let verge_data = verge.data().clone();
    Ok(IVergeResponse::from(verge_data))
}

/// 修改Verge配置
#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    wrap_err!(feat::patch_verge(payload, false).await)
}
