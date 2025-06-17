use super::CmdResult;
use crate::{
    config::{Config, IProfiles, PrfItem, PrfOption},
    core::{handle, timer::Timer, tray::Tray, CoreManager},
    feat, logging, ret_err,
    utils::{dirs, help, logging::Type},
    wrap_err,
};
use std::time::Duration;
use tokio::sync::Mutex;

// 添加全局互斥锁防止并发配置更新
static PROFILE_UPDATE_MUTEX: Mutex<()> = Mutex::const_new(());

/// 获取配置文件避免锁竞争
#[tauri::command]
pub async fn get_profiles() -> CmdResult<IProfiles> {
    // 策略1: 尝试快速获取latest数据
    let latest_result = tokio::time::timeout(
        Duration::from_millis(500),
        tokio::task::spawn_blocking(move || {
            let profiles = Config::profiles();
            let latest = profiles.latest();
            IProfiles {
                current: latest.current.clone(),
                items: latest.items.clone(),
            }
        }),
    )
    .await;

    match latest_result {
        Ok(Ok(profiles)) => {
            logging!(info, Type::Cmd, false, "快速获取配置列表成功");
            return Ok(profiles);
        }
        Ok(Err(join_err)) => {
            logging!(warn, Type::Cmd, true, "快速获取配置任务失败: {}", join_err);
        }
        Err(_) => {
            logging!(warn, Type::Cmd, true, "快速获取配置超时(500ms)");
        }
    }

    // 策略2: 如果快速获取失败，尝试获取data()
    let data_result = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::task::spawn_blocking(move || {
            let profiles = Config::profiles();
            let data = profiles.data();
            IProfiles {
                current: data.current.clone(),
                items: data.items.clone(),
            }
        }),
    )
    .await;

    match data_result {
        Ok(Ok(profiles)) => {
            logging!(info, Type::Cmd, false, "获取draft配置列表成功");
            return Ok(profiles);
        }
        Ok(Err(join_err)) => {
            logging!(
                error,
                Type::Cmd,
                true,
                "获取draft配置任务失败: {}",
                join_err
            );
        }
        Err(_) => {
            logging!(error, Type::Cmd, true, "获取draft配置超时(2秒)");
        }
    }

    // 策略3: fallback，尝试重新创建配置
    logging!(
        warn,
        Type::Cmd,
        true,
        "所有获取配置策略都失败，尝试fallback"
    );

    match tokio::task::spawn_blocking(IProfiles::new).await {
        Ok(profiles) => {
            logging!(info, Type::Cmd, true, "使用fallback配置成功");
            Ok(profiles)
        }
        Err(err) => {
            logging!(error, Type::Cmd, true, "fallback配置也失败: {}", err);
            // 返回空配置避免崩溃
            Ok(IProfiles {
                current: None,
                items: Some(vec![]),
            })
        }
    }
}

/// 增强配置文件
#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    wrap_err!(feat::enhance_profiles().await)?;
    handle::Handle::refresh_clash();
    Ok(())
}

/// 导入配置文件
#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> CmdResult {
    let item = wrap_err!(PrfItem::from_url(&url, None, None, option).await)?;
    wrap_err!(Config::profiles().data().append_item(item))
}

/// 重新排序配置文件
#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    wrap_err!(Config::profiles().data().reorder(active_id, over_id))
}

/// 创建配置文件
#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    let item = wrap_err!(PrfItem::from(item, file_data).await)?;
    wrap_err!(Config::profiles().data().append_item(item))
}

/// 更新配置文件
#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
    wrap_err!(feat::update_profile(index, option, Some(true)).await)
}

/// 删除配置文件
#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    let should_update = wrap_err!({ Config::profiles().data().delete_item(index) })?;

    // 删除后自动清理冗余文件
    let _ = Config::profiles().latest().auto_cleanup();

    if should_update {
        wrap_err!(CoreManager::global().update_config().await)?;
        handle::Handle::refresh_clash();
    }
    Ok(())
}

/// 修改profiles的配置
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    // 获取互斥锁，防止并发执行
    let _guard = PROFILE_UPDATE_MUTEX.lock().await;

    logging!(info, Type::Cmd, true, "开始修改配置文件");

    // 保存当前配置，以便在验证失败时恢复
    let current_profile = Config::profiles().latest().current.clone();
    logging!(info, Type::Cmd, true, "当前配置: {:?}", current_profile);

    // 如果要切换配置，先检查目标配置文件是否有语法错误
    if let Some(new_profile) = profiles.current.as_ref() {
        if current_profile.as_ref() != Some(new_profile) {
            logging!(info, Type::Cmd, true, "正在切换到新配置: {}", new_profile);

            // 获取目标配置文件路径
            let config_file_result = {
                let profiles_config = Config::profiles();
                let profiles_data = profiles_config.latest();
                match profiles_data.get_item(new_profile) {
                    Ok(item) => {
                        if let Some(file) = &item.file {
                            let path = dirs::app_profiles_dir().map(|dir| dir.join(file));
                            path.ok()
                        } else {
                            None
                        }
                    }
                    Err(e) => {
                        logging!(error, Type::Cmd, true, "获取目标配置信息失败: {}", e);
                        None
                    }
                }
            };

            // 如果获取到文件路径，检查YAML语法
            if let Some(file_path) = config_file_result {
                if !file_path.exists() {
                    logging!(
                        error,
                        Type::Cmd,
                        true,
                        "目标配置文件不存在: {}",
                        file_path.display()
                    );
                    handle::Handle::notice_message(
                        "config_validate::file_not_found",
                        format!("{}", file_path.display()),
                    );
                    return Ok(false);
                }

                // 超时保护
                let file_read_result = tokio::time::timeout(
                    Duration::from_secs(5),
                    tokio::fs::read_to_string(&file_path),
                )
                .await;

                match file_read_result {
                    Ok(Ok(content)) => {
                        let yaml_parse_result = tokio::task::spawn_blocking(move || {
                            serde_yaml::from_str::<serde_yaml::Value>(&content)
                        })
                        .await;

                        match yaml_parse_result {
                            Ok(Ok(_)) => {
                                logging!(info, Type::Cmd, true, "目标配置文件语法正确");
                            }
                            Ok(Err(err)) => {
                                let error_msg = format!(" {}", err);
                                logging!(
                                    error,
                                    Type::Cmd,
                                    true,
                                    "目标配置文件存在YAML语法错误:{}",
                                    error_msg
                                );
                                handle::Handle::notice_message(
                                    "config_validate::yaml_syntax_error",
                                    &error_msg,
                                );
                                return Ok(false);
                            }
                            Err(join_err) => {
                                let error_msg = format!("YAML解析任务失败: {}", join_err);
                                logging!(error, Type::Cmd, true, "{}", error_msg);
                                handle::Handle::notice_message(
                                    "config_validate::yaml_parse_error",
                                    &error_msg,
                                );
                                return Ok(false);
                            }
                        }
                    }
                    Ok(Err(err)) => {
                        let error_msg = format!("无法读取目标配置文件: {}", err);
                        logging!(error, Type::Cmd, true, "{}", error_msg);
                        handle::Handle::notice_message(
                            "config_validate::file_read_error",
                            &error_msg,
                        );
                        return Ok(false);
                    }
                    Err(_) => {
                        let error_msg = "读取配置文件超时(5秒)".to_string();
                        logging!(error, Type::Cmd, true, "{}", error_msg);
                        handle::Handle::notice_message(
                            "config_validate::file_read_timeout",
                            &error_msg,
                        );
                        return Ok(false);
                    }
                }
            }
        }
    }

    // 更新profiles配置
    logging!(info, Type::Cmd, true, "正在更新配置草稿");

    let current_value = profiles.current.clone();

    let _ = Config::profiles().draft().patch_config(profiles);

    // 为配置更新添加超时保护
    let update_result = tokio::time::timeout(
        Duration::from_secs(30), // 30秒超时
        CoreManager::global().update_config(),
    )
    .await;

    // 更新配置并进行验证
    match update_result {
        Ok(Ok((true, _))) => {
            logging!(info, Type::Cmd, true, "配置更新成功");
            Config::profiles().apply();
            handle::Handle::refresh_clash();

            // 强制刷新代理缓存，确保profile切换后立即获取最新节点数据
            crate::process::AsyncHandler::spawn(|| async move {
                if let Err(e) = super::proxy::force_refresh_proxies().await {
                    log::warn!(target: "app", "强制刷新代理缓存失败: {}", e);
                }
            });

            crate::process::AsyncHandler::spawn(|| async move {
                if let Err(e) = Tray::global().update_tooltip() {
                    log::warn!(target: "app", "异步更新托盘提示失败: {}", e);
                }

                if let Err(e) = Tray::global().update_menu() {
                    log::warn!(target: "app", "异步更新托盘菜单失败: {}", e);
                }

                // 保存配置文件
                if let Err(e) = Config::profiles().data().save_file() {
                    log::warn!(target: "app", "异步保存配置文件失败: {}", e);
                }
            });

            // 立即通知前端配置变更
            if let Some(current) = &current_value {
                logging!(info, Type::Cmd, true, "向前端发送配置变更事件: {}", current);
                handle::Handle::notify_profile_changed(current.clone());
            }

            Ok(true)
        }
        Ok(Ok((false, error_msg))) => {
            logging!(warn, Type::Cmd, true, "配置验证失败: {}", error_msg);
            Config::profiles().discard();
            // 如果验证失败，恢复到之前的配置
            if let Some(prev_profile) = current_profile {
                logging!(
                    info,
                    Type::Cmd,
                    true,
                    "尝试恢复到之前的配置: {}",
                    prev_profile
                );
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                // 静默恢复，不触发验证
                wrap_err!({ Config::profiles().draft().patch_config(restore_profiles) })?;
                Config::profiles().apply();

                crate::process::AsyncHandler::spawn(|| async move {
                    if let Err(e) = Config::profiles().data().save_file() {
                        log::warn!(target: "app", "异步保存恢复配置文件失败: {}", e);
                    }
                });

                logging!(info, Type::Cmd, true, "成功恢复到之前的配置");
            }

            // 发送验证错误通知
            handle::Handle::notice_message("config_validate::error", &error_msg);
            Ok(false)
        }
        Ok(Err(e)) => {
            logging!(warn, Type::Cmd, true, "更新过程发生错误: {}", e);
            Config::profiles().discard();
            handle::Handle::notice_message("config_validate::boot_error", e.to_string());
            Ok(false)
        }
        Err(_) => {
            // 超时处理
            let timeout_msg = "配置更新超时(30秒)，可能是配置验证或核心通信阻塞";
            logging!(error, Type::Cmd, true, "{}", timeout_msg);
            Config::profiles().discard();

            if let Some(prev_profile) = current_profile {
                logging!(
                    info,
                    Type::Cmd,
                    true,
                    "超时后尝试恢复到之前的配置: {}",
                    prev_profile
                );
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                wrap_err!({ Config::profiles().draft().patch_config(restore_profiles) })?;
                Config::profiles().apply();
            }

            handle::Handle::notice_message("config_validate::timeout", timeout_msg);
            Ok(false)
        }
    }
}

/// 根据profile name修改profiles
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(
    _app_handle: tauri::AppHandle,
    profile_index: String,
) -> CmdResult<bool> {
    logging!(info, Type::Cmd, true, "切换配置到: {}", profile_index);

    let profiles = IProfiles {
        current: Some(profile_index),
        items: None,
    };
    patch_profiles_config(profiles).await
}

/// 修改某个profile item的
#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    // 保存修改前检查是否有更新 update_interval
    let update_interval_changed =
        if let Ok(old_profile) = Config::profiles().latest().get_item(&index) {
            let old_interval = old_profile.option.as_ref().and_then(|o| o.update_interval);
            let new_interval = profile.option.as_ref().and_then(|o| o.update_interval);
            old_interval != new_interval
        } else {
            false
        };

    // 保存修改
    wrap_err!(Config::profiles().data().patch_item(index.clone(), profile))?;

    // 如果更新间隔变更，异步刷新定时器
    if update_interval_changed {
        let index_clone = index.clone();
        crate::process::AsyncHandler::spawn(move || async move {
            logging!(info, Type::Timer, "定时器更新间隔已变更，正在刷新定时器...");
            if let Err(e) = crate::core::Timer::global().refresh() {
                logging!(error, Type::Timer, "刷新定时器失败: {}", e);
            } else {
                // 刷新成功后发送自定义事件，不触发配置重载
                crate::core::handle::Handle::notify_timer_updated(index_clone);
            }
        });
    }

    Ok(())
}

/// 查看配置文件
#[tauri::command]
pub fn view_profile(app_handle: tauri::AppHandle, index: String) -> CmdResult {
    let file = {
        wrap_err!(Config::profiles().latest().get_item(&index))?
            .file
            .clone()
            .ok_or("the file field is null")
    }?;

    let path = wrap_err!(dirs::app_profiles_dir())?.join(file);
    if !path.exists() {
        ret_err!("the file not found");
    }

    wrap_err!(help::open_file(app_handle, path))
}

/// 读取配置文件内容
#[tauri::command]
pub fn read_profile_file(index: String) -> CmdResult<String> {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let item = wrap_err!(profiles.get_item(&index))?;
    let data = wrap_err!(item.read_file())?;
    Ok(data)
}

/// 获取下一次更新时间
#[tauri::command]
pub fn get_next_update_time(uid: String) -> CmdResult<Option<i64>> {
    let timer = Timer::global();
    let next_time = timer.get_next_update_time(&uid);
    Ok(next_time)
}
