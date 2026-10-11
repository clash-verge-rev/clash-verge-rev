use super::Tray;
use crate::{
    Type, cmd,
    config::Config,
    core::{
        handle,
        notify::{Refresh, announce},
        proxy_view::{ProxyMemberRef, ProxyNodeSource},
    },
    logging,
};

const TRAY_DELAY_TEST_CONCURRENCY: usize = 10;
const TRAY_DEFAULT_LATENCY_URL: &str = "http://cp.cloudflare.com/generate_204";

fn is_latency_test_url(raw: &str) -> bool {
    let raw = raw.trim();
    raw.split_once("://")
        .is_some_and(|(scheme, _)| scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https"))
        && tauri::Url::parse(raw).is_ok_and(|url| url.has_host() && matches!(url.scheme(), "http" | "https"))
}

pub(super) fn test_url(
    group: &crate::core::proxy_view::ProxyGroupView,
    verge: &crate::config::IVerge,
    profiles: &crate::config::IProfiles,
) -> String {
    let custom_url = profiles
        .current
        .as_ref()
        .and_then(|uid| profiles.get_item(uid).ok())
        .and_then(|profile| profile.latency_test_urls.as_ref())
        .and_then(|urls| urls.get(group.name.as_str()))
        .map(|url| url.as_str())
        .filter(|url| !url.trim().is_empty());
    let group_url = group.test_url.as_deref().filter(|url| !url.trim().is_empty());
    let default_url = verge
        .default_latency_test
        .as_deref()
        .filter(|url| !url.trim().is_empty());
    custom_url
        .or(group_url)
        .or(default_url)
        .filter(|&url| is_latency_test_url(url))
        .unwrap_or(TRAY_DEFAULT_LATENCY_URL)
        .trim()
        .to_owned()
}

static RUNNING: parking_lot::Mutex<std::collections::BTreeSet<String>> =
    parking_lot::Mutex::new(std::collections::BTreeSet::new());

pub(super) fn is_running(group_name: &str) -> bool {
    RUNNING.lock().contains(group_name)
}

pub(super) async fn test_proxy_group_delay(group_name: &str) {
    if !RUNNING.lock().insert(group_name.to_owned()) {
        return;
    }
    Tray::global().refresh_latency_item(group_name);
    let _running = scopeguard::guard(group_name, |name| {
        RUNNING.lock().remove(name);
        Tray::global().refresh_latency_item(name);
    });
    use futures::{StreamExt as _, stream};

    let view = match cmd::proxy::get_proxy_view().await {
        Ok(view) => view,
        Err(err) => {
            logging!(warn, Type::Tray, "Failed to read proxies for tray latency test: {err}");
            return;
        }
    };
    let verge = Config::verge().await.latest_arc();

    let group = view
        .groups
        .iter()
        .chain(view.global.iter())
        .find(|group| group.name.as_str() == group_name);
    let Some(group) = group else {
        logging!(warn, Type::Tray, "Tray latency test group not found: {group_name}");
        return;
    };

    let profiles = Config::profiles().await.latest_arc();
    let url = test_url(group, &verge, &profiles);
    let timeout = verge
        .default_latency_timeout
        .filter(|timeout| *timeout > 0)
        .unwrap_or(10000) as u32;

    let mut targets: Vec<(std::string::String, Option<std::string::String>)> = Vec::with_capacity(group.members.len());
    for member in &group.members {
        match member {
            ProxyMemberRef::Node { name, record_id } => match view.records.get(record_id).map(|node| &node.source) {
                Some(ProxyNodeSource::Provider {
                    provider_name,
                    proxy_name,
                }) => targets.push((proxy_name.clone(), Some(provider_name.clone()))),
                _ => targets.push((name.clone(), None)),
            },
            ProxyMemberRef::Group { name } => targets.push((name.clone(), None)),
            ProxyMemberRef::Unresolved { .. } => {}
        }
    }
    let mihomo = handle::Handle::mihomo();

    stream::iter(targets.into_iter().map(move |(member, provider)| {
        let url = url.clone();
        async move {
            let result = match provider {
                Some(provider_name) => {
                    mihomo
                        .healthcheck_node_in_provider(&provider_name, &member, &url, timeout)
                        .await
                }
                None => mihomo.delay_proxy_by_name(&member, &url, timeout).await,
            };
            if let Err(err) = result {
                logging!(debug, Type::Tray, "Tray latency test failed: {member} - {err}");
            }
        }
    }))
    .buffer_unordered(TRAY_DELAY_TEST_CONCURRENCY)
    .for_each(|()| std::future::ready(()))
    .await;

    if let Err(err) = cmd::proxy::sync_tray_proxy_selection().await {
        logging!(warn, Type::Tray, "Failed to refresh tray after latency test: {err}");
    }

    announce(Refresh::Proxies);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latency_urls_require_a_valid_http_host_and_port() {
        for invalid in [
            "http://?",
            "http://host:invalid",
            "http://bad host/",
            "ftp://localhost",
            "http:localhost",
        ] {
            assert!(!is_latency_test_url(invalid), "{invalid}");
        }
        for valid in ["http://localhost/", " https://example.com/ ", "HTTP://localhost:8080/"] {
            assert!(is_latency_test_url(valid), "{valid}");
        }
    }
}
