use anyhow::Result;
use clash_verge_logging::{Type, logging};
use futures::FutureExt as _;
use serde::Serialize;
use std::{
    panic::AssertUnwindSafe,
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
}

/// How a dialog install's prepare phase ended.
enum Prepared {
    /// The update record with its verified bytes, or `None` when the offer changed.
    Ready(Option<Box<(Update, Vec<u8>)>>),
    Failed(anyhow::Error),
    /// Preempted by a cancel; the work future is already dropped.
    Dropped,
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
            let verge_lang = crate::config::Config::verge().await.latest_arc().language.clone();
            let lang_id = nsis_language_id(&clash_verge_i18n::current_language(verge_lang.as_deref()));
            updater_builder.installer_arg(format!("/LANG={lang_id}"))
        };
        Ok(updater_builder.build()?.check().await?)
    }

    /// Installs verified bytes. A timeout abandons the await, not the detached install task;
    /// a successful Windows install exits the process inside the plugin (#2558).
    async fn install(update: Update, bytes: Vec<u8>) -> Result<()> {
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
    /// Installs `version` for the update dialog; a changed offer must be confirmed again
    /// before downloading or installing it.
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
}

impl SilentUpdater {
    /// The actor's supervisor: one `serve` epoch at a time. A panic drops the epoch — its
    /// in-flight work and any reply it still owed — but not the mailbox, so the actor restarts
    /// instead of leaving updating dead for the rest of the process.
    async fn run(app_handle: tauri::AppHandle, mut rx: mpsc::Receiver<Cmd>) {
        logging!(info, Type::System, "Silent updater: background task started");

        loop {
            match AssertUnwindSafe(Self::serve(&app_handle, &mut rx)).catch_unwind().await {
                // The mailbox closed; the handle holds the only sender, so this is shutdown.
                Ok(()) => return,
                Err(_) => {
                    // The global panic hook logged the payload; this marks the recovery. The
                    // epoch future is dropped during the unwind, ending its borrows, so the
                    // mailbox below is intact.
                    logging!(error, Type::System, "Silent updater: actor panicked, restarting");
                }
            }
        }
    }

    /// The actor loop: idle until a command, then run the work. A cancel during the
    /// cancellable phases drops the work future; a second install is declined in place.
    async fn serve(app_handle: &tauri::AppHandle, rx: &mut mpsc::Receiver<Cmd>) {
        while let Some(cmd) = rx.recv().await {
            match cmd {
                Cmd::Install {
                    version,
                    on_event,
                    reply,
                } => {
                    Self::run_install(app_handle, &version, on_event, reply, rx).await;
                }
                // The dialog's cancel only addresses a running install; idle it stops nothing.
                Cmd::Cancel => {}
            }
        }
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
            Prepared::Dropped => {
                logging!(info, Type::System, "Update v{version} cancelled");
                let _ = reply.send(Ok(InstallUpdateOutcome::Cancelled));
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

    /// The cancellable prepare phase: check, version filter, download. A second install is
    /// declined in place; a cancel drops the work.
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
                Cmd::Cancel => return Prepared::Dropped,
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
        let bytes = download(&update, on_event).await?;
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
            }
        }
    }

    fn decline_install(reply: oneshot::Sender<Result<InstallUpdateOutcome>>) {
        let _ = reply.send(Err(anyhow::anyhow!("an update install is already in progress")));
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
