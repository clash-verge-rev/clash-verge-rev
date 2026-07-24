use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::Config,
    core::{
        handle::Handle,
        proxy_view::{ProxyViewBuilder, ProxyViewInput, ProxyViewV1},
        tray::Tray,
    },
    process::AsyncHandler,
};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::Mapping;
use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, Ordering},
};

static TRAY_SYNC_RUNNING: AtomicBool = AtomicBool::new(false);
static TRAY_SYNC_PENDING: AtomicBool = AtomicBool::new(false);

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

    let mihomo = Handle::mihomo().await;
    let (proxies, providers) = tokio::join!(mihomo.get_proxies(), mihomo.get_proxy_providers(),);
    drop(mihomo);
    let proxies = proxies.stringify_err()?;

    Ok(ProxyViewBuilder::build(ProxyViewInput {
        runtime_group_order,
        proxies,
        providers: providers.ok(),
    }))
}

/// 同步托盘和GUI的代理选择状态
#[tauri::command]
pub async fn sync_tray_proxy_selection() -> CmdResult<()> {
    if TRAY_SYNC_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        AsyncHandler::spawn(move || async move {
            run_tray_sync_loop().await;
        });
    } else {
        TRAY_SYNC_PENDING.store(true, Ordering::Release);
    }

    Ok(())
}

async fn run_tray_sync_loop() {
    loop {
        match Tray::global().update_menu().await {
            Ok(_) => {
                logging!(info, Type::Cmd, "Tray proxy selection synced successfully");
            }
            Err(e) => {
                logging!(error, Type::Cmd, "Failed to sync tray proxy selection: {e}");
            }
        }

        if !TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel) {
            TRAY_SYNC_RUNNING.store(false, Ordering::Release);

            if TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel)
                && TRAY_SYNC_RUNNING
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                continue;
            }

            break;
        }
    }
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
