use super::CmdResult;
use crate::cmd::StringifyErr as _;
use crate::config::Config;

use once_cell::sync::Lazy;
use tauri::ipc::Channel;
use tauri_plugin_updater::UpdaterExt as _;
use tokio::sync::watch;
use url::Url;

// Cancellation signal for the manual-update download.
//
// A single global channel is sufficient because only one manual update can be
// in flight at a time (the update dialog). `download_and_install_update`
// resets it to `false` before each run so a stale cancel from a previous run
// can't abort the next one.
static UPDATE_DOWNLOAD_CANCEL: Lazy<watch::Sender<bool>> =
    Lazy::new(|| watch::channel(false).0);

/// Progress events streamed from [`download_and_install_update`] to the UI.
///
/// Mirrors `@tauri-apps/plugin-updater`'s `DownloadEvent` shape so the existing
/// frontend progress callback can be reused unchanged.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

/// Download and install the latest update, streaming progress to `on_event`.
///
/// When `use_app_proxy` is true, the download is routed through the app's own
/// mihomo proxy (mixed-port) instead of the system proxy. This is useful when
/// the system proxy can't reach the update server but the app's proxy nodes
/// can, e.g. when the system proxy is off or points at a different upstream.
///
/// Unlike `plugin:updater|download_and_install`, the download runs inside
/// `tokio::select!` so [`cancel_update_download`] can abort it mid-stream:
/// dropping the `download` future drops the underlying reqwest response stream,
/// which closes the HTTP connection and truly stops the download, instead of
/// just dismissing the dialog and letting it finish in the background.
#[tauri::command]
pub async fn download_and_install_update<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    use_app_proxy: Option<bool>,
    on_event: Channel<UpdateDownloadEvent>,
) -> CmdResult<()> {
    // Reset any stale cancel request from a previous run, then subscribe.
    let _ = UPDATE_DOWNLOAD_CANCEL.send(false);
    let mut cancel_rx = UPDATE_DOWNLOAD_CANCEL.subscribe();

    let mut builder = webview.updater_builder();
    if use_app_proxy.unwrap_or(false) {
        // Route through the app's mihomo proxy instead of the system proxy.
        //
        // `UpdaterBuilder::proxy` internally builds `reqwest::Proxy::all`, which
        // matches every URL scheme. reqwest still loads `HTTP_PROXY`/
        // `HTTPS_PROXY` from the environment by default, but appends them
        // *after* this proxy; reqwest selects the first matching proxy for a
        // request, so the app proxy always wins and the system proxy is never
        // used. Setting `.proxy()` alone is therefore sufficient to both use
        // the app proxy and bypass the system proxy.
        let mixed_port = Config::clash().await.latest_arc().get_mixed_port();
        let proxy_url = Url::parse(&format!("http://127.0.0.1:{mixed_port}"))
            .map_err(|e| e.to_string())?;
        builder = builder.proxy(proxy_url);
    }
    let updater = builder.build().stringify_err()?;
    let update = updater
        .check()
        .await
        .stringify_err()?
        .ok_or("No update available")?;

    // Download on a separate clone so the `download` future's `&Update` borrow
    // is isolated from the `&Update` the original holds for `install` after the
    // select completes. The clone is bound to a `let` instead of written inline
    // as `update.clone().download(...)`: a temporary would be dropped at the end
    // of the statement while the download future still borrows it (E0716).
    let update_clone = update.clone();
    let mut first_chunk = true;
    let bytes = tokio::select! {
        biased;
        _ = cancel_rx.wait_for(|&cancelled| cancelled) => {
            return Err("Update download cancelled".into());
        }
        result = update_clone.download(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(UpdateDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(UpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(UpdateDownloadEvent::Finished);
            },
        ) => result.stringify_err()?,
    };

    update.install(&bytes).stringify_err()?;
    Ok(())
}

/// Abort an in-flight [`download_and_install_update`].
#[tauri::command]
pub fn cancel_update_download() {
    let _ = UPDATE_DOWNLOAD_CANCEL.send(true);
}
