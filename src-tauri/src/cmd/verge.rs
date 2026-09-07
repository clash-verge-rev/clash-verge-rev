use super::{CmdResult, proxy_aware_error};
use crate::{
    cmd::StringifyErr as _,
    config::IVerge,
    core::notification::{self, FailedOperation},
    feat,
};
use clash_verge_draft::SharedDraft;

/// 获取Verge配置
#[tauri::command]
pub async fn get_verge_config() -> CmdResult<SharedDraft<IVerge>> {
    feat::fetch_verge_config().await.stringify_err()
}

/// 修改Verge配置
#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    let operation = system_proxy_operation(&payload);
    let result = match operation {
        Some(operation) => notification::asking_for(operation, Box::pin(feat::patch_verge(&payload, false))).await,
        None => feat::patch_verge(&payload, false).await,
    };
    result.map_err(|error| proxy_aware_error(&error).asking_for(operation))
}

/// Extract a system proxy operation from a Verge patch.
const fn system_proxy_operation(payload: &IVerge) -> Option<FailedOperation> {
    match payload.enable_system_proxy {
        Some(true) => Some(FailedOperation::SystemProxyEnable),
        Some(false) => Some(FailedOperation::SystemProxyDisable),
        None => None,
    }
}

/// 获取默认Verge配置
#[tauri::command]
pub async fn get_default_verge_config() -> IVerge {
    IVerge::template()
}
