pub mod handlers;
pub mod mihomo_client;
pub mod protocol;
pub mod server;
pub mod tools;

use protocol::{
    INTERNAL_ERROR, INVALID_PARAMS, InitializeResult, JsonRpcRequest, JsonRpcResponse, METHOD_NOT_FOUND,
    ServerCapabilities, ServerInfo, ToolsCallParams, ToolsCallResult, ToolsCapability, ToolsListResult,
};
use serde_json::Value;

pub async fn handle_jsonrpc(req: JsonRpcRequest) -> Option<JsonRpcResponse> {
    if req.method.starts_with("notifications/") {
        return None;
    }

    let id = req.id.clone();

    let result = match req.method.as_str() {
        "initialize" => handle_initialize(),
        "tools/list" => handle_tools_list(),
        "tools/call" => handle_tools_call(req.params).await,
        _ => Err((METHOD_NOT_FOUND, format!("Method '{}' not found", req.method))),
    };

    Some(match result {
        Ok(val) => JsonRpcResponse::success(id, val),
        Err((code, msg)) => JsonRpcResponse::error(id, code, msg),
    })
}

fn handle_initialize() -> Result<Value, (i32, String)> {
    let result = InitializeResult {
        protocol_version: "2025-03-26".into(),
        capabilities: ServerCapabilities {
            tools: Some(ToolsCapability { list_changed: false }),
        },
        server_info: ServerInfo {
            name: "clash-verge-rev".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        },
    };
    serde_json::to_value(result).map_err(|e| (INTERNAL_ERROR, e.to_string()))
}

fn handle_tools_list() -> Result<Value, (i32, String)> {
    let result = ToolsListResult {
        tools: tools::all_tools(),
    };
    serde_json::to_value(result).map_err(|e| (INTERNAL_ERROR, e.to_string()))
}

async fn handle_tools_call(params: Option<Value>) -> Result<Value, (i32, String)> {
    let params: ToolsCallParams = match params {
        Some(v) => serde_json::from_value(v).map_err(|e| (INVALID_PARAMS, e.to_string()))?,
        None => return Err((INVALID_PARAMS, "Missing params for tools/call".into())),
    };

    let result: ToolsCallResult = handlers::dispatch(&params.name, params.arguments).await;
    serde_json::to_value(result).map_err(|e| (INTERNAL_ERROR, e.to_string()))
}
