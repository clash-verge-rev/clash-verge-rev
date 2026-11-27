use crate::{config::Config, singleton, utils::dirs};
use anyhow::{Context as _, Result};
use chrono::Utc;
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tauri_plugin_updater::{Update, UpdaterExt as _};
use tokio_util::sync::CancellationToken;

pub struct SilentUpdater {
    update_ready: AtomicBool,
    manual_cancel: Mutex<Option<CancellationToken>>,
    background_cancel: Mutex<Option<CancellationToken>>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum InstallUpdateOutcome {
    Installed,
    Cancelled,
    UpdateChanged,
}

singleton!(SilentUpdater, SILENT_UPDATER);

impl SilentUpdater {
    const fn new() -> Self {
        Self {
            update_ready: AtomicBool::new(false),
            manual_cancel: Mutex::new(None),
            background_cancel: Mutex::new(None),
        }
    }

    pub fn is_update_ready(&self) -> bool {
        self.update_ready.load(Ordering::Acquire)
    }
}

#[derive(Serialize, Deserialize)]
struct UpdateCacheMeta {
    version: String,
    downloaded_at: String,
}

impl SilentUpdater {
    fn cache_dir() -> Result<PathBuf> {
        Ok(dirs::app_home_dir()?.join("update_cache"))
    }

    fn write_cache(bytes: &[u8], version: &str) -> Result<()> {
        let cache_dir = Self::cache_dir()?;
        std::fs::create_dir_all(&cache_dir)
            .with_context(|| format!("failed to create update cache directory {}", cache_dir.display()))?;

        let bin_path = cache_dir.join("pending_update.bin");
        std::fs::write(&bin_path, bytes)
            .with_context(|| format!("failed to write update cache {}", bin_path.display()))?;

        let meta = UpdateCacheMeta {
            version: version.to_string(),
            downloaded_at: Utc::now().to_rfc3339(),
        };
        let meta_path = cache_dir.join("pending_update.json");
        std::fs::write(&meta_path, serde_json::to_string_pretty(&meta)?)
            .with_context(|| format!("failed to write update metadata {}", meta_path.display()))?;

        logging!(
            info,
            Type::System,
            "Update cache written: version={}, size={} bytes",
            version,
            bytes.len()
        );
        Ok(())
    }

    fn read_cache_bytes() -> Result<Vec<u8>> {
        let bin_path = Self::cache_dir()?.join("pending_update.bin");
        std::fs::read(&bin_path).with_context(|| format!("failed to read update cache {}", bin_path.display()))
    }

    fn read_cache_meta() -> Result<UpdateCacheMeta> {
        let meta_path = Self::cache_dir()?.join("pending_update.json");
        let content = std::fs::read_to_string(meta_path)?;
        Ok(serde_json::from_str(&content)?)
    }

    fn delete_cache() {
        if let Ok(cache_dir) = Self::cache_dir()
            && cache_dir.exists()
        {
            if let Err(e) = std::fs::remove_dir_all(&cache_dir) {
                logging!(
                    warn,
                    Type::System,
                    "Failed to delete update cache {}: {e}",
                    cache_dir.display()
                );
            } else {
                logging!(info, Type::System, "Update cache deleted");
            }
        }
    }

    /// Returns the cached installer for `update`, deleting a cache that does not match it.
    fn verified_cache(update: &Update) -> Option<Vec<u8>> {
        let meta = Self::read_cache_meta().ok()?;
        let bytes = if meta.version == update.version {
            Self::read_cache_bytes().and_then(|bytes| {
                update.verify(&bytes)?;
                Ok(bytes)
            })
        } else {
            Err(anyhow::anyhow!("server offers v{}", update.version))
        };
        match bytes {
            Ok(bytes) => Some(bytes),
            Err(e) => {
                logging!(
                    info,
                    Type::System,
                    "Update cache v{} is unusable: {e:#}, cleaning up",
                    meta.version
                );
                Self::delete_cache();
                None
            }
        }
    }
}

pub fn is_build_to_stable(current: &str, remote: &str) -> bool {
    let Some((base, build)) = current.trim_start_matches('v').split_once('+') else {
        return false;
    };
    !build.is_empty() && !base.contains('-') && base == remote.trim_start_matches('v')
}

/// Maps UI language to one of the three NSIS translations, defaulting to English.
#[cfg(target_os = "windows")]
fn nsis_language_id(app_language: &str) -> &'static str {
    match app_language {
        "zh" | "zhtw" => "2052", // SimpChinese
        "ru" => "1049",          // Russian
        _ => "1033",             // English
    }
}

/// Same wire shape as the updater plugin's JS `DownloadEvent`, plus `Installing` when the
/// install starts.
#[derive(Clone, Serialize, specta::Type)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
    Installing,
}

const MIRRORS: [&str; 2] = ["https://update.hwdns.net/", "https://gh-proxy.org/"];
/// A source delivering less than this per window is dropped for the next one.
const MIN_PROGRESS: u64 = 1024 * 1024;
const PROGRESS_WINDOW: Duration = Duration::from_secs(30);
#[cfg(target_os = "windows")]
const INSTALL_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(not(target_os = "windows"))]
const INSTALL_TIMEOUT: Duration = Duration::from_secs(120);

/// The manifest's URL, then the other mirror, then GitHub itself.
fn download_sources(url: &tauri::Url) -> Vec<tauri::Url> {
    let origin = MIRRORS
        .iter()
        .find_map(|mirror| url.as_str().strip_prefix(mirror))
        .unwrap_or(url.as_str());
    let mut sources = vec![url.clone()];
    if origin.starts_with("https://github.com/") {
        let candidates = MIRRORS.iter().map(|mirror| format!("{mirror}{origin}"));
        for candidate in candidates.chain([origin.to_owned()]) {
            if let Ok(candidate) = tauri::Url::parse(&candidate)
                && !sources.contains(&candidate)
            {
                sources.push(candidate);
            }
        }
    }
    sources
}

/// Tries every source with a throughput floor, then again stopping only on a stall, so a link
/// that is slow everywhere still finishes.
async fn download(update: &Update, on_event: impl Fn(DownloadEvent) + Sync) -> Result<Vec<u8>> {
    let sources = download_sources(&update.download_url);
    let mut last_error = None;
    for floor in [MIN_PROGRESS, 1] {
        for url in &sources {
            logging!(info, Type::System, "Downloading update v{} from {url}", update.version);
            match download_from(update, url, floor, &on_event).await {
                Ok(bytes) => {
                    on_event(DownloadEvent::Finished);
                    return Ok(bytes);
                }
                Err(e) => {
                    logging!(warn, Type::System, "Update download from {url} failed: {e:#}");
                    last_error = Some(e);
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("no update download source")))
}

async fn download_from(
    update: &Update,
    url: &tauri::Url,
    floor: u64,
    on_event: &(impl Fn(DownloadEvent) + Sync),
) -> Result<Vec<u8>> {
    let mut source = update.clone();
    source.download_url = url.clone();
    let received = AtomicU64::new(0);
    let mut started = false;
    let fetch = source.download(
        |chunk_length, content_length| {
            if !std::mem::replace(&mut started, true) {
                on_event(DownloadEvent::Started { content_length });
            }
            received.fetch_add(chunk_length as u64, Ordering::Relaxed);
            on_event(DownloadEvent::Progress { chunk_length });
        },
        || {},
    );
    tokio::pin!(fetch);
    let mut seen = 0;
    loop {
        tokio::select! {
            result = &mut fetch => return Ok(result?),
            () = tokio::time::sleep(PROGRESS_WINDOW) => {
                let total = received.load(Ordering::Relaxed);
                anyhow::ensure!(total - seen >= floor, "only {} bytes in {PROGRESS_WINDOW:?}", total - seen);
                seen = total;
            }
        }
    }
}

impl SilentUpdater {
    /// Checks the server; Windows receives `/LANG` to suppress the NSIS language dialog,
    /// see `packages/windows/installer.nsi`.
    async fn check(app_handle: &tauri::AppHandle) -> Result<Option<Update>> {
        let updater_builder = app_handle.updater_builder();
        #[cfg(target_os = "windows")]
        let updater_builder = {
            let verge_lang = Config::verge().await.latest_arc().language.clone();
            let lang_id = nsis_language_id(&clash_verge_i18n::current_language(verge_lang.as_deref()));
            updater_builder.installer_arg(format!("/LANG={lang_id}"))
        };
        Ok(updater_builder.build()?.check().await?)
    }

    /// Installs verified bytes, dropping the cache first so a failure leaves nothing to
    /// re-trigger. A timeout abandons the await, not the detached install task; a successful
    /// Windows install exits the process inside the plugin (#2558).
    async fn install(update: Update, bytes: Vec<u8>) -> Result<()> {
        Self::delete_cache();
        let install = tokio::task::spawn_blocking(move || update.install(&bytes));
        match tokio::time::timeout(INSTALL_TIMEOUT, install).await {
            Ok(result) => Ok(result??),
            Err(_) => Err(anyhow::anyhow!(
                "install timed out after {INSTALL_TIMEOUT:?}; it may still finish in the background"
            )),
        }
    }

    /// Installs `version` for the update dialog, reusing the cache when it holds that version;
    /// A changed offer must be confirmed again before downloading or installing it.
    pub async fn install_update(
        &self,
        app_handle: &tauri::AppHandle,
        version: &str,
        on_event: impl Fn(DownloadEvent) + Sync,
    ) -> Result<InstallUpdateOutcome> {
        let cancel = CancellationToken::new();
        *self.manual_cancel.lock() = Some(cancel.clone());
        let prepared = tokio::select! {
            prepared = Self::prepare_install(app_handle, version, &on_event) => Some(prepared),
            () = cancel.cancelled() => None,
        };
        // `cancel_download` cancels under the lock, so once the token is taken back its state is
        // final; a cancel during the last synchronous poll of `prepare_install` still wins.
        self.manual_cancel.lock().take();
        let Some(prepared) = prepared.filter(|_| !cancel.is_cancelled()).transpose()? else {
            logging!(info, Type::System, "Update v{version} cancelled");
            return Ok(InstallUpdateOutcome::Cancelled);
        };
        let Some((update, bytes)) = prepared else {
            return Ok(InstallUpdateOutcome::UpdateChanged);
        };

        logging!(info, Type::System, "Installing update v{version}...");
        on_event(DownloadEvent::Installing);
        Self::install(update, bytes).await?;
        Ok(InstallUpdateOutcome::Installed)
    }

    async fn prepare_install(
        app_handle: &tauri::AppHandle,
        version: &str,
        on_event: &(impl Fn(DownloadEvent) + Sync),
    ) -> Result<Option<(Update, Vec<u8>)>> {
        let Some(update) = Self::check(app_handle)
            .await?
            .filter(|update| update.version == version)
        else {
            return Ok(None);
        };
        let bytes = match Self::verified_cache(&update) {
            Some(bytes) => bytes,
            None => download(&update, on_event).await?,
        };
        Ok(Some((update, bytes)))
    }

    pub fn cancel_download(&self) {
        let mut slot = self.manual_cancel.lock();
        if let Some(cancel) = slot.take() {
            cancel.cancel();
        }
    }

    /// Drops the downloaded update and aborts a background download in flight.
    pub fn discard_pending(&self) {
        let cancel = self.background_cancel.lock().take();
        if let Some(cancel) = cancel {
            cancel.cancel();
        }
        self.update_ready.store(false, Ordering::Release);
        Self::delete_cache();
    }
}

impl SilentUpdater {
    async fn check_and_download(&self, app_handle: &tauri::AppHandle) -> Result<()> {
        // Registered before reading the switch, so `discard_pending` either cancels it or ran first.
        let cancel = CancellationToken::new();
        *self.background_cancel.lock() = Some(cancel.clone());
        let auto_check = Config::verge().await.latest_arc().auto_check_update.unwrap_or(true);
        if !auto_check {
            logging!(debug, Type::System, "Silent update skipped: auto_check_update is false");
            return Ok(());
        }

        if self.is_update_ready() {
            logging!(debug, Type::System, "Silent update skipped: update already pending");
            return Ok(());
        }

        logging!(info, Type::System, "Silent updater: checking for updates...");

        let updater = app_handle.updater()?;
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => {
                logging!(info, Type::System, "Silent updater: no update available");
                return Ok(());
            }
            Err(e) => {
                logging!(warn, Type::System, "Silent updater: check failed: {e}");
                return Err(e.into());
            }
        };

        let version = update.version.as_str();
        logging!(info, Type::System, "Silent updater: update available: v{version}");

        if Self::verified_cache(&update).is_some() {
            logging!(info, Type::System, "Silent updater: v{version} already cached");
        } else {
            logging!(info, Type::System, "Silent updater: downloading v{version}...");
            let downloaded = tokio::select! {
                bytes = download(&update, |_| {}) => Some(bytes),
                () = cancel.cancelled() => None,
            };
            let Some(bytes) = downloaded else {
                logging!(info, Type::System, "Silent updater: download cancelled");
                return Ok(());
            };
            let bytes = bytes?;
            logging!(info, Type::System, "Silent updater: download complete");
            Self::write_cache(&bytes, version)?;
        }

        // Serialized with `discard_pending` in the verge patch, which holds the same lock.
        let _config_write = Config::lock_config_write().await;
        if cancel.is_cancelled() || !Config::verge().await.latest_arc().auto_check_update.unwrap_or(true) {
            logging!(
                info,
                Type::System,
                "Silent updater: auto check was disabled, discarding v{version}"
            );
            Self::delete_cache();
            return Ok(());
        }

        self.update_ready.store(true, Ordering::Release);

        logging!(
            info,
            Type::System,
            "Silent updater: v{version} ready for startup install on next launch"
        );
        Ok(())
    }

    pub async fn start_background_check(&self, app_handle: tauri::AppHandle) {
        // Permanent watcher: daily update cycles for the lifetime of the app.
        logging!(info, Type::System, "Silent updater: background task started");

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;

        loop {
            if let Err(e) = self.check_and_download(&app_handle).await {
                logging!(warn, Type::System, "Silent updater: cycle error: {e}");
            }

            tokio::time::sleep(std::time::Duration::from_secs(24 * 60 * 60)).await;
        }
    }
}
