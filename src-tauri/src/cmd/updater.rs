use crate::{
    cmd::{CmdResult, StringifyErr as _},
    core::{handle::Handle, updater::verge_updater},
};

#[derive(Debug, serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn check_update() -> CmdResult<Option<UpdateInfo>> {
    let app_handle = Handle::app_handle();
    match verge_updater(app_handle)
        .await
        .stringify_err()?
        .check()
        .await
        .stringify_err()?
    {
        Some(update) => Ok(Some(UpdateInfo {
            version: update.version,
            body: update.body,
            raw_json: update.raw_json,
        })),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    on_chunk: tauri::ipc::Channel<(usize, Option<u64>)>,
    on_download_finish: tauri::ipc::Channel<()>,
) -> CmdResult {
    let app_handle = Handle::app_handle();
    match verge_updater(app_handle)
        .await
        .stringify_err()?
        .check()
        .await
        .stringify_err()?
    {
        Some(update) => {
            update
                .download_and_install(
                    |chunk_length, content_length| {
                        let _ = on_chunk.send((chunk_length, content_length));
                    },
                    || {
                        let _ = on_download_finish.send(());
                    },
                )
                .await
                .stringify_err()?;
            Ok(())
        }
        None => Err("Update not available".into()),
    }
}
