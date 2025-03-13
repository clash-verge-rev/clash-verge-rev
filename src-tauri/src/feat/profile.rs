use crate::{
    cmd,
    config::{Config, PrfItem, PrfOption},
    core::{handle, CoreManager, *},
};
use anyhow::{bail, Result};

/// Toggle proxy profile
pub fn toggle_proxy_profile(profile_index: String) {
    tauri::async_runtime::spawn(async move {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        match cmd::patch_profiles_config_by_profile_index(app_handle, profile_index).await {
            Ok(_) => {
                let _ = tray::Tray::global().update_menu();
            }
            Err(err) => {
                log::error!(target: "app", "{err}");
            }
        }
    });
}

/// Update a profile
/// If updating current profile, activate it
pub async fn update_profile(uid: String, option: Option<PrfOption>) -> Result<()> {
    println!("[订阅更新] 开始更新订阅 {}", uid);

    let url_opt = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let item = profiles.get_item(&uid)?;
        let is_remote = item.itype.as_ref().is_some_and(|s| s == "remote");

        if !is_remote {
            println!("[订阅更新] {} 不是远程订阅，跳过更新", uid);
            None // 非远程订阅直接更新
        } else if item.url.is_none() {
            println!("[订阅更新] {} 缺少URL，无法更新", uid);
            bail!("failed to get the profile item url");
        } else {
            println!(
                "[订阅更新] {} 是远程订阅，URL: {}",
                uid,
                item.url.clone().unwrap()
            );
            Some((item.url.clone().unwrap(), item.option.clone()))
        }
    };

    let should_update = match url_opt {
        Some((url, opt)) => {
            println!("[订阅更新] 开始下载新的订阅内容");
            let merged_opt = PrfOption::merge(opt, option);
            let item = PrfItem::from_url(&url, None, None, merged_opt).await?;

            println!("[订阅更新] 更新订阅配置");
            let profiles = Config::profiles();
            let mut profiles = profiles.latest();
            profiles.update_item(uid.clone(), item)?;

            let is_current = Some(uid.clone()) == profiles.get_current();
            println!("[订阅更新] 是否为当前使用的订阅: {}", is_current);
            is_current
        }
        None => true,
    };

    if should_update {
        println!("[订阅更新] 更新内核配置");
        match CoreManager::global().update_config().await {
            Ok(_) => {
                println!("[订阅更新] 更新成功");
                handle::Handle::refresh_clash();
            }
            Err(err) => {
                println!("[订阅更新] 更新失败: {}", err);
                handle::Handle::notice_message("set_config::error", format!("{err}"));
                log::error!(target: "app", "{err}");
            }
        }
    }

    Ok(())
}
