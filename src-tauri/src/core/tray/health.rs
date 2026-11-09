use super::{IconKind, current_clash_mode};
use crate::config::{Config, IVerge};
use crate::core::{CoreManager, handle};
use crate::process::AsyncHandler;
use crate::{Type, logging};
use chrono::{DateTime, TimeDelta, Utc};
use clash_verge_draft::SharedDraft;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri_plugin_mihomo::models::{Proxy, ProxyType};
use tokio::sync::Notify;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayHealth {
    Unknown = 0,
    Healthy = 1,
    Unhealthy = 2,
}

/// The low two bits hold the published health and the rest an epoch bumped by [`invalidate`],
/// so a result fetched before an invalidation can never be published after it.
static STATE: AtomicU64 = AtomicU64::new(0);
static WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);

/// Requests a re-evaluation soon; coalesces with pending requests.
pub fn wake() {
    WAKE.notify_one();
}

/// Resets the health to Unknown and discards in-flight results, e.g. when the Core restarts,
/// reloads its configuration (which clears delay history) or a selection changes.
pub fn invalidate() {
    let _ = STATE.try_update(Ordering::AcqRel, Ordering::Acquire, |state| Some((state | 3) + 1));
    wake();
}

pub fn current_health() -> TrayHealth {
    match STATE.load(Ordering::Acquire) & 3 {
        1 => TrayHealth::Healthy,
        2 => TrayHealth::Unhealthy,
        _ => TrayHealth::Unknown,
    }
}

fn publish(epoch: u64, health: TrayHealth) {
    let _ = STATE.try_update(Ordering::AcqRel, Ordering::Acquire, |state| {
        (state >> 2 == epoch).then_some(epoch << 2 | health as u64)
    });
}

/// The group and test URL to check, borrowed from the config snapshot they were read from.
struct Target {
    verge: SharedDraft<IVerge>,
    global: bool,
}

impl Target {
    async fn current() -> Option<Self> {
        let verge = Config::verge().await.latest_arc();
        if !verge.enable_tray_health_icon.unwrap_or(false)
            || CoreManager::global().current_core_readiness_generation().is_none()
            || matches!(IconKind::current(&verge), IconKind::Common)
        {
            return None;
        }
        let global = match current_clash_mode().await {
            "global" => true,
            "rule" => false,
            _ => return None,
        };
        let target = Self { verge, global };
        target.group().is_some().then_some(target)
    }

    fn group(&self) -> Option<&str> {
        if self.global {
            return Some("GLOBAL");
        }
        self.verge
            .tray_health_group
            .as_deref()
            .map(str::trim)
            .filter(|group| !group.is_empty())
    }

    fn default_url(&self) -> Option<&str> {
        self.verge
            .default_latency_test
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
    }
}

impl PartialEq for Target {
    fn eq(&self, other: &Self) -> bool {
        self.group() == other.group() && self.default_url() == other.default_url()
    }
}

struct Evaluator<'a> {
    proxies: &'a HashMap<String, Proxy>,
    default_url: Option<&'a str>,
    now: DateTime<Utc>,
}

impl<'a> Evaluator<'a> {
    fn group_url(&self, group: &'a Proxy) -> Option<&'a str> {
        group
            .test_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .or(self.default_url)
    }

    fn node(&self, name: &'a str, url: Option<&'a str>, path: &mut Vec<&'a str>) -> TrayHealth {
        if path.len() >= 8 || path.contains(&name) {
            return TrayHealth::Unknown;
        }
        let Some(proxy) = self.proxies.get(name) else {
            return TrayHealth::Unknown;
        };
        path.push(name);
        let health = match proxy.proxy_type {
            ProxyType::Selector => match proxy.now.as_deref().filter(|now| !now.is_empty()) {
                Some(now) => self.node(now, self.group_url(proxy), path),
                None => TrayHealth::Unknown,
            },
            // `now` of these groups can lag behind the real exit, so only a group whose members
            // all failed is reported, and never as healthy.
            ProxyType::URLTest | ProxyType::Fallback | ProxyType::LoadBalance => {
                let url = self.group_url(proxy);
                let members = proxy.all.as_deref().unwrap_or_default();
                if !members.is_empty()
                    && members
                        .iter()
                        .all(|member| self.node(member, url, path) == TrayHealth::Unhealthy)
                {
                    TrayHealth::Unhealthy
                } else {
                    TrayHealth::Unknown
                }
            }
            ProxyType::Relay
            | ProxyType::Reject
            | ProxyType::RejectDrop
            | ProxyType::Pass
            | ProxyType::PassRule
            | ProxyType::Compatible
            | ProxyType::Dns => TrayHealth::Unknown,
            // Unrecognized group types keep their own records, which do not describe the exit.
            _ if proxy.all.is_some() => TrayHealth::Unknown,
            _ => self.leaf(proxy, url),
        };
        path.pop();
        health
    }

    fn leaf(&self, proxy: &Proxy, url: Option<&str>) -> TrayHealth {
        let Some(url) = url else {
            return TrayHealth::Unknown;
        };
        let Some(record) = proxy.extra.get(url).and_then(|extra| extra.history.last()) else {
            return TrayHealth::Unknown;
        };
        let Ok(time) = DateTime::parse_from_rfc3339(&record.time) else {
            return TrayHealth::Unknown;
        };
        let age = self.now.signed_duration_since(time);
        // 30 minutes matches the frontend delay cache TTL in `src/services/delay.ts`.
        if age > TimeDelta::minutes(30) || age < -TimeDelta::minutes(5) {
            return TrayHealth::Unknown;
        }
        if record.delay > 0 {
            TrayHealth::Healthy
        } else {
            TrayHealth::Unhealthy
        }
    }
}

fn evaluate<'a>(
    proxies: &'a HashMap<String, Proxy>,
    group: &'a str,
    default_url: Option<&'a str>,
    now: DateTime<Utc>,
) -> TrayHealth {
    Evaluator {
        proxies,
        default_url,
        now,
    }
    .node(group, default_url, &mut Vec::new())
}

async fn poll_once() {
    let epoch = STATE.load(Ordering::Acquire) >> 2;
    let Some(target) = Target::current().await else {
        return publish(epoch, TrayHealth::Unknown);
    };
    let group = target.group().unwrap_or_default();
    let health = match tokio::time::timeout(Duration::from_secs(3), handle::Handle::mihomo().get_proxies()).await {
        Ok(Ok(proxies)) => evaluate(&proxies.proxies, group, target.default_url(), Utc::now()),
        Ok(Err(err)) => {
            logging!(debug, Type::Tray, "托盘健康状态获取失败: {err}");
            TrayHealth::Unknown
        }
        Err(_) => {
            logging!(debug, Type::Tray, "托盘健康状态获取超时");
            TrayHealth::Unknown
        }
    };
    // The monitored group or test URL changed while fetching.
    if Target::current().await.as_ref() != Some(&target) {
        return wake();
    }
    publish(epoch, health);
}

#[derive(Default)]
pub struct TrayHealthController {
    task: Mutex<Option<JoinHandle<()>>>,
}

impl TrayHealthController {
    pub fn update_task(&self, enabled: bool) {
        if enabled {
            self.start_task();
            wake();
            return;
        }
        let task = self.task.lock().take();
        if let Some(task) = task {
            task.abort();
            invalidate();
        }
    }

    fn start_task(&self) {
        if handle::Handle::global().is_exiting() {
            return;
        }
        let mut guard = self.task.lock();
        if guard.as_ref().is_some_and(|task| !task.inner().is_finished()) {
            return;
        }
        *guard = Some(AsyncHandler::spawn(|| async {
            loop {
                if handle::Handle::global().is_exiting() {
                    break;
                }
                poll_once().await;
                refresh_icon().await;
                tokio::select! {
                    _ = WAKE.notified() => tokio::time::sleep(Duration::from_millis(300)).await,
                    _ = tokio::time::sleep(Duration::from_secs(30)) => {}
                }
            }
        }));
    }
}

async fn refresh_icon() {
    clash_verge_logging::logging_error!(Type::Tray, super::Tray::global().refresh_health_icon().await);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_mihomo::models::{DelayHistory, Extra};

    fn proxy(
        name: &str,
        proxy_type: ProxyType,
        now: Option<&str>,
        all: &[&str],
        url: &str,
        delays: &[(i64, u16)],
    ) -> Proxy {
        let history = delays
            .iter()
            .map(|(minutes_ago, delay)| DelayHistory {
                time: (Utc::now() - TimeDelta::minutes(*minutes_ago)).to_rfc3339(),
                delay: *delay,
            })
            .collect();
        Proxy {
            name: name.into(),
            proxy_type,
            now: now.map(Into::into),
            all: (!all.is_empty()).then(|| all.iter().map(|member| (*member).into()).collect()),
            test_url: Some(url.into()),
            extra: HashMap::from([(
                url.into(),
                Extra {
                    history,
                    ..Extra::default()
                },
            )]),
            ..Proxy::default()
        }
    }

    fn eval(items: Vec<Proxy>, default_url: Option<&str>) -> TrayHealth {
        let proxies = items.into_iter().map(|proxy| (proxy.name.clone(), proxy)).collect();
        evaluate(&proxies, "G", default_url, Utc::now())
    }

    #[test]
    fn selector_uses_the_latest_fresh_record_for_its_url() {
        let url = "http://example.test/204";
        let selector = |url: &str| proxy("G", ProxyType::Selector, Some("a"), &["a"], url, &[]);
        let leaf = |url: &str, delays: &[(i64, u16)]| proxy("a", ProxyType::Vmess, None, &[], url, delays);

        assert_eq!(
            eval(vec![selector(url), leaf(url, &[(5, 0), (1, 90)])], None),
            TrayHealth::Healthy
        );
        assert_eq!(
            eval(vec![selector(url), leaf(url, &[(1, 0)])], None),
            TrayHealth::Unhealthy
        );
        assert_eq!(
            eval(vec![selector(url), leaf(url, &[(31, 0)])], None),
            TrayHealth::Unknown
        );
        assert_eq!(
            eval(vec![selector(url), leaf("http://other.test", &[(1, 0)])], None),
            TrayHealth::Unknown
        );
        assert_eq!(
            eval(vec![selector(""), leaf(url, &[(1, 0)])], Some(url)),
            TrayHealth::Unhealthy
        );
        assert_eq!(
            eval(vec![selector(""), leaf(url, &[(1, 0)])], None),
            TrayHealth::Unknown
        );
    }

    #[test]
    fn automatic_groups_are_only_unhealthy_when_every_member_failed() {
        let url = "http://example.test/204";
        let group = || proxy("G", ProxyType::URLTest, Some("a"), &["a", "b"], url, &[]);
        let leaf = |name: &str, delay: u16| proxy(name, ProxyType::Vmess, None, &[], url, &[(1, delay)]);

        assert_eq!(
            eval(vec![group(), leaf("a", 0), leaf("b", 0)], None),
            TrayHealth::Unhealthy
        );
        assert_eq!(
            eval(vec![group(), leaf("a", 0), leaf("b", 80)], None),
            TrayHealth::Unknown
        );
    }

    #[test]
    fn cleared_rule_group_is_not_monitored() {
        let mut verge = IVerge::default();
        verge.patch_config(&IVerge {
            tray_health_group: Some("Proxy".into()),
            ..IVerge::default()
        });
        verge.patch_config(&IVerge {
            tray_health_group: Some("".into()),
            ..IVerge::default()
        });
        let target = Target {
            verge: std::sync::Arc::new(Box::new(verge)),
            global: false,
        };
        assert_eq!(target.group(), None);
    }
}
