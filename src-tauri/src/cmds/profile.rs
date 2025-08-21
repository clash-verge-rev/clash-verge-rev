use crate::{
    any_err,
    config::{Config, DEFAULT_PAC, EnableFilter, IProfiles, PrfItem, PrfOption},
    core::{CoreManager, handle, timer},
    enhance::chain::{ChainItem, ScopeType},
    error::{AppError, AppResult},
    feat,
    utils::{dirs, help, tmpl},
};

#[tauri::command]
pub fn get_profiles() -> AppResult<IProfiles> {
    Ok(Config::profiles().data().clone())
}

#[tauri::command]
pub fn get_profile(uid: String) -> AppResult<PrfItem> {
    Ok(Config::profiles()
        .data()
        .get_item(&uid)
        .ok_or(any_err!("failed to get profile [{uid}]"))?
        .clone())
}

#[tauri::command]
pub fn get_chains(profile_uid: Option<String>) -> AppResult<Vec<ChainItem>> {
    Ok(Config::profiles()
        .data()
        .get_profile_chains(profile_uid, EnableFilter::All))
}

#[tauri::command]
pub fn get_template(scope: String, language: String) -> AppResult<String> {
    match (scope.as_str(), language.as_str()) {
        ("merge", "yaml") => Ok(tmpl::ITEM_MERGE.into()),
        ("script", "javascript") => Ok(tmpl::ITEM_SCRIPT.into()),
        ("pac", "javascript") => Ok(DEFAULT_PAC.into()),
        _ => Ok("".into()),
    }
}

#[tauri::command]
pub async fn enhance_profiles() -> AppResult<()> {
    CoreManager::global().update_config().await?;
    handle::Handle::refresh_clash();
    Ok(())
}

#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> AppResult<()> {
    let item = PrfItem::from_url(&url, None, None, option).await?;
    let restart_core = Config::profiles().data_mut().append_item(item)?;
    if restart_core {
        CoreManager::global().update_config().await?;
        handle::Handle::refresh_clash();
    }
    handle::Handle::update_systray_part()
}

#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> AppResult<()> {
    Config::profiles().data_mut().reorder(active_id, over_id)?;
    handle::Handle::update_systray_part()
}

#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> AppResult<()> {
    let item = PrfItem::from(item, file_data).await?;
    let restart_core = Config::profiles().data_mut().append_item(item)?;
    if restart_core {
        CoreManager::global().update_config().await?;
        handle::Handle::refresh_clash();
    }
    handle::Handle::update_systray_part()
}

// 同步更新订阅
#[tauri::command]
pub async fn update_profile(uid: String, option: Option<PrfOption>) -> AppResult<()> {
    feat::update_profile(&uid, option).await?;
    handle::Handle::update_systray_part()
}

#[tauri::command]
pub async fn delete_profile(uid: String) -> AppResult<()> {
    let restart_core = Config::profiles().data_mut().delete_item(uid)?;
    // the running profile is deleted, update the core config
    if restart_core {
        CoreManager::global().update_config().await?;
        handle::Handle::refresh_clash();
    }
    handle::Handle::update_systray_part()
}

/// 修改整个 profiles
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> AppResult<()> {
    Config::profiles().draft().patch_config(profiles)?;

    match CoreManager::global().update_config().await {
        Ok(_) => {
            handle::Handle::refresh_clash();
            let _ = handle::Handle::update_systray_part();
            Config::profiles().apply();
            Config::profiles().data().save_file()?;
            Ok(())
        }
        Err(err) => {
            Config::profiles().discard();
            tracing::error!("{err}");
            Err(err)
        }
    }
}

/// 修改某个 profile item
#[tauri::command]
pub async fn patch_profile(uid: String, profile: PrfItem) -> AppResult<()> {
    let old = Config::profiles()
        .latest()
        .get_item(&uid)
        .ok_or(any_err!("failed to get profile [{uid}]"))?
        .clone();
    let name_changed = profile.name != old.name;
    let enable_changed = profile.enable != old.enable;
    Config::profiles().data_mut().patch_item(&uid, profile)?;
    timer::Timer::global().refresh_profiles()?;
    if enable_changed {
        // this is a chain to toggle enable
        let profiles = Config::profiles().latest().clone();
        let result_item = profiles
            .get_item(&uid)
            .ok_or(any_err!("failed to get profile [{uid}]"))?;
        match result_item.scope {
            Some(ScopeType::Global) => {
                CoreManager::global().update_config().await?;
                handle::Handle::refresh_clash();
            }
            Some(ScopeType::Specific) => {
                if result_item.parent.as_ref() == profiles.get_current() {
                    CoreManager::global().update_config().await?;
                    handle::Handle::refresh_clash();
                }
            }
            None => {}
        }
    }
    if name_changed {
        handle::Handle::update_systray_part()?;
    }
    Ok(())
}

#[tauri::command]
pub fn view_profile(app_handle: tauri::AppHandle, index: String) -> AppResult<()> {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let file = profiles
        .get_item(&index)
        .ok_or(any_err!("failed to get profile [{index}]"))?
        .file
        .as_ref()
        .ok_or(AppError::InvalidValue("the file field is null".to_string()))?;
    let path = dirs::app_profiles_dir()?.join(file);
    if !path.exists() {
        return Err(any_err!("profile [{}] not found", path.display()));
    }
    help::open_file(app_handle, path)
}

#[tauri::command]
pub fn read_profile_file(index: String) -> AppResult<String> {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let item = profiles
        .get_item(&index)
        .ok_or(any_err!("failed to get profile [{index}]"))?;
    let data = item.read_file()?;
    Ok(data)
}

#[tauri::command]
pub fn save_profile_file(uid: String, file_data: Option<String>) -> AppResult<()> {
    if let Some(file_data) = file_data {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let item = profiles
            .get_item(&uid)
            .ok_or(any_err!("failed to get profile [{uid}]"))?;
        item.save_file(file_data)?;
    }
    Ok(())
}
