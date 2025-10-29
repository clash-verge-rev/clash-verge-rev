use super::{CmdResult, StringifyErr, profile_switch};
use crate::{
    config::{
        Config, IProfiles, PrfItem, PrfOption,
        profiles::{
            profiles_append_item_with_filedata_safe, profiles_delete_item_safe,
            profiles_patch_item_safe, profiles_reorder_safe, profiles_save_file_safe,
        },
        profiles_append_item_safe,
    },
    core::{CoreManager, handle, timer::Timer},
    feat, logging, ret_err,
    utils::{dirs, help, logging::Type},
};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use smartstring::alias::String;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::cmd::profile_switch::{ProfileSwitchStatus, SwitchResultEvent};

#[derive(Clone)]
struct CachedProfiles {
    snapshot: IProfiles,
    captured_at: Instant,
}

static PROFILES_CACHE: Lazy<RwLock<Option<CachedProfiles>>> = Lazy::new(|| RwLock::new(None));

#[derive(Default)]
struct SnapshotMetrics {
    fast_hits: AtomicU64,
    cache_hits: AtomicU64,
    blocking_hits: AtomicU64,
    refresh_scheduled: AtomicU64,
    last_log_ms: AtomicU64,
}

static SNAPSHOT_METRICS: Lazy<SnapshotMetrics> = Lazy::new(SnapshotMetrics::default);

/// Store the latest snapshot so cache consumers can reuse it without hitting the lock again.
fn update_profiles_cache(snapshot: &IProfiles) {
    *PROFILES_CACHE.write() = Some(CachedProfiles {
        snapshot: snapshot.clone(),
        captured_at: Instant::now(),
    });
}

/// Return the cached snapshot and how old it is, if present.
fn cached_profiles_snapshot() -> Option<(IProfiles, u128)> {
    PROFILES_CACHE.read().as_ref().map(|entry| {
        (
            entry.snapshot.clone(),
            entry.captured_at.elapsed().as_millis(),
        )
    })
}

/// Return the latest profiles snapshot, preferring cached data so UI requests never block.
#[tauri::command]
pub async fn get_profiles() -> CmdResult<IProfiles> {
    let started_at = Instant::now();

    // Resolve snapshots in three tiers so UI reads never stall on a mutex:
    // 1) try a non-blocking read, 2) fall back to the last cached copy while a
    // writer holds the lock, 3) block and refresh the cache as a final resort.
    if let Some(snapshot) = read_profiles_snapshot_nonblocking().await {
        let item_count = snapshot
            .items
            .as_ref()
            .map(|items| items.len())
            .unwrap_or(0);
        update_profiles_cache(&snapshot);
        SNAPSHOT_METRICS.fast_hits.fetch_add(1, Ordering::Relaxed);
        logging!(
            debug,
            Type::Cmd,
            "[Profiles] Snapshot served (path=fast, items={}, elapsed={}ms)",
            item_count,
            started_at.elapsed().as_millis()
        );
        maybe_log_snapshot_metrics();
        return Ok(snapshot);
    }

    if let Some((cached, age_ms)) = cached_profiles_snapshot() {
        SNAPSHOT_METRICS.cache_hits.fetch_add(1, Ordering::Relaxed);
        logging!(
            debug,
            Type::Cmd,
            "[Profiles] Served cached snapshot while lock busy (age={}ms)",
            age_ms
        );
        schedule_profiles_snapshot_refresh();
        maybe_log_snapshot_metrics();
        return Ok(cached);
    }

    let snapshot = read_profiles_snapshot_blocking().await;
    let item_count = snapshot
        .items
        .as_ref()
        .map(|items| items.len())
        .unwrap_or(0);
    update_profiles_cache(&snapshot);
    SNAPSHOT_METRICS
        .blocking_hits
        .fetch_add(1, Ordering::Relaxed);
    logging!(
        debug,
        Type::Cmd,
        "[Profiles] Snapshot served (path=blocking, items={}, elapsed={}ms)",
        item_count,
        started_at.elapsed().as_millis()
    );
    maybe_log_snapshot_metrics();
    Ok(snapshot)
}

/// Try to grab the latest profile data without waiting for the writer.
async fn read_profiles_snapshot_nonblocking() -> Option<IProfiles> {
    let profiles = Config::profiles().await;
    profiles.try_latest_ref().map(|guard| (**guard).clone())
}

/// Fall back to a blocking read when we absolutely must have fresh data.
async fn read_profiles_snapshot_blocking() -> IProfiles {
    let profiles = Config::profiles().await;
    let guard = profiles.latest_ref();
    (**guard).clone()
}

/// Schedule a background cache refresh once the exclusive lock becomes available again.
fn schedule_profiles_snapshot_refresh() {
    crate::process::AsyncHandler::spawn(|| async {
        // Once the lock is released we refresh the cached snapshot so the next
        // request observes the latest data instead of the stale fallback.
        SNAPSHOT_METRICS
            .refresh_scheduled
            .fetch_add(1, Ordering::Relaxed);
        let snapshot = read_profiles_snapshot_blocking().await;
        update_profiles_cache(&snapshot);
        logging!(
            debug,
            Type::Cmd,
            "[Profiles] Cache refreshed after busy snapshot"
        );
    });
}

fn maybe_log_snapshot_metrics() {
    const LOG_INTERVAL_MS: u64 = 5_000;
    let now_ms = current_millis();
    let last_ms = SNAPSHOT_METRICS.last_log_ms.load(Ordering::Relaxed);
    if now_ms.saturating_sub(last_ms) < LOG_INTERVAL_MS {
        return;
    }

    if SNAPSHOT_METRICS
        .last_log_ms
        .compare_exchange(last_ms, now_ms, Ordering::SeqCst, Ordering::Relaxed)
        .is_err()
    {
        return;
    }

    let fast = SNAPSHOT_METRICS.fast_hits.swap(0, Ordering::SeqCst);
    let cache = SNAPSHOT_METRICS.cache_hits.swap(0, Ordering::SeqCst);
    let blocking = SNAPSHOT_METRICS.blocking_hits.swap(0, Ordering::SeqCst);
    let refresh = SNAPSHOT_METRICS.refresh_scheduled.swap(0, Ordering::SeqCst);

    if fast == 0 && cache == 0 && blocking == 0 && refresh == 0 {
        return;
    }

    logging!(
        debug,
        Type::Cmd,
        "[Profiles][Metrics] 5s window => fast={}, cache={}, blocking={}, refresh_jobs={}",
        fast,
        cache,
        blocking,
        refresh
    );
}

fn current_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

/// Run the optional enhancement pipeline and refresh Clash when it completes.
#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    match feat::enhance_profiles().await {
        Ok(_) => {}
        Err(e) => {
            log::error!(target: "app", "{}", e);
            return Err(e.to_string().into());
        }
    }
    handle::Handle::refresh_clash();
    Ok(())
}

/// Download a profile from the given URL and persist it to the local catalog.
#[tauri::command]
pub async fn import_profile(url: std::string::String, option: Option<PrfOption>) -> CmdResult {
    logging!(info, Type::Cmd, "[Profile Import] Begin: {}", url);

    // Rely on PrfItem::from_url internal timeout/retry logic instead of wrapping with tokio::time::timeout
    let item = match PrfItem::from_url(&url, None, None, option).await {
        Ok(it) => {
            logging!(
                info,
                Type::Cmd,
                "[Profile Import] Download complete; saving configuration"
            );
            it
        }
        Err(e) => {
            logging!(error, Type::Cmd, "[Profile Import] Download failed: {}", e);
            return Err(format!("Profile import failed: {}", e).into());
        }
    };

    match profiles_append_item_safe(item.clone()).await {
        Ok(_) => match profiles_save_file_safe().await {
            Ok(_) => {
                logging!(
                    info,
                    Type::Cmd,
                    "[Profile Import] Configuration file saved successfully"
                );
            }
            Err(e) => {
                logging!(
                    error,
                    Type::Cmd,
                    "[Profile Import] Failed to save configuration file: {}",
                    e
                );
            }
        },
        Err(e) => {
            logging!(
                error,
                Type::Cmd,
                "[Profile Import] Failed to persist configuration: {}",
                e
            );
            return Err(format!("Profile import failed: {}", e).into());
        }
    }
    // Immediately emit a configuration change notification
    if let Some(uid) = &item.uid {
        logging!(
            info,
            Type::Cmd,
            "[Profile Import] Emitting configuration change event: {}",
            uid
        );
        handle::Handle::notify_profile_changed(uid.clone());
    }

    // Save configuration asynchronously and emit a global notification
    let uid_clone = item.uid.clone();
    if let Some(uid) = uid_clone {
        // Delay notification to ensure the file is fully written
        tokio::time::sleep(Duration::from_millis(100)).await;
        handle::Handle::notify_profile_changed(uid);
    }

    logging!(info, Type::Cmd, "[Profile Import] Completed: {}", url);
    Ok(())
}

/// Move a profile in the list relative to another entry.
#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    match profiles_reorder_safe(active_id, over_id).await {
        Ok(_) => {
            log::info!(target: "app", "Reordered profiles");
            Ok(())
        }
        Err(err) => {
            log::error!(target: "app", "Failed to reorder profiles: {}", err);
            Err(format!("Failed to reorder profiles: {}", err).into())
        }
    }
}

/// Create a new profile entry and optionally write its backing file.
#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    match profiles_append_item_with_filedata_safe(item.clone(), file_data).await {
        Ok(_) => {
            // Emit configuration change notification
            if let Some(uid) = &item.uid {
                logging!(
                    info,
                    Type::Cmd,
                    "[Profile Create] Emitting configuration change event: {}",
                    uid
                );
                handle::Handle::notify_profile_changed(uid.clone());
            }
            Ok(())
        }
        Err(err) => match err.to_string().as_str() {
            "the file already exists" => Err("the file already exists".into()),
            _ => Err(format!("add profile error: {err}").into()),
        },
    }
}

/// Force-refresh a profile from its remote source, if available.
#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
    match feat::update_profile(index, option, Some(true)).await {
        Ok(_) => Ok(()),
        Err(e) => {
            log::error!(target: "app", "{}", e);
            Err(e.to_string().into())
        }
    }
}

/// Remove a profile and refresh the running configuration if necessary.
#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    println!("delete_profile: {}", index);
    // Use send-safe helper function
    let should_update = profiles_delete_item_safe(index.clone())
        .await
        .stringify_err()?;
    profiles_save_file_safe().await.stringify_err()?;

    if should_update {
        match CoreManager::global().update_config().await {
            Ok(_) => {
                handle::Handle::refresh_clash();
                // Emit configuration change notification
                logging!(
                    info,
                    Type::Cmd,
                    "[Profile Delete] Emitting configuration change event: {}",
                    index
                );
                handle::Handle::notify_profile_changed(index);
            }
            Err(e) => {
                log::error!(target: "app", "{}", e);
                return Err(e.to_string().into());
            }
        }
    }
    Ok(())
}

/// Apply partial profile list updates through the switching workflow.
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    profile_switch::patch_profiles_config(profiles).await
}

/// Switch to the provided profile index and wait for completion before returning.
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(profile_index: String) -> CmdResult<bool> {
    profile_switch::patch_profiles_config_by_profile_index(profile_index).await
}

/// Enqueue a profile switch request and optionally notify on success.
#[tauri::command]
pub async fn switch_profile(profile_index: String, notify_success: bool) -> CmdResult<bool> {
    profile_switch::switch_profile(profile_index, notify_success).await
}

/// Update a specific profile item and refresh timers if its schedule changed.
#[tauri::command]
pub async fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    // Check for update_interval changes before saving
    let profiles = Config::profiles().await;
    let should_refresh_timer = if let Ok(old_profile) = profiles.latest_ref().get_item(&index) {
        let old_interval = old_profile.option.as_ref().and_then(|o| o.update_interval);
        let new_interval = profile.option.as_ref().and_then(|o| o.update_interval);
        let old_allow_auto_update = old_profile
            .option
            .as_ref()
            .and_then(|o| o.allow_auto_update);
        let new_allow_auto_update = profile.option.as_ref().and_then(|o| o.allow_auto_update);
        (old_interval != new_interval) || (old_allow_auto_update != new_allow_auto_update)
    } else {
        false
    };

    profiles_patch_item_safe(index.clone(), profile)
        .await
        .stringify_err()?;

    // If the interval or auto-update flag changes, refresh the timer asynchronously
    if should_refresh_timer {
        let index_clone = index.clone();
        crate::process::AsyncHandler::spawn(move || async move {
            logging!(
                info,
                Type::Timer,
                "Timer interval changed; refreshing timer..."
            );
            if let Err(e) = crate::core::Timer::global().refresh().await {
                logging!(error, Type::Timer, "Failed to refresh timer: {}", e);
            } else {
                // After refreshing successfully, emit a custom event without triggering a reload
                crate::core::handle::Handle::notify_timer_updated(index_clone);
            }
        });
    }

    Ok(())
}

/// Open the profile file in the system viewer.
#[tauri::command]
pub async fn view_profile(index: String) -> CmdResult {
    let profiles = Config::profiles().await;
    let profiles_ref = profiles.latest_ref();
    let file = profiles_ref
        .get_item(&index)
        .stringify_err()?
        .file
        .clone()
        .ok_or("the file field is null")?;

    let path = dirs::app_profiles_dir()
        .stringify_err()?
        .join(file.as_str());
    if !path.exists() {
        ret_err!("the file not found");
    }

    help::open_file(path).stringify_err()
}

/// Return the raw YAML contents for the given profile file.
#[tauri::command]
pub async fn read_profile_file(index: String) -> CmdResult<String> {
    let profiles = Config::profiles().await;
    let profiles_ref = profiles.latest_ref();
    let item = profiles_ref.get_item(&index).stringify_err()?;
    let data = item.read_file().stringify_err()?;
    Ok(data)
}

/// Report the scheduled refresh timestamp (if any) for the profile timer.
#[tauri::command]
pub async fn get_next_update_time(uid: String) -> CmdResult<Option<i64>> {
    let timer = Timer::global();
    let next_time = timer.get_next_update_time(&uid).await;
    Ok(next_time)
}

/// Return the latest driver snapshot describing active and queued switch tasks.
#[tauri::command]
pub async fn get_profile_switch_status() -> CmdResult<ProfileSwitchStatus> {
    profile_switch::get_switch_status()
}

/// Fetch switch result events newer than the provided sequence number.
#[tauri::command]
pub async fn get_profile_switch_events(after_sequence: u64) -> CmdResult<Vec<SwitchResultEvent>> {
    profile_switch::get_switch_events(after_sequence)
}
