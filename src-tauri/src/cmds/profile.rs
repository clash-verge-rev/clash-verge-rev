use crate::{
    config::{Config, DEFAULT_PAC, EnableFilter, IProfiles, PrfItem, PrfOption},
    core::{CoreManager, handle, timer},
    enhance::chain::{ChainItem, ScopeType},
    feat, ret_err,
    utils::{dirs, help, tmpl},
    wrap_err,
};

use super::CmdResult;

#[tauri::command]
pub fn get_profiles() -> CmdResult<IProfiles> {
    Ok(Config::profiles().data().clone())
}

#[tauri::command]
pub fn get_profile(uid: String) -> CmdResult<PrfItem> {
    wrap_err!(Config::profiles().data().get_item(&uid).cloned())
}

#[tauri::command]
pub fn get_chains(profile_uid: Option<String>) -> CmdResult<Vec<ChainItem>> {
    Ok(Config::profiles()
        .data()
        .get_profile_chains(profile_uid, EnableFilter::All))
}

#[tauri::command]
pub fn get_template(scope: String, language: String) -> CmdResult<String> {
    match (scope.as_str(), language.as_str()) {
        ("merge", "yaml") => Ok(tmpl::ITEM_MERGE.into()),
        ("script", "javascript") => Ok(tmpl::ITEM_SCRIPT.into()),
        ("pac", "javascript") => Ok(DEFAULT_PAC.into()),
        _ => Ok("".into()),
    }
}

#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    wrap_err!(CoreManager::global().update_config().await)?;
    handle::Handle::refresh_clash();
    Ok(())
}

#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> CmdResult {
    let item = wrap_err!(PrfItem::from_url(&url, None, None, option).await)?;
    wrap_err!(Config::profiles().data_mut().append_item(item))?;
    wrap_err!(handle::Handle::update_systray_part())
}

#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    wrap_err!(Config::profiles().data_mut().reorder(active_id, over_id))?;
    wrap_err!(handle::Handle::update_systray_part())
}

#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    let item = wrap_err!(PrfItem::from(item, file_data).await)?;
    wrap_err!(Config::profiles().data_mut().append_item(item))?;
    wrap_err!(handle::Handle::update_systray_part())
}

#[tauri::command]
pub async fn update_profile(uid: String, option: Option<PrfOption>) -> CmdResult {
    wrap_err!(feat::update_profile(&uid, option).await)?;
    wrap_err!(handle::Handle::update_systray_part())
}

#[tauri::command]
pub async fn delete_profile(uid: String) -> CmdResult {
    let restart_core = wrap_err!(Config::profiles().data_mut().delete_item(uid))?;
    // the running profile is deleted, update the core config
    if restart_core {
        wrap_err!(CoreManager::global().update_config().await)?;
        handle::Handle::refresh_clash();
    }
    wrap_err!(handle::Handle::update_systray_part())
}

/// 修改profiles的
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult {
    wrap_err!(Config::profiles().draft().patch_config(profiles))?;

    match CoreManager::global().update_config().await {
        Ok(_) => {
            handle::Handle::refresh_clash();
            let _ = handle::Handle::update_systray_part();
            Config::profiles().apply();
            wrap_err!(Config::profiles().data().save_file())?;
            Ok(())
        }
        Err(err) => {
            Config::profiles().discard();
            tracing::error!("{err}");
            Err(format!("{err}"))
        }
    }
}

/// 修改某个profile item的
#[tauri::command]
pub async fn patch_profile(uid: String, profile: PrfItem) -> CmdResult {
    let enable_changed = profile.enable.is_some();
    let name_changed = profile.name.is_some();
    wrap_err!(Config::profiles().data_mut().patch_item(&uid, profile))?;
    wrap_err!(timer::Timer::global().refresh_profiles())?;
    if enable_changed {
        // this is a chain to toggle enable
        let profiles = Config::profiles().latest().clone();
        let result_item = wrap_err!(profiles.get_item(&uid))?;
        match result_item.scope {
            Some(ScopeType::Global) => {
                wrap_err!(CoreManager::global().update_config().await)?;
                handle::Handle::refresh_clash();
            }
            Some(ScopeType::Specific) => {
                if result_item.parent.as_ref() == profiles.get_current() {
                    wrap_err!(CoreManager::global().update_config().await)?;
                    handle::Handle::refresh_clash();
                }
            }
            None => {}
        }
    }
    if name_changed {
        wrap_err!(handle::Handle::update_systray_part())?;
    }
    Ok(())
}

#[tauri::command]
pub fn view_profile(app_handle: tauri::AppHandle, index: String) -> CmdResult {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let file = wrap_err!(profiles.get_item(&index))?
        .file
        .as_ref()
        .ok_or("the file field is null")?;
    let path = wrap_err!(dirs::app_profiles_dir())?.join(file);
    if !path.exists() {
        ret_err!("profile [{}] not found", path.display());
    }
    wrap_err!(help::open_file(app_handle, path))
}

#[tauri::command]
pub fn read_profile_file(index: String) -> CmdResult<String> {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let item = wrap_err!(profiles.get_item(&index))?;
    let data = wrap_err!(item.read_file())?;
    Ok(data)
}

#[tauri::command]
pub fn save_profile_file(uid: String, file_data: Option<String>) -> CmdResult {
    if let Some(file_data) = file_data {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let item = wrap_err!(profiles.get_item(&uid))?;
        wrap_err!(item.save_file(file_data))?;
    }
    Ok(())
}
