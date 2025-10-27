use super::CmdResult;
use crate::{logging, utils::logging::Type};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendLogPayload {
    pub level: Option<String>,
    pub message: String,
    pub context: Option<serde_json::Value>,
}

#[tauri::command]
pub fn frontend_log(payload: FrontendLogPayload) -> CmdResult<()> {
    let level = payload.level.as_deref().unwrap_or("info");
    match level {
        "trace" | "debug" => logging!(
            debug,
            Type::Frontend,
            "[frontend] {}",
            payload.message.as_str()
        ),
        "warn" => logging!(
            warn,
            Type::Frontend,
            "[frontend] {}",
            payload.message.as_str()
        ),
        "error" => logging!(
            error,
            Type::Frontend,
            "[frontend] {}",
            payload.message.as_str()
        ),
        _ => logging!(
            info,
            Type::Frontend,
            "[frontend] {}",
            payload.message.as_str()
        ),
    }

    if let Some(context) = payload.context {
        logging!(info, Type::Frontend, "[frontend] context: {}", context);
    }

    Ok(())
}
