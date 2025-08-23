use super::CmdResult;
use crate::{config::*, feat, wrap_err};

/// 获取Verge配置
#[tauri::command]
pub async fn get_verge_config() -> CmdResult<IVergeResponse> {
    let verge = Config::verge().await;
    let verge_data = {
        let ref_data = verge.latest_ref();
        ref_data.clone()
    };
    let verge_response = IVergeResponse::from(*verge_data);
    Ok(verge_response)
}

/// 修改Verge配置
#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    wrap_err!(feat::patch_verge(payload, false).await)
}
