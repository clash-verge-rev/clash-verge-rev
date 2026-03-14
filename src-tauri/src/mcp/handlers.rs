use anyhow::Result;
use serde_json::{Value, json};
use smartstring::alias::String as SmartString;

use super::mihomo_client::MihomoClient;
use super::protocol::ToolsCallResult;
use crate::config::profiles::{profiles_append_item_safe, profiles_save_file_safe};
use crate::config::{Config, IProfiles, PrfItem, PrfOption};
use crate::core::{CoreManager, handle};
use crate::feat;

pub async fn dispatch(name: &str, args: Option<Value>) -> ToolsCallResult {
    match run(name, args).await {
        Ok(result) => result,
        Err(e) => ToolsCallResult::error(format!("Tool '{name}' failed: {e}")),
    }
}

async fn run(name: &str, args: Option<Value>) -> Result<ToolsCallResult> {
    let args = args.unwrap_or_default();
    let mihomo = MihomoClient::default();

    match name {
        "list_proxies" => run_proxy_list(&mihomo).await,
        "select_proxy" => run_proxy_select(&mihomo, &args).await,
        "test_proxy_delay" => run_proxy_delay(&mihomo, &args).await,
        "get_proxy_providers" => run_proxy_providers(&mihomo).await,
        "update_proxy_provider" => run_provider_update(&mihomo, &args).await,
        "get_connections" => run_connections(&mihomo).await,
        "close_connections" => run_close_connections(&mihomo, &args).await,
        "get_rules" => run_rules(&mihomo).await,
        "get_clash_config" => run_clash_config(&mihomo).await,
        "patch_clash_config" => run_patch_clash(&mihomo, &args).await,
        "change_mode" => run_change_mode(&args).await,
        "get_verge_config" => run_verge_config().await,
        "patch_verge_config" => run_patch_verge(&args).await,
        "list_profiles" => run_list_profiles().await,
        "switch_profile" => run_switch_profile(&args).await,
        "import_profile" => run_import_profile(&args).await,
        "update_profile" => run_update_profile(&args).await,
        "get_status" => run_get_status(&mihomo).await,
        "restart_core" => run_restart_core().await,
        "get_logs" => run_get_logs().await,
        _ => Ok(ToolsCallResult::error(format!("Unknown tool: {name}"))),
    }
}

async fn run_proxy_list(mihomo: &MihomoClient) -> Result<ToolsCallResult> {
    let data = mihomo.get_proxies().await?;
    Ok(ToolsCallResult::json(&data))
}

async fn run_proxy_select(mihomo: &MihomoClient, args: &Value) -> Result<ToolsCallResult> {
    let group = args["group"].as_str().unwrap_or_default();
    let proxy_name = args["name"].as_str().unwrap_or_default();
    mihomo.select_proxy(group, proxy_name).await?;
    Ok(ToolsCallResult::text(format!(
        "Selected '{proxy_name}' for group '{group}'"
    )))
}

async fn run_proxy_delay(mihomo: &MihomoClient, args: &Value) -> Result<ToolsCallResult> {
    let proxy_name = args["name"].as_str().unwrap_or_default();
    let url = args["url"].as_str().unwrap_or("http://cp.cloudflare.com");
    let timeout = args["timeout"].as_u64().unwrap_or(5000) as u32;
    let data = mihomo.get_proxy_delay(proxy_name, url, timeout).await?;
    Ok(ToolsCallResult::json(&data))
}

async fn run_proxy_providers(mihomo: &MihomoClient) -> Result<ToolsCallResult> {
    let data = mihomo.get_proxy_providers().await?;
    Ok(ToolsCallResult::json(&data))
}

async fn run_provider_update(mihomo: &MihomoClient, args: &Value) -> Result<ToolsCallResult> {
    let provider_name = args["name"].as_str().unwrap_or_default();
    mihomo.update_proxy_provider(provider_name).await?;
    Ok(ToolsCallResult::text(format!(
        "Provider '{provider_name}' update triggered"
    )))
}

async fn run_connections(mihomo: &MihomoClient) -> Result<ToolsCallResult> {
    let data = mihomo.get_connections().await?;
    Ok(ToolsCallResult::json(&data))
}

async fn run_close_connections(mihomo: &MihomoClient, args: &Value) -> Result<ToolsCallResult> {
    if let Some(id) = args.get("id").and_then(|v| v.as_str()) {
        mihomo.close_connection(id).await?;
        Ok(ToolsCallResult::text(format!("Connection '{id}' closed")))
    } else {
        mihomo.close_all_connections().await?;
        Ok(ToolsCallResult::text("All connections closed"))
    }
}

async fn run_rules(mihomo: &MihomoClient) -> Result<ToolsCallResult> {
    let data = mihomo.get_rules().await?;
    Ok(ToolsCallResult::json(&data))
}

async fn run_clash_config(mihomo: &MihomoClient) -> Result<ToolsCallResult> {
    let data = mihomo.get_config().await?;
    Ok(ToolsCallResult::json(&data))
}

async fn run_patch_clash(mihomo: &MihomoClient, args: &Value) -> Result<ToolsCallResult> {
    let payload = args.get("payload").cloned().unwrap_or_default();
    mihomo.patch_config(&payload).await?;
    Ok(ToolsCallResult::text("Clash config patched"))
}

async fn run_change_mode(args: &Value) -> Result<ToolsCallResult> {
    let mode = args["mode"].as_str().unwrap_or("rule");
    feat::change_clash_mode(SmartString::from(mode)).await;
    Ok(ToolsCallResult::text(format!("Mode changed to '{mode}'")))
}

async fn run_verge_config() -> Result<ToolsCallResult> {
    let config = Config::verge().await;
    let data = config.data_arc();
    let json_val = serde_json::to_value(&*data)?;
    Ok(ToolsCallResult::json(&json_val))
}

async fn run_patch_verge(args: &Value) -> Result<ToolsCallResult> {
    let payload = args.get("payload").cloned().unwrap_or_default();
    let verge_patch: crate::config::IVerge = serde_json::from_value(payload)?;
    feat::patch_verge(&verge_patch, false).await?;
    Ok(ToolsCallResult::text("Verge config patched"))
}

async fn run_list_profiles() -> Result<ToolsCallResult> {
    let profiles = Config::profiles().await;
    let data = profiles.data_arc();
    let json_val = serde_json::to_value(&*data)?;
    Ok(ToolsCallResult::json(&json_val))
}

async fn run_switch_profile(args: &Value) -> Result<ToolsCallResult> {
    let uid = args["uid"].as_str().unwrap_or_default();
    let profiles = IProfiles {
        current: Some(SmartString::from(uid)),
        items: None,
    };
    Config::profiles()
        .await
        .edit_draft(|d| d.patch_config(&profiles));
    Config::profiles().await.apply();
    CoreManager::global().update_config().await?;
    handle::Handle::refresh_clash();
    Ok(ToolsCallResult::text(format!(
        "Switched to profile '{uid}'"
    )))
}

async fn run_import_profile(args: &Value) -> Result<ToolsCallResult> {
    let url = args["url"].as_str().unwrap_or_default();
    let option = PrfOption {
        with_proxy: Some(true),
        ..Default::default()
    };
    let item = &mut PrfItem::from_url(url, None, None, Some(&option)).await?;
    profiles_append_item_safe(item).await?;
    profiles_save_file_safe().await?;
    if let Some(uid) = &item.uid {
        handle::Handle::notify_profile_changed(uid);
    }
    Ok(ToolsCallResult::text(format!(
        "Profile imported from '{url}'"
    )))
}

async fn run_update_profile(args: &Value) -> Result<ToolsCallResult> {
    let uid_str = args["uid"].as_str().unwrap_or_default();
    let uid = SmartString::from(uid_str);
    feat::update_profile(&uid, None, true, true, true).await?;
    Config::profiles().await.apply();
    Ok(ToolsCallResult::text(format!(
        "Profile '{uid_str}' updated"
    )))
}

async fn run_get_status(mihomo: &MihomoClient) -> Result<ToolsCallResult> {
    let clash_info = Config::clash().await.data_arc().get_client_info();
    let version = mihomo
        .get_version()
        .await
        .unwrap_or_else(|_| json!({"version": "unknown"}));
    let core_version = version
        .get("version")
        .cloned()
        .unwrap_or_else(|| json!("unknown"));
    let verge = Config::verge().await;
    let verge_data = verge.data_arc();

    let status = json!({
        "core_version": core_version,
        "server": clash_info.server.to_string(),
        "mixed_port": clash_info.mixed_port,
        "socks_port": clash_info.socks_port,
        "http_port": clash_info.port,
        "system_proxy_enabled": verge_data.enable_system_proxy.unwrap_or(false),
        "tun_enabled": verge_data.enable_tun_mode.unwrap_or(false),
        "current_profile": Config::profiles().await.data_arc().current.clone(),
    });
    Ok(ToolsCallResult::json(&status))
}

async fn run_restart_core() -> Result<ToolsCallResult> {
    CoreManager::global().restart_core().await?;
    handle::Handle::refresh_clash();
    Ok(ToolsCallResult::text("Core restarted"))
}

async fn run_get_logs() -> Result<ToolsCallResult> {
    let logs = CoreManager::global()
        .get_clash_logs()
        .await
        .unwrap_or_default();
    let json_val = serde_json::to_value(&logs)?;
    Ok(ToolsCallResult::json(&json_val))
}
