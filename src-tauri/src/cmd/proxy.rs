use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::Config,
    core::{
        handle::Handle,
        proxy_view::{ProxyViewBuilder, ProxyViewInput, ProxyViewV1},
        tray::Tray,
    },
};
use serde_yaml_ng::Mapping;
use std::collections::HashSet;

/// Record which node a group is on, in the current profile.
///
/// Takes the group and the node rather than the whole selection list, and merges them into the
/// profile on this side. The frontend used to send the list it had rendered, which made two
/// selections made before that list refreshed into one overwriting the other: both were built
/// from the same stale array, and the later write dropped the earlier group's choice. Since a
/// core start re-applies whatever the profile holds, the dropped one then came back on restart.
///
/// The tray already recorded this way. Now there is one way.
#[tauri::command]
pub async fn record_selected_node(group_name: String, node: String) -> CmdResult<()> {
    crate::config::profiles::record_selected_node(&group_name, &node)
        .await
        .stringify_err()
}

fn runtime_group_order(config: Option<&Mapping>) -> Vec<String> {
    let mut seen = HashSet::new();

    config
        .and_then(|config| config.get("proxy-groups"))
        .and_then(|groups| groups.as_sequence())
        .into_iter()
        .flatten()
        .filter_map(|group| group.get("name"))
        .filter_map(|name| name.as_str())
        .filter(|name| !name.is_empty() && *name != "GLOBAL")
        .filter(|name| seen.insert((*name).to_owned()))
        .map(str::to_owned)
        .collect()
}

#[tauri::command]
pub async fn get_proxy_view() -> CmdResult<ProxyViewV1> {
    let runtime = Config::runtime().await;
    let latest_runtime = runtime.latest_arc();
    let runtime_group_order = runtime_group_order(latest_runtime.config.as_ref());

    let mihomo = Handle::mihomo();
    let (proxies, providers) = tokio::join!(mihomo.get_proxies(), mihomo.get_proxy_providers(),);
    let proxies = proxies.stringify_err()?;

    Ok(ProxyViewBuilder::build(ProxyViewInput {
        runtime_group_order,
        proxies,
        providers: providers.ok(),
    }))
}

/// 同步托盘和GUI的代理选择状态
#[tauri::command]
pub fn sync_tray_proxy_selection(group_name: String, proxy_name: String) -> CmdResult<()> {
    Tray::global()
        .update_proxy_selection(&group_name, &proxy_name)
        .stringify_err()
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_yaml_ng::Value;

    use super::runtime_group_order;

    #[test]
    fn runtime_order_keeps_first_non_empty_non_global_name() {
        let config: Value = serde_yaml_ng::from_str(
            r#"
proxy-groups:
  - name: Beta
  - name: ""
  - name: GLOBAL
  - name: " Alpha "
  - name: Beta
"#,
        )
        .expect("parse runtime");

        assert_eq!(
            runtime_group_order(config.as_mapping()),
            ["Beta".to_owned(), " Alpha ".to_owned()]
        );
    }
}
