use crate::config::Config;
use crate::core::{CoreManager, handle};
use crate::process::AsyncHandler;
use crate::{Type, logging};
use chrono::{DateTime, TimeDelta, Utc};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri_plugin_mihomo::models::{Proxy, ProxyType};
use tokio::sync::Notify;

// Must match the frontend fallback in `src/services/delay.ts`, which keys the delay records Mihomo stores.
const FRONTEND_DEFAULT_TEST_URL: &str = "http://cp.cloudflare.com/generate_204";
const POLL_INTERVAL: Duration = Duration::from_secs(30);
const FETCH_TIMEOUT: Duration = Duration::from_secs(3);
const WAKE_DEBOUNCE: Duration = Duration::from_millis(300);
// Matches the frontend delay cache TTL in `src/services/delay.ts`.
const RECORD_TTL: TimeDelta = TimeDelta::minutes(30);
const FUTURE_SKEW: TimeDelta = TimeDelta::minutes(5);
const MAX_DEPTH: usize = 8;

const BADGE_RED: [u8; 3] = [0xFF, 0x3B, 0x30];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayHealth {
    Unknown,
    Healthy,
    Unhealthy,
}

/// Everything a health result depends on; a result is only shown while its key is still current.
#[derive(Clone, Debug, PartialEq, Eq)]
struct HealthKey {
    group: String,
    default_url: String,
    core_generation: u64,
    epoch: u64,
}

static EPOCH: AtomicU64 = AtomicU64::new(0);
static WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);
static RESULT: Mutex<Option<(HealthKey, TrayHealth)>> = Mutex::new(None);

/// Requests a re-evaluation soon; coalesces with pending requests.
pub fn wake() {
    WAKE.notify_one();
}

/// Discards in-flight and published results, e.g. when the Core reloads its configuration
/// (which clears delay history without changing the readiness generation) or a selection changes.
pub fn invalidate() {
    EPOCH.fetch_add(1, Ordering::AcqRel);
    wake();
}

fn monitored_group(mode: &str, routes_traffic: bool, group_setting: Option<&str>) -> Option<String> {
    if !routes_traffic {
        return None;
    }
    match mode {
        "global" => Some("GLOBAL".into()),
        "rule" => group_setting
            .map(str::trim)
            .filter(|group| !group.is_empty())
            .map(Into::into),
        _ => None,
    }
}

async fn current_key() -> Option<HealthKey> {
    let verge = Config::verge().await.latest_arc();
    if !verge.enable_tray_health_icon.unwrap_or(false) {
        return None;
    }
    let core_generation = CoreManager::global().current_core_readiness_generation()?;
    let mode = Config::clash()
        .await
        .latest_arc()
        .0
        .get("mode")
        .and_then(|mode| mode.as_str())
        .unwrap_or("rule")
        .to_owned();
    let tun = verge.enable_tun_mode.unwrap_or(false) && crate::core::runstate::RUN_STATE.state().tun_capable();
    let routes_traffic = tun || verge.enable_system_proxy.unwrap_or(false);
    let group = monitored_group(&mode, routes_traffic, verge.tray_health_group.as_deref())?;
    let default_url = verge
        .default_latency_test
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .unwrap_or(FRONTEND_DEFAULT_TEST_URL)
        .into();
    Some(HealthKey {
        group,
        default_url,
        core_generation,
        epoch: EPOCH.load(Ordering::Acquire),
    })
}

/// The health shown by the tray icon; `Unknown` unless the published result is still current.
pub async fn current_health() -> TrayHealth {
    let Some(key) = current_key().await else {
        return TrayHealth::Unknown;
    };
    match &*RESULT.lock() {
        Some((published, health)) if *published == key => *health,
        _ => TrayHealth::Unknown,
    }
}

struct Evaluator<'a> {
    proxies: &'a HashMap<String, Proxy>,
    default_url: &'a str,
    now: DateTime<Utc>,
}

impl Evaluator<'_> {
    fn group_url<'p>(&'p self, group: &'p Proxy) -> &'p str {
        group
            .test_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .unwrap_or(self.default_url)
    }

    fn node(&self, name: &str, url: &str, path: &mut Vec<String>) -> TrayHealth {
        if path.len() >= MAX_DEPTH || path.iter().any(|visited| visited == name) {
            return TrayHealth::Unknown;
        }
        let Some(proxy) = self.proxies.get(name) else {
            return TrayHealth::Unknown;
        };
        path.push(name.into());
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

    fn leaf(&self, proxy: &Proxy, url: &str) -> TrayHealth {
        let Some(record) = proxy.extra.get(url).and_then(|extra| extra.history.last()) else {
            return TrayHealth::Unknown;
        };
        let Ok(time) = DateTime::parse_from_rfc3339(&record.time) else {
            return TrayHealth::Unknown;
        };
        let age = self.now.signed_duration_since(time);
        if age > RECORD_TTL || age < -FUTURE_SKEW {
            return TrayHealth::Unknown;
        }
        if record.delay > 0 {
            TrayHealth::Healthy
        } else {
            TrayHealth::Unhealthy
        }
    }
}

fn evaluate(proxies: &HashMap<String, Proxy>, group: &str, default_url: &str, now: DateTime<Utc>) -> TrayHealth {
    Evaluator {
        proxies,
        default_url,
        now,
    }
    .node(group, default_url, &mut Vec::new())
}

/// Marks the icon unhealthy while keeping its mode glyph recognizable.
/// Template icons are tinted instead of badged: macOS discards their colors, and a badge would
/// cover the cut-out mode letter that distinguishes them.
pub fn add_health_warning(rgba: &mut [u8], width: u32, height: u32, template: bool) {
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return;
    }
    if template {
        for pixel in rgba.as_chunks_mut::<4>().0.iter_mut().filter(|pixel| pixel[3] > 0) {
            pixel[..3].copy_from_slice(&BADGE_RED);
        }
        return;
    }

    let radius = w.min(h) as f32 * 0.3;
    let gap = (radius * 0.25).max(1.0);
    let (cx, cy) = (w as f32 - radius, h as f32 - radius);
    let bar_half_width = (radius * 0.14).max(0.5);
    let show_mark = radius >= 5.0;
    for y in 0..h {
        for x in 0..w {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let distance = ((px - cx).powi(2) + (py - cy).powi(2)).sqrt();
            let index = (y * w + x) * 4;
            if distance > radius + gap + 0.5 {
                continue;
            }
            let pixel = &mut rgba[index..index + 4];
            // A transparent ring separates the badge from the glyph on any menu bar color.
            let clear = (radius + gap + 0.5 - distance).clamp(0.0, 1.0);
            pixel[3] = (f32::from(pixel[3]) * (1.0 - clear)) as u8;
            let fill = (radius + 0.5 - distance).clamp(0.0, 1.0);
            if fill <= 0.0 {
                continue;
            }
            let is_mark = show_mark
                && (px - cx).abs() <= bar_half_width
                && ((py >= cy - radius * 0.55 && py <= cy + radius * 0.12)
                    || (py >= cy + radius * 0.3 && py <= cy + radius * 0.55));
            let color = if is_mark { [0xFF; 3] } else { BADGE_RED };
            pixel[..3].copy_from_slice(&color);
            pixel[3] = pixel[3].max((fill * 255.0) as u8);
        }
    }
}

async fn poll_once() -> bool {
    let Some(key) = current_key().await else {
        return publish(None);
    };
    let health = match tokio::time::timeout(FETCH_TIMEOUT, handle::Handle::mihomo().get_proxies()).await {
        Ok(Ok(proxies)) => evaluate(&proxies.proxies, &key.group, &key.default_url, Utc::now()),
        Ok(Err(err)) => {
            logging!(debug, Type::Tray, "托盘健康状态获取失败: {err}");
            TrayHealth::Unknown
        }
        Err(_) => {
            logging!(debug, Type::Tray, "托盘健康状态获取超时");
            TrayHealth::Unknown
        }
    };
    if current_key().await.as_ref() != Some(&key) {
        // The response may describe a replaced Core, reloaded config or old selection.
        wake();
        return false;
    }
    publish(Some((key, health)))
}

fn publish(result: Option<(HealthKey, TrayHealth)>) -> bool {
    let mut published = RESULT.lock();
    let changed = *published != result;
    *published = result;
    changed
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
            publish(None);
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
                if poll_once().await {
                    refresh_icon().await;
                }
                tokio::select! {
                    _ = WAKE.notified() => tokio::time::sleep(WAKE_DEBOUNCE).await,
                    _ = tokio::time::sleep(POLL_INTERVAL) => {}
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

    const URL: &str = "http://example.test/204";
    const DEFAULT: &str = "http://default.test/204";

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-09T12:00:00+08:00")
            .map(|time| time.with_timezone(&Utc))
            .unwrap_or_default()
    }

    fn record(minutes_ago: i64, delay: u16) -> DelayHistory {
        DelayHistory {
            time: (now() - TimeDelta::minutes(minutes_ago)).to_rfc3339(),
            delay,
        }
    }

    fn leaf(name: &str, proxy_type: ProxyType, records: &[(&str, DelayHistory)]) -> Proxy {
        let mut extra = HashMap::new();
        for (url, history) in records {
            extra
                .entry((*url).into())
                .or_insert_with(Extra::default)
                .history
                .push(DelayHistory {
                    time: history.time.clone(),
                    delay: history.delay,
                });
        }
        Proxy {
            name: name.into(),
            proxy_type,
            alive: true,
            extra,
            ..Proxy::default()
        }
    }

    fn group(name: &str, proxy_type: ProxyType, members: &[&str], now: Option<&str>, url: &str) -> Proxy {
        Proxy {
            name: name.into(),
            proxy_type,
            alive: true,
            all: Some(members.iter().map(|member| (*member).into()).collect()),
            now: now.map(Into::into),
            test_url: Some(url.into()),
            ..Proxy::default()
        }
    }

    fn proxies(items: Vec<Proxy>) -> HashMap<String, Proxy> {
        items.into_iter().map(|proxy| (proxy.name.clone(), proxy)).collect()
    }

    fn eval(items: Vec<Proxy>, target: &str) -> TrayHealth {
        evaluate(&proxies(items), target, DEFAULT, now())
    }

    #[test]
    fn monitored_group_follows_mode_and_traffic_routing() {
        assert_eq!(monitored_group("global", true, Some("Proxy")), Some("GLOBAL".into()));
        assert_eq!(monitored_group("rule", true, Some(" Proxy ")), Some("Proxy".into()));
        assert_eq!(monitored_group("rule", true, Some("  ")), None);
        assert_eq!(monitored_group("rule", true, None), None);
        assert_eq!(monitored_group("direct", true, Some("Proxy")), None);
        assert_eq!(monitored_group("global", false, Some("Proxy")), None);
    }

    #[test]
    fn selector_reads_only_its_url_record() {
        let selector = |url: &str| group("S", ProxyType::Selector, &["a"], Some("a"), url);
        let ok = leaf("a", ProxyType::Vmess, &[(URL, record(1, 120))]);
        assert_eq!(eval(vec![selector(URL), ok], "S"), TrayHealth::Healthy);

        let failed = leaf("a", ProxyType::Vmess, &[(URL, record(1, 0))]);
        assert_eq!(eval(vec![selector(URL), failed], "S"), TrayHealth::Unhealthy);

        // A success recorded for another URL is not evidence for this one.
        let other_url = leaf("a", ProxyType::Vmess, &[(DEFAULT, record(1, 120))]);
        assert_eq!(eval(vec![selector(URL), other_url], "S"), TrayHealth::Unknown);

        let empty_url = leaf("a", ProxyType::Vmess, &[(DEFAULT, record(1, 0))]);
        assert_eq!(eval(vec![selector(""), empty_url], "S"), TrayHealth::Unhealthy);
    }

    #[test]
    fn latest_record_wins_and_old_or_future_records_are_unknown() {
        let selector = group("S", ProxyType::Selector, &["a"], Some("a"), URL);
        let recovered = leaf("a", ProxyType::Vmess, &[(URL, record(5, 0)), (URL, record(1, 90))]);
        assert_eq!(eval(vec![selector, recovered], "S"), TrayHealth::Healthy);

        for minutes_ago in [31, -6] {
            let selector = group("S", ProxyType::Selector, &["a"], Some("a"), URL);
            let failed = leaf("a", ProxyType::Vmess, &[(URL, record(minutes_ago, 0))]);
            assert_eq!(eval(vec![selector, failed], "S"), TrayHealth::Unknown);
        }

        let selector = group("S", ProxyType::Selector, &["a"], Some("a"), URL);
        let mut garbled = leaf("a", ProxyType::Vmess, &[(URL, record(1, 0))]);
        if let Some(extra) = garbled.extra.get_mut(URL) {
            extra.history[0].time = "not a time".into();
        }
        assert_eq!(eval(vec![selector, garbled], "S"), TrayHealth::Unknown);
    }

    #[test]
    fn mihomo_time_format_is_accepted() {
        let selector = group("S", ProxyType::Selector, &["a"], Some("a"), URL);
        let mut failed = leaf("a", ProxyType::Vmess, &[(URL, record(1, 0))]);
        if let Some(extra) = failed.extra.get_mut(URL) {
            extra.history[0].time = "2026-11-09T11:58:49.93734+08:00".into();
        }
        assert_eq!(eval(vec![selector, failed], "S"), TrayHealth::Unhealthy);
    }

    #[test]
    fn untested_direct_and_non_proxy_targets_are_unknown() {
        let selector = |now: &str| group("S", ProxyType::Selector, &[now], Some(now), URL);
        let direct = leaf("DIRECT", ProxyType::Direct, &[]);
        assert_eq!(eval(vec![selector("DIRECT"), direct], "S"), TrayHealth::Unknown);

        let tested_direct = leaf("DIRECT", ProxyType::Direct, &[(URL, record(1, 30))]);
        assert_eq!(eval(vec![selector("DIRECT"), tested_direct], "S"), TrayHealth::Healthy);

        let reject = leaf("REJECT", ProxyType::Reject, &[(URL, record(1, 0))]);
        assert_eq!(eval(vec![selector("REJECT"), reject], "S"), TrayHealth::Unknown);

        assert_eq!(eval(vec![selector("missing")], "S"), TrayHealth::Unknown);
        assert_eq!(eval(vec![], "S"), TrayHealth::Unknown);
    }

    #[test]
    fn nested_selectors_resolve_and_cycles_are_unknown() {
        let outer = group("Outer", ProxyType::Selector, &["Inner"], Some("Inner"), "");
        let inner = group("Inner", ProxyType::Selector, &["a"], Some("a"), URL);
        let failed = leaf("a", ProxyType::Vmess, &[(URL, record(1, 0))]);
        assert_eq!(eval(vec![outer, inner, failed], "Outer"), TrayHealth::Unhealthy);

        let a = group("A", ProxyType::Selector, &["B"], Some("B"), URL);
        let b = group("B", ProxyType::Selector, &["A"], Some("A"), URL);
        assert_eq!(eval(vec![a, b], "A"), TrayHealth::Unknown);
    }

    #[test]
    fn automatic_groups_are_only_unhealthy_when_every_member_failed() {
        for kind in ["URLTest", "Fallback", "LoadBalance"] {
            let auto = || {
                let kind = match kind {
                    "URLTest" => ProxyType::URLTest,
                    "Fallback" => ProxyType::Fallback,
                    _ => ProxyType::LoadBalance,
                };
                group("Auto", kind, &["a", "b"], Some("a"), URL)
            };
            let dead_a = || leaf("a", ProxyType::Vmess, &[(URL, record(1, 0))]);

            let all_dead = vec![auto(), dead_a(), leaf("b", ProxyType::Vmess, &[(URL, record(2, 0))])];
            assert_eq!(eval(all_dead, "Auto"), TrayHealth::Unhealthy);

            // A lagging `now` must not be read as the exit, in either direction.
            let one_alive = vec![auto(), dead_a(), leaf("b", ProxyType::Vmess, &[(URL, record(1, 80))])];
            assert_eq!(eval(one_alive, "Auto"), TrayHealth::Unknown);
            let all_alive = vec![
                auto(),
                leaf("a", ProxyType::Vmess, &[(URL, record(1, 80))]),
                leaf("b", ProxyType::Vmess, &[(URL, record(1, 80))]),
            ];
            assert_eq!(eval(all_alive, "Auto"), TrayHealth::Unknown);

            let one_untested = vec![auto(), dead_a(), leaf("b", ProxyType::Vmess, &[])];
            assert_eq!(eval(one_untested, "Auto"), TrayHealth::Unknown);
        }
    }

    #[test]
    fn warning_badges_colored_icons_and_tints_template_icons() {
        let size = 32u32;
        let mut rgba = vec![0u8; (size * size * 4) as usize];
        for pixel in rgba.as_chunks_mut::<4>().0 {
            *pixel = [0, 0, 0, 255];
        }
        add_health_warning(&mut rgba, size, size, false);
        let at = |x: u32, y: u32| {
            let index = ((y * size + x) * 4) as usize;
            [rgba[index], rgba[index + 1], rgba[index + 2], rgba[index + 3]]
        };
        assert_eq!(at(0, 0), [0, 0, 0, 255]);
        assert_eq!(at(27, 22)[..3], BADGE_RED);

        let mut template = vec![0u8; (size * size * 4) as usize];
        template[3] = 255;
        add_health_warning(&mut template, size, size, true);
        assert_eq!(template[..4], [0xFF, 0x3B, 0x30, 255]);
        assert!(template[4..].iter().all(|channel| *channel == 0));
    }
}
