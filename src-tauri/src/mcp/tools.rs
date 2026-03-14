use serde_json::{Value, json};

use super::protocol::ToolDefinition;

fn empty_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "required": []
    })
}

pub fn all_tools() -> Vec<ToolDefinition> {
    vec![
        // ──── Proxy ────
        ToolDefinition {
            name: "list_proxies".into(),
            description: "List all proxy groups and their proxy nodes with current selection".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "select_proxy".into(),
            description: "Select a proxy node for a specific proxy group".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "group": { "type": "string", "description": "Proxy group name" },
                    "name":  { "type": "string", "description": "Proxy node name to select" }
                },
                "required": ["group", "name"]
            }),
        },
        ToolDefinition {
            name: "test_proxy_delay".into(),
            description: "Test the latency/delay of a specific proxy node".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name":    { "type": "string",  "description": "Proxy node name" },
                    "url":     { "type": "string",  "description": "Test URL (default: http://cp.cloudflare.com)" },
                    "timeout": { "type": "integer", "description": "Timeout in ms (default: 5000)" }
                },
                "required": ["name"]
            }),
        },
        ToolDefinition {
            name: "get_proxy_providers".into(),
            description: "Get the list of proxy providers and their proxies".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "update_proxy_provider".into(),
            description: "Trigger an update/refresh for a specific proxy provider".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Provider name" }
                },
                "required": ["name"]
            }),
        },
        // ──── Connections ────
        ToolDefinition {
            name: "get_connections".into(),
            description: "Get all active connections with metadata (host, chain, download/upload bytes)".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "close_connections".into(),
            description: "Close connections. If id is provided, close that specific connection; otherwise close all"
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Connection ID to close (omit to close all)" }
                },
                "required": []
            }),
        },
        ToolDefinition {
            name: "get_rules".into(),
            description: "Get the list of active proxy rules".into(),
            input_schema: empty_schema(),
        },
        // ──── Config & Mode ────
        ToolDefinition {
            name: "get_clash_config".into(),
            description: "Get the current running clash/mihomo configuration".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "patch_clash_config".into(),
            description: "Patch the running clash/mihomo configuration (e.g. change ports, log-level)".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "payload": {
                        "type": "object",
                        "description": "Key-value pairs to patch into the config"
                    }
                },
                "required": ["payload"]
            }),
        },
        ToolDefinition {
            name: "change_mode".into(),
            description: "Switch the proxy mode: rule, global, or direct".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["rule", "global", "direct"],
                        "description": "The proxy mode to switch to"
                    }
                },
                "required": ["mode"]
            }),
        },
        ToolDefinition {
            name: "get_verge_config".into(),
            description: "Get the Clash Verge application configuration".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "patch_verge_config".into(),
            description: "Modify the Clash Verge application configuration".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "payload": {
                        "type": "object",
                        "description": "Verge config fields to patch"
                    }
                },
                "required": ["payload"]
            }),
        },
        // ──── Profiles ────
        ToolDefinition {
            name: "list_profiles".into(),
            description: "List all subscription/config profiles with their status".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "switch_profile".into(),
            description: "Switch to a specific profile by its uid".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "uid": { "type": "string", "description": "Profile UID to activate" }
                },
                "required": ["uid"]
            }),
        },
        ToolDefinition {
            name: "import_profile".into(),
            description: "Import a new profile/subscription from a URL".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Profile subscription URL" }
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "update_profile".into(),
            description: "Update/refresh a profile to fetch the latest version from its source".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "uid": { "type": "string", "description": "Profile UID to update" }
                },
                "required": ["uid"]
            }),
        },
        // ──── Core Control ────
        ToolDefinition {
            name: "get_status".into(),
            description: "Get comprehensive status: core version, running mode, system proxy, ports, uptime".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "restart_core".into(),
            description: "Restart the clash/mihomo core process".into(),
            input_schema: empty_schema(),
        },
        ToolDefinition {
            name: "get_logs".into(),
            description: "Get recent clash core log entries".into(),
            input_schema: empty_schema(),
        },
    ]
}
