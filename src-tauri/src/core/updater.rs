use crate::{config::Config, utils::dirs};
use anyhow::{Context as _, Result};
use clash_verge_logging::{Type, logging};
use futures::FutureExt as _;
use serde::Serialize;
use std::{
    panic::AssertUnwindSafe,
    path::PathBuf,
    sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri_plugin_updater::{Update, UpdaterExt as _};
use tokio::sync::{mpsc, oneshot};

/// App-global handle to the updater actor, the single task that runs every updater operation.
pub struct SilentUpdater {
    tx: mpsc::Sender<Cmd>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum InstallUpdateOutcome {
    Installed,
    Cancelled,
    UpdateChanged,
}

static UPDATER: OnceLock<SilentUpdater> = OnceLock::new();

enum Cmd {
    Install {
        version: String,
        on_event: Box<dyn Fn(DownloadEvent) + Send + Sync>,
        reply: oneshot::Sender<Result<InstallUpdateOutcome>>,
    },
    Cancel,
    Discard {
        reply: oneshot::Sender<()>,
    },
}

/// What wakes the idle actor.
enum Wake {
    Cmd(Cmd),
    DailyCheck,
}

/// How a background cycle ended: `Displaced` carries the command that dropped it.
enum CycleEnd {
    Completed(Result<()>),
    Displaced(Cmd),
}

/// `Dropped`'s ack is present when a discard is waiting for the cache deletion.
enum Prepared {
    /// The verified bytes with their update record, or `None` when the offer changed.
    Ready(Option<Box<(Update, Vec<u8>)>>),
    Failed(anyhow::Error),
    Dropped {
        ack: Option<oneshot::Sender<()>>,
    },
}

impl SilentUpdater {
    /// Spawns the updater actor and installs the app-global handle.
    pub fn start(app_handle: tauri::AppHandle) -> &'static Self {
        UPDATER.get_or_init(|| {
            let (tx, rx) = mpsc::channel(16);
            tokio::spawn(Self::run(app_handle, rx));
            Self { tx }
        })
    }

    /// `None` only before `start`, which setup runs before any command can arrive.
    pub fn global() -> Option<&'static Self> {
        UPDATER.get()
    }
}

impl SilentUpdater {
    fn cache_dir() -> Result<PathBuf> {
        Ok(dirs::app_home_dir()?.join("update_cache"))
    }

    /// Writes the payload through a temp file so a crash leaves no partial `pending_update.bin`;
    /// installer-sized IO stays off the async runtime. Only the detachable blocking task writes
    /// the temp file — the rename that publishes the cache runs after its await, so a command
    /// preempting this future cannot leave a published cache behind the preemption.
    async fn write_cache(bytes: Vec<u8>, version: &str) -> Result<()> {
        let cache_dir = Self::cache_dir()?;
        let size = bytes.len();
        let bin_path = cache_dir.join("pending_update.bin");
        let tmp_path = cache_dir.join("pending_update.bin.tmp");
        let write_tmp = {
            let cache_dir = cache_dir.clone();
            let tmp_path = tmp_path.clone();
            move || -> Result<()> {
                std::fs::create_dir_all(&cache_dir)
                    .with_context(|| format!("failed to create update cache directory {}", cache_dir.display()))?;
                std::fs::write(&tmp_path, &bytes)
                    .with_context(|| format!("failed to write update cache {}", tmp_path.display()))?;
                Ok(())
            }
        };
        tokio::task::spawn_blocking(write_tmp).await??;
        // Metadata-sized, so inline on the actor thread rather than a detachable task.
        std::fs::rename(&tmp_path, &bin_path)
            .with_context(|| format!("failed to rename update cache {}", bin_path.display()))?;
        logging!(
            info,
            Type::System,
            "Update cache written: version={version}, size={size} bytes"
        );
        Ok(())
    }

    async fn read_cache_bytes() -> Result<Vec<u8>> {
        let bin_path = Self::cache_dir()?.join("pending_update.bin");
        tokio::task::spawn_blocking(move || {
            std::fs::read(&bin_path).with_context(|| format!("failed to read update cache {}", bin_path.display()))
        })
        .await?
    }

    /// Invalidates the cache by renaming it out of the way, then removes the renamed directory
    /// in a detached task: the awaited part is metadata-sized — bar clearing residue left by a
    /// crashed detached removal — so a discard ack is never owed for the bulk unlink while the
    /// config write lock is held.
    async fn delete_cache() {
        if let Ok(cache_dir) = Self::cache_dir()
            && cache_dir.exists()
        {
            let discarding = cache_dir.with_file_name("update_cache_discarding");
            let display = cache_dir.display().to_string();
            let invalidate = {
                let discarding = discarding.clone();
                move || -> std::io::Result<()> {
                    // Best-effort: the rename is the invalidation, and a failed residue clear
                    // surfaces as the rename's own error.
                    if discarding.exists()
                        && let Err(e) = std::fs::remove_dir_all(&discarding)
                    {
                        logging!(warn, Type::System, "Failed to clear update cache discard residue: {e}");
                    }
                    std::fs::rename(&cache_dir, &discarding)
                }
            };
            match tokio::task::spawn_blocking(invalidate).await {
                Ok(Ok(())) => {
                    logging!(info, Type::System, "Update cache deleted");
                    // Nothing reads the discarding name, so the bulk unlink may detach.
                    tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&discarding));
                }
                Ok(Err(e)) => logging!(warn, Type::System, "Failed to delete update cache {display}: {e}"),
                Err(e) => logging!(warn, Type::System, "Failed to delete update cache {display}: {e}"),
            }
        }
    }

    /// Returns the cached installer for `update`, deleting a cache that does not verify. The
    /// plugin's `verify` binds the bytes to the signed release version, so a cache left by an
    /// earlier offer is rejected the same way as a corrupted one.
    async fn verified_cache(update: &Update) -> Option<Vec<u8>> {
        // A quiet miss for the common no-cache case; only a present-but-bad cache logs.
        let Ok(bin_path) = Self::cache_dir().map(|dir| dir.join("pending_update.bin")) else {
            return None;
        };
        if !bin_path.exists() {
            return None;
        }
        let bytes = Self::read_cache_bytes().await.and_then(|bytes| {
            update.verify(&bytes)?;
            Ok(bytes)
        });
        match bytes {
            Ok(bytes) => Some(bytes),
            Err(e) => {
                logging!(info, Type::System, "Update cache is unusable: {e:#}, cleaning up");
                Self::delete_cache().await;
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
/// How long the actor waits after a panic before re-arming the daily check.
const PANIC_BACKOFF: Duration = Duration::from_secs(600);
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
        Self::delete_cache().await;
        let install = tokio::task::spawn_blocking(move || update.install(&bytes));
        match tokio::time::timeout(INSTALL_TIMEOUT, install).await {
            Ok(result) => Ok(result??),
            Err(_) => Err(anyhow::anyhow!(
                "install timed out after {INSTALL_TIMEOUT:?}; it may still finish in the background"
            )),
        }
    }
}

impl SilentUpdater {
    /// Installs `version` for the update dialog, reusing the cache when it holds that version;
    /// A changed offer must be confirmed again before downloading or installing it.
    pub async fn install_update(
        &self,
        // The actor owns the app handle; the parameter keeps the command's call shape.
        _app_handle: &tauri::AppHandle,
        version: &str,
        on_event: impl Fn(DownloadEvent) + Send + Sync + 'static,
    ) -> Result<InstallUpdateOutcome> {
        let (reply, reply_rx) = oneshot::channel();
        self.tx
            .send(Cmd::Install {
                version: version.to_owned(),
                on_event: Box::new(on_event),
                reply,
            })
            .await
            .map_err(|_| anyhow::anyhow!("updater stopped"))?;
        reply_rx
            .await
            .unwrap_or_else(|_| Err(anyhow::anyhow!("updater stopped")))
    }

    pub fn cancel_download(&self) {
        // try_send: a cancel must never block, and the mailbox never fills in practice.
        let _ = self.tx.try_send(Cmd::Cancel);
    }

    /// Drops the downloaded update and aborts a background download in flight.
    pub async fn discard_pending(&self) {
        // Awaiting the ack serializes with the verge patch, which holds the config write
        // lock until the actor has finished the abort and the deletion.
        let (reply, reply_rx) = oneshot::channel();
        if self.tx.send(Cmd::Discard { reply }).await.is_ok() {
            let _ = reply_rx.await;
        }
    }
}

impl SilentUpdater {
    /// The actor's supervisor: one `serve` epoch at a time. A panic drops the epoch — its
    /// in-flight work and any reply it still owed — but not the mailbox, so the actor restarts
    /// instead of leaving updating dead for the rest of the process.
    async fn run(app_handle: tauri::AppHandle, mut rx: mpsc::Receiver<Cmd>) {
        logging!(info, Type::System, "Silent updater: background task started");

        let mut next_check = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            match AssertUnwindSafe(Self::serve(&app_handle, &mut rx, &mut next_check))
                .catch_unwind()
                .await
            {
                // The mailbox closed; the handle holds the only sender, so this is shutdown.
                Ok(()) => return,
                Err(_) => {
                    // The global panic hook logged the payload; this marks the recovery. The
                    // epoch future is dropped during the unwind, ending its borrows, so the
                    // mailbox and the check schedule below are intact.
                    logging!(error, Type::System, "Silent updater: actor panicked, restarting");
                    // Back the daily check off so a persistently panicking path cannot hot-loop.
                    next_check = next_check.max(tokio::time::Instant::now() + PANIC_BACKOFF);
                }
            }
        }
    }

    /// The actor loop: idle until a command or the daily check, then run the work. Commands
    /// preempt running work; a preempting command re-enters the dispatch after the preempted
    /// work is dropped.
    async fn serve(app_handle: &tauri::AppHandle, rx: &mut mpsc::Receiver<Cmd>, next_check: &mut tokio::time::Instant) {
        loop {
            let mut wake = tokio::select! {
                maybe = rx.recv() => match maybe {
                    Some(cmd) => Wake::Cmd(cmd),
                    None => return,
                },
                _ = tokio::time::sleep_until(*next_check) => Wake::DailyCheck,
            };
            loop {
                match wake {
                    Wake::Cmd(Cmd::Install {
                        version,
                        on_event,
                        reply,
                    }) => {
                        Self::run_install(app_handle, &version, on_event, reply, rx).await;
                        break;
                    }
                    // The dialog's cancel only addresses a running install; idle it stops nothing.
                    Wake::Cmd(Cmd::Cancel) => break,
                    Wake::Cmd(Cmd::Discard { reply }) => {
                        Self::run_discard(reply).await;
                        break;
                    }
                    Wake::DailyCheck => {
                        let end = Self::run_background_cycle(app_handle, rx).await;
                        *next_check = tokio::time::Instant::now() + Duration::from_secs(24 * 60 * 60);
                        match end {
                            CycleEnd::Completed(Ok(())) => break,
                            CycleEnd::Completed(Err(e)) => {
                                logging!(warn, Type::System, "Silent updater: cycle error: {e}");
                                break;
                            }
                            CycleEnd::Displaced(cmd) => wake = Wake::Cmd(cmd),
                        }
                    }
                }
            }
        }
    }

    /// Runs one daily cycle, pre-empted by user commands: a cancel is ignored; an install
    /// or a discard drops the cycle, and the cycle future is gone before the follow-up
    /// dispatch runs.
    async fn run_background_cycle(app_handle: &tauri::AppHandle, rx: &mut mpsc::Receiver<Cmd>) -> CycleEnd {
        let cycle = Self::check_and_download(app_handle);
        tokio::pin!(cycle);
        let mut mailbox_open = true;
        loop {
            let maybe = tokio::select! {
                biased;
                maybe = rx.recv(), if mailbox_open => maybe,
                result = &mut cycle => return CycleEnd::Completed(result),
            };
            let Some(cmd) = maybe else {
                mailbox_open = false;
                continue;
            };
            match cmd {
                Cmd::Cancel => {}
                Cmd::Install { .. } => return CycleEnd::Displaced(cmd),
                Cmd::Discard { .. } => {
                    logging!(info, Type::System, "Silent updater: background cycle discarded");
                    return CycleEnd::Displaced(cmd);
                }
            }
        }
    }

    async fn check_and_download(app_handle: &tauri::AppHandle) -> Result<()> {
        let auto_check = Config::verge().await.latest_arc().auto_check_update.unwrap_or(true);
        if !auto_check {
            logging!(debug, Type::System, "Silent update skipped: auto_check_update is false");
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

        if Self::verified_cache(&update).await.is_some() {
            logging!(info, Type::System, "Silent updater: v{version} already cached");
        } else {
            logging!(info, Type::System, "Silent updater: downloading v{version}...");
            let bytes = download(&update, |_| {}).await?;
            logging!(info, Type::System, "Silent updater: download complete");
            Self::write_cache(bytes, version).await?;
        }

        // The verge patch's discard holds this lock while awaiting the actor's ack, so a
        // discard arriving during this wait preempts the cycle rather than deadlock on it.
        let discard = {
            let _config_write = Config::lock_config_write().await;
            !Config::verge().await.latest_arc().auto_check_update.unwrap_or(true)
        };
        if discard {
            logging!(
                info,
                Type::System,
                "Silent updater: auto check was disabled, discarding v{version}"
            );
            Self::delete_cache().await;
            return Ok(());
        }

        logging!(
            info,
            Type::System,
            "Silent updater: v{version} ready to install from the update dialog"
        );
        Ok(())
    }

    /// One dialog install from prepare to install; every exit path answers `reply`.
    async fn run_install(
        app_handle: &tauri::AppHandle,
        version: &str,
        on_event: Box<dyn Fn(DownloadEvent) + Send + Sync>,
        reply: oneshot::Sender<Result<InstallUpdateOutcome>>,
        rx: &mut mpsc::Receiver<Cmd>,
    ) {
        match Self::prepare_cancellable(app_handle, version, on_event.as_ref(), rx).await {
            // The prepare work is already dropped, so a cancel racing the last poll still wins.
            Prepared::Dropped { ack } => {
                logging!(info, Type::System, "Update v{version} cancelled");
                let _ = reply.send(Ok(InstallUpdateOutcome::Cancelled));
                if let Some(ack) = ack {
                    Self::delete_cache().await;
                    let _ = ack.send(());
                }
            }
            Prepared::Failed(e) => {
                let _ = reply.send(Err(e));
            }
            Prepared::Ready(None) => {
                let _ = reply.send(Ok(InstallUpdateOutcome::UpdateChanged));
            }
            Prepared::Ready(Some(pair)) => {
                let (update, bytes) = *pair;
                logging!(info, Type::System, "Installing update v{version}...");
                on_event(DownloadEvent::Installing);
                let result = Self::finish_install(update, bytes, rx).await;
                let _ = reply.send(result.map(|_| InstallUpdateOutcome::Installed));
            }
        }
    }

    /// The cancellable prepare phase: check, version filter, cache reuse or download. A
    /// second install is declined in place; a cancel or a discard drops the work.
    async fn prepare_cancellable(
        app_handle: &tauri::AppHandle,
        version: &str,
        on_event: &(impl Fn(DownloadEvent) + Sync + ?Sized),
        rx: &mut mpsc::Receiver<Cmd>,
    ) -> Prepared {
        let prepare = Self::prepare_install(app_handle, version, on_event);
        tokio::pin!(prepare);
        let mut mailbox_open = true;
        loop {
            let maybe = tokio::select! {
                biased;
                maybe = rx.recv(), if mailbox_open => maybe,
                prepared = &mut prepare => return match prepared {
                    Ok(prepared) => Prepared::Ready(prepared.map(Box::new)),
                    Err(e) => Prepared::Failed(e),
                },
            };
            let Some(cmd) = maybe else {
                mailbox_open = false;
                continue;
            };
            match cmd {
                Cmd::Cancel => return Prepared::Dropped { ack: None },
                Cmd::Discard { reply: ack } => return Prepared::Dropped { ack: Some(ack) },
                Cmd::Install { reply, .. } => Self::decline_install(reply),
            }
        }
    }

    async fn prepare_install(
        app_handle: &tauri::AppHandle,
        version: &str,
        on_event: &(impl Fn(DownloadEvent) + Sync + ?Sized),
    ) -> Result<Option<(Update, Vec<u8>)>> {
        let Some(update) = Self::check(app_handle)
            .await?
            .filter(|update| update.version == version)
        else {
            return Ok(None);
        };
        let bytes = match Self::verified_cache(&update).await {
            Some(bytes) => bytes,
            None => download(&update, on_event).await?,
        };
        Ok(Some((update, bytes)))
    }

    /// The install phase: once `install()` started it cannot be cancelled (the installer may
    /// already run); the mailbox still gets answers while it finishes.
    async fn finish_install(update: Update, bytes: Vec<u8>, rx: &mut mpsc::Receiver<Cmd>) -> Result<()> {
        let install = Self::install(update, bytes);
        tokio::pin!(install);
        let mut mailbox_open = true;
        loop {
            let maybe = tokio::select! {
                result = &mut install => return result,
                maybe = rx.recv(), if mailbox_open => maybe,
            };
            let Some(cmd) = maybe else {
                mailbox_open = false;
                continue;
            };
            match cmd {
                Cmd::Cancel => {}
                Cmd::Install { reply, .. } => Self::decline_install(reply),
                Cmd::Discard { reply } => {
                    // install() drops the cache before launching, so the ack is all that is owed.
                    let _ = reply.send(());
                }
            }
        }
    }

    fn decline_install(reply: oneshot::Sender<Result<InstallUpdateOutcome>>) {
        let _ = reply.send(Err(anyhow::anyhow!("an update install is already in progress")));
    }

    async fn run_discard(reply: oneshot::Sender<()>) {
        Self::delete_cache().await;
        let _ = reply.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::is_build_to_stable;

    #[test]
    fn is_build_to_stable_matches_build_metadata_to_the_same_base() {
        assert!(is_build_to_stable("2.4.3+5", "2.4.3"));
        assert!(!is_build_to_stable("2.4.3+5", "2.4.4"));
        assert!(!is_build_to_stable("2.4.3", "2.4.3"));
        assert!(!is_build_to_stable("2.4.3-beta+5", "2.4.3"));
    }
}
