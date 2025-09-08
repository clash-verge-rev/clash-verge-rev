use super::CmdResult;
use crate::{
    config::{
        Config, IProfiles, PrfItem, PrfOption,
        profiles::{
            profiles_append_item_with_filedata_safe, profiles_delete_item_safe,
            profiles_patch_item_safe, profiles_reorder_safe, profiles_save_file_safe,
        },
        profiles_append_item_safe,
    },
    core::{CoreManager, handle, timer::Timer, tray::Tray},
    feat, logging,
    process::AsyncHandler,
    ret_err,
    utils::{dirs, help, logging::Type},
    wrap_err,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

// 全局请求序列号跟踪，用于避免队列化执行
static CURRENT_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

static CURRENT_SWITCHING_PROFILE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn get_profiles() -> CmdResult<IProfiles> {
    // 策略1: 尝试快速获取latest数据
    let latest_result = tokio::time::timeout(Duration::from_millis(500), async {
        let profiles = Config::profiles().await;
        let latest = profiles.latest_ref();
        IProfiles {
            current: latest.current.clone(),
            items: latest.items.clone(),
        }
    })
    .await;

    match latest_result {
        Ok(profiles) => {
            logging!(info, Type::Cmd, false, "快速获取配置列表成功");
            return Ok(profiles);
        }
        Err(_) => {
            logging!(warn, Type::Cmd, true, "快速获取配置超时(500ms)");
        }
    }

    // 策略2: 如果快速获取失败，尝试获取data()
    let data_result = tokio::time::timeout(Duration::from_secs(2), async {
        let profiles = Config::profiles().await;
        let data = profiles.latest_ref();
        IProfiles {
            current: data.current.clone(),
            items: data.items.clone(),
        }
    })
    .await;

    match data_result {
        Ok(profiles) => {
            logging!(info, Type::Cmd, false, "获取draft配置列表成功");
            return Ok(profiles);
        }
        Err(join_err) => {
            logging!(
                error,
                Type::Cmd,
                true,
                "获取draft配置任务失败或超时: {}",
                join_err
            );
        }
    }

    // 策略3: fallback，尝试重新创建配置
    logging!(
        warn,
        Type::Cmd,
        true,
        "所有获取配置策略都失败，尝试fallback"
    );

    Ok(IProfiles::new().await)
}

/// 增强配置文件
#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    match feat::enhance_profiles().await {
        Ok(_) => {}
        Err(e) => {
            log::error!(target: "app", "{}", e);
            return Err(e.to_string());
        }
    }
    handle::Handle::refresh_clash();
    Ok(())
}

/// 导入配置文件
#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> CmdResult {
    logging!(info, Type::Cmd, true, "[导入订阅] 开始导入: {}", url);

    let import_result = tokio::time::timeout(Duration::from_secs(60), async {
        let item = PrfItem::from_url(&url, None, None, option).await?;
        logging!(info, Type::Cmd, true, "[导入订阅] 下载完成，开始保存配置");

        let profiles = Config::profiles().await;
        let pre_count = profiles
            .latest_ref()
            .items
            .as_ref()
            .map_or(0, |items| items.len());

        let result = profiles_append_item_safe(item.clone()).await;
        result?;

        let post_count = profiles
            .latest_ref()
            .items
            .as_ref()
            .map_or(0, |items| items.len());
        if post_count <= pre_count {
            logging!(
                error,
                Type::Cmd,
                true,
                "[导入订阅] 配置未增加，导入可能失败"
            );
            return Err(anyhow::anyhow!("配置导入后数量未增加"));
        }

        logging!(
            info,
            Type::Cmd,
            true,
            "[导入订阅] 配置保存成功，数量: {} -> {}",
            pre_count,
            post_count
        );

        // 立即发送配置变更通知
        if let Some(uid) = &item.uid {
            logging!(
                info,
                Type::Cmd,
                true,
                "[导入订阅] 发送配置变更通知: {}",
                uid
            );
            handle::Handle::notify_profile_changed(uid.clone());
        }

        // 异步保存配置文件并发送全局通知
        let uid_clone = item.uid.clone();
        crate::process::AsyncHandler::spawn(move || async move {
            // 使用Send-safe helper函数
            if let Err(e) = profiles_save_file_safe().await {
                logging!(error, Type::Cmd, true, "[导入订阅] 保存配置文件失败: {}", e);
            } else {
                logging!(info, Type::Cmd, true, "[导入订阅] 配置文件保存成功");

                // 发送全局配置更新通知
                if let Some(uid) = uid_clone {
                    // 延迟发送，确保文件已完全写入
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    handle::Handle::notify_profile_changed(uid);
                }
            }
        });

        Ok(())
    })
    .await;

    match import_result {
        Ok(Ok(())) => {
            logging!(info, Type::Cmd, true, "[导入订阅] 导入完成: {}", url);
            Ok(())
        }
        Ok(Err(e)) => {
            logging!(error, Type::Cmd, true, "[导入订阅] 导入失败: {}", e);
            Err(format!("导入订阅失败: {e}"))
        }
        Err(_) => {
            logging!(error, Type::Cmd, true, "[导入订阅] 导入超时(60秒): {}", url);
            Err("导入订阅超时，请检查网络连接".into())
        }
    }
}

/// 调整profile的顺序
#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    match profiles_reorder_safe(active_id, over_id).await {
        Ok(_) => {
            log::info!(target: "app", "重新排序配置文件");
            Ok(())
        }
        Err(err) => {
            log::error!(target: "app", "重新排序配置文件失败: {}", err);
            Err(format!("重新排序配置文件失败: {}", err))
        }
    }
}

/// 创建新的profile
/// 创建一个新的配置文件
#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    match profiles_append_item_with_filedata_safe(item, file_data).await {
        Ok(_) => Ok(()),
        Err(err) => match err.to_string().as_str() {
            "the file already exists" => Err("the file already exists".into()),
            _ => Err(format!("add profile error: {err}")),
        },
    }
}

/// 更新配置文件
#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
    match feat::update_profile(index, option, Some(true)).await {
        Ok(_) => Ok(()),
        Err(e) => {
            log::error!(target: "app", "{}", e);
            Err(e.to_string())
        }
    }
}

/// 删除配置文件
#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    // 使用Send-safe helper函数
    let should_update = wrap_err!(profiles_delete_item_safe(index).await)?;

    if should_update {
        match CoreManager::global().update_config().await {
            Ok(_) => {
                handle::Handle::refresh_clash();
            }
            Err(e) => {
                log::error!(target: "app", "{}", e);
                return Err(e.to_string());
            }
        }
    }
    Ok(())
}

/// 修改profiles的配置
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult<bool> {
    if CURRENT_SWITCHING_PROFILE.load(Ordering::SeqCst) {
        logging!(info, Type::Cmd, true, "当前正在切换配置，放弃请求");
        return Ok(false);
    }
    CURRENT_SWITCHING_PROFILE.store(true, Ordering::SeqCst);

    // 为当前请求分配序列号
    let current_sequence = CURRENT_REQUEST_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1;
    let target_profile = profiles.current.clone();

    logging!(
        info,
        Type::Cmd,
        true,
        "开始修改配置文件，请求序列号: {}, 目标profile: {:?}",
        current_sequence,
        target_profile
    );

    let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
    if current_sequence < latest_sequence {
        logging!(
            info,
            Type::Cmd,
            true,
            "获取锁后发现更新的请求 (序列号: {} < {})，放弃当前请求",
            current_sequence,
            latest_sequence
        );
        return Ok(false);
    }

    // 保存当前配置，以便在验证失败时恢复
    let current_profile = Config::profiles().await.latest_ref().current.clone();
    logging!(info, Type::Cmd, true, "当前配置: {:?}", current_profile);

    // 如果要切换配置，先检查目标配置文件是否有语法错误
    if let Some(new_profile) = profiles.current.as_ref()
        && current_profile.as_ref() != Some(new_profile)
    {
        logging!(info, Type::Cmd, true, "正在切换到新配置: {}", new_profile);

        // 获取目标配置文件路径
        let config_file_result = {
            let profiles_config = Config::profiles().await;
            let profiles_data = profiles_config.latest_ref();
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
                    let yaml_parse_result = AsyncHandler::spawn_blocking(move || {
                        serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&content)
                    })
                    .await;

                    match yaml_parse_result {
                        Ok(Ok(_)) => {
                            logging!(info, Type::Cmd, true, "目标配置文件语法正确");
                        }
                        Ok(Err(err)) => {
                            let error_msg = format!(" {err}");
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
                            let error_msg = format!("YAML解析任务失败: {join_err}");
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
                    let error_msg = format!("无法读取目标配置文件: {err}");
                    logging!(error, Type::Cmd, true, "{}", error_msg);
                    handle::Handle::notice_message("config_validate::file_read_error", &error_msg);
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

    // 检查请求有效性
    let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
    if current_sequence < latest_sequence {
        logging!(
            info,
            Type::Cmd,
            true,
            "在核心操作前发现更新的请求 (序列号: {} < {})，放弃当前请求",
            current_sequence,
            latest_sequence
        );
        return Ok(false);
    }

    // 更新profiles配置
    logging!(
        info,
        Type::Cmd,
        true,
        "正在更新配置草稿，序列号: {}",
        current_sequence
    );

    let current_value = profiles.current.clone();

    let _ = Config::profiles().await.draft_mut().patch_config(profiles);

    // 在调用内核前再次验证请求有效性
    let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
    if current_sequence < latest_sequence {
        logging!(
            info,
            Type::Cmd,
            true,
            "在内核交互前发现更新的请求 (序列号: {} < {})，放弃当前请求",
            current_sequence,
            latest_sequence
        );
        Config::profiles().await.discard();
        return Ok(false);
    }

    // 为配置更新添加超时保护
    logging!(
        info,
        Type::Cmd,
        true,
        "开始内核配置更新，序列号: {}",
        current_sequence
    );
    let update_result = tokio::time::timeout(
        Duration::from_secs(30), // 30秒超时
        CoreManager::global().update_config(),
    )
    .await;

    // 更新配置并进行验证
    match update_result {
        Ok(Ok((true, _))) => {
            // 内核操作完成后再次检查请求有效性
            let latest_sequence = CURRENT_REQUEST_SEQUENCE.load(Ordering::SeqCst);
            if current_sequence < latest_sequence {
                logging!(
                    info,
                    Type::Cmd,
                    true,
                    "内核操作后发现更新的请求 (序列号: {} < {})，忽略当前结果",
                    current_sequence,
                    latest_sequence
                );
                Config::profiles().await.discard();
                return Ok(false);
            }

            logging!(
                info,
                Type::Cmd,
                true,
                "配置更新成功，序列号: {}",
                current_sequence
            );
            Config::profiles().await.apply();
            handle::Handle::refresh_clash();

            // 强制刷新代理缓存，确保profile切换后立即获取最新节点数据
            crate::process::AsyncHandler::spawn(|| async move {
                if let Err(e) = super::proxy::force_refresh_proxies().await {
                    log::warn!(target: "app", "强制刷新代理缓存失败: {e}");
                }
            });

            if let Err(e) = Tray::global().update_tooltip().await {
                log::warn!(target: "app", "异步更新托盘提示失败: {e}");
            }

            if let Err(e) = Tray::global().update_menu().await {
                log::warn!(target: "app", "异步更新托盘菜单失败: {e}");
            }

            // 保存配置文件
            if let Err(e) = profiles_save_file_safe().await {
                log::warn!(target: "app", "异步保存配置文件失败: {e}");
            }

            // 立即通知前端配置变更
            if let Some(current) = &current_value {
                logging!(
                    info,
                    Type::Cmd,
                    true,
                    "向前端发送配置变更事件: {}, 序列号: {}",
                    current,
                    current_sequence
                );
                handle::Handle::notify_profile_changed(current.clone());
            }

            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(true)
        }
        Ok(Ok((false, error_msg))) => {
            logging!(warn, Type::Cmd, true, "配置验证失败: {}", error_msg);
            Config::profiles().await.discard();
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
                wrap_err!({
                    Config::profiles()
                        .await
                        .draft_mut()
                        .patch_config(restore_profiles)
                })?;
                Config::profiles().await.apply();

                crate::process::AsyncHandler::spawn(|| async move {
                    if let Err(e) = profiles_save_file_safe().await {
                        log::warn!(target: "app", "异步保存恢复配置文件失败: {e}");
                    }
                });

                logging!(info, Type::Cmd, true, "成功恢复到之前的配置");
            }

            // 发送验证错误通知
            handle::Handle::notice_message("config_validate::error", &error_msg);
            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(false)
        }
        Ok(Err(e)) => {
            logging!(
                warn,
                Type::Cmd,
                true,
                "更新过程发生错误: {}, 序列号: {}",
                e,
                current_sequence
            );
            Config::profiles().await.discard();
            handle::Handle::notice_message("config_validate::boot_error", e.to_string());

            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(false)
        }
        Err(_) => {
            // 超时处理
            let timeout_msg = "配置更新超时(30秒)，可能是配置验证或核心通信阻塞";
            logging!(
                error,
                Type::Cmd,
                true,
                "{}, 序列号: {}",
                timeout_msg,
                current_sequence
            );
            Config::profiles().await.discard();

            if let Some(prev_profile) = current_profile {
                logging!(
                    info,
                    Type::Cmd,
                    true,
                    "超时后尝试恢复到之前的配置: {}, 序列号: {}",
                    prev_profile,
                    current_sequence
                );
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                wrap_err!({
                    Config::profiles()
                        .await
                        .draft_mut()
                        .patch_config(restore_profiles)
                })?;
                Config::profiles().await.apply();
            }

            handle::Handle::notice_message("config_validate::timeout", timeout_msg);
            CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
            Ok(false)
        }
    }
}

/// 根据profile name修改profiles
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(profile_index: String) -> CmdResult<bool> {
    logging!(info, Type::Cmd, true, "切换配置到: {}", profile_index);

    let profiles = IProfiles {
        current: Some(profile_index),
        items: None,
    };
    patch_profiles_config(profiles).await
}

/// 修改某个profile item的
#[tauri::command]
pub async fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    // 保存修改前检查是否有更新 update_interval
    let profiles = Config::profiles().await;
    let update_interval_changed = if let Ok(old_profile) = profiles.latest_ref().get_item(&index) {
        let old_interval = old_profile.option.as_ref().and_then(|o| o.update_interval);
        let new_interval = profile.option.as_ref().and_then(|o| o.update_interval);
        old_interval != new_interval
    } else {
        false
    };

    // 保存修改
    wrap_err!(profiles_patch_item_safe(index.clone(), profile).await)?;

    // 如果更新间隔变更，异步刷新定时器
    if update_interval_changed {
        let index_clone = index.clone();
        crate::process::AsyncHandler::spawn(move || async move {
            logging!(info, Type::Timer, "定时器更新间隔已变更，正在刷新定时器...");
            if let Err(e) = crate::core::Timer::global().refresh().await {
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
pub async fn view_profile(index: String) -> CmdResult {
    let profiles = Config::profiles().await;
    let profiles_ref = profiles.latest_ref();
    let file = {
        wrap_err!(profiles_ref.get_item(&index))?
            .file
            .clone()
            .ok_or("the file field is null")
    }?;

    let path = wrap_err!(dirs::app_profiles_dir())?.join(file);
    if !path.exists() {
        ret_err!("the file not found");
    }

    wrap_err!(help::open_file(path))
}

/// 读取配置文件内容
#[tauri::command]
pub async fn read_profile_file(index: String) -> CmdResult<String> {
    let profiles = Config::profiles().await;
    let profiles_ref = profiles.latest_ref();
    let item = wrap_err!(profiles_ref.get_item(&index))?;
    let data = wrap_err!(item.read_file())?;
    Ok(data)
}

/// 获取下一次更新时间
#[tauri::command]
pub async fn get_next_update_time(uid: String) -> CmdResult<Option<i64>> {
    let timer = Timer::global();
    let next_time = timer.get_next_update_time(&uid).await;
    Ok(next_time)
}
