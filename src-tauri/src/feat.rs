//！
//! feat mod 里的函数主要用于
//! - hotkey 快捷键
//! - timer 定时器
//! - cmds 页面调用
//!
use crate::cmds;
use crate::config::*;
use crate::core::*;
use crate::log_err;
use crate::utils::resolve;
use anyhow::{anyhow, bail, Error, Result};
use mihomo::MihomoClientManager;
use rust_i18n::t;
use serde_yaml::{Mapping, Value};
use service::JsonResponse;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::MessageDialogButtons;
use tauri_plugin_dialog::MessageDialogKind;
use verge_log::VergeLog;

// 打开面板
pub fn open_or_close_dashboard() {
    let app_handle = handle::Handle::global().get_app_handle();
    if let Ok(app_handle) = app_handle {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Ok(true) = window.is_focused() {
                let _ = window.close();
                return;
            }
        }
        resolve::create_window(&app_handle);
    }
}

// 重启clash
pub fn restart_clash_core() {
    tauri::async_runtime::spawn(async {
        match CoreManager::global().run_core().await {
            Ok(_) => {
                handle::Handle::refresh_clash();
                handle::Handle::notice_message("set_config::ok", "ok");
            }
            Err(err) => {
                handle::Handle::notice_message("set_config::error", format!("{err}"));
                log::error!(target:"app", "{err}");
            }
        }
    });
}

// 切换模式 rule/global/direct/script mode
pub fn change_clash_mode(mode: String) {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), mode.clone().into());

    tauri::async_runtime::spawn(async move {
        log::debug!(target: "app", "change clash mode to {mode}");

        match MihomoClientManager::global()
            .mihomo()
            .patch_base_config(&mapping)
            .await
        {
            Ok(_) => {
                // 更新订阅
                Config::clash().data().patch_config(mapping);

                if Config::clash().data().save_config().is_ok() {
                    handle::Handle::refresh_clash();
                    log_err!(handle::Handle::update_systray_part());
                }
            }
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

// 切换系统代理
pub fn toggle_system_proxy() {
    let enable = Config::verge().draft().enable_system_proxy;
    let enable = enable.unwrap_or(false);

    tauri::async_runtime::spawn(async move {
        match patch_verge(IVerge {
            enable_system_proxy: Some(!enable),
            ..IVerge::default()
        })
        .await
        {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
        let _ = handle::Handle::update_systray_part();
    });
}

pub fn toggle_service_mode() {
    let enable = Config::verge()
        .latest()
        .enable_service_mode
        .unwrap_or(false);
    let toggle_failed_msg = if enable {
        t!("disable.failed")
    } else {
        t!("enable.failed")
    };

    tauri::async_runtime::spawn(async move {
        match cmds::service::check_service().await {
            Ok(JsonResponse { code: 400, .. } | JsonResponse { code: 0, .. }) => {
                let patch = IVerge {
                    enable_service_mode: Some(!enable),
                    ..IVerge::default()
                };
                if let Err(err) = patch_verge(patch).await {
                    let _ = handle::Handle::notification(
                        "Clash Verge Service",
                        format!("{}, {}", toggle_failed_msg, err),
                    );
                    log::error!(target: "app", "{err}")
                } else {
                    handle::Handle::refresh_verge()
                }
            }
            Ok(response) => {
                let _ = handle::Handle::notification(
                    "Clash Verge Service",
                    format!("{}, {}", toggle_failed_msg, response.msg),
                );
            }
            Err(err) => {
                log::error!(target: "app", "toggle service mode failed: {err}");
                let status = handle::Handle::show_block_dialog(
                    "Clash Verge Service",
                    t!("install.service.ask"),
                    MessageDialogKind::Info,
                    MessageDialogButtons::OkCancel,
                )
                .unwrap_or(false);
                if status {
                    let _ = install_and_run_service().await;
                }
            }
        }
        let _ = handle::Handle::update_systray_part();
    });
}

// 切换tun模式
pub fn toggle_tun_mode() {
    let enable = Config::clash().data().get_enable_tun();
    let toggle_failed_msg = if enable {
        t!("disable.failed")
    } else {
        t!("enable.failed")
    };

    let mut tun = Mapping::new();
    let mut tun_val = Mapping::new();
    tun_val.insert("enable".into(), Value::from(!enable));
    tun.insert("tun".into(), tun_val.into());

    tauri::async_runtime::spawn(async move {
        match cmds::service::check_service().await {
            Ok(JsonResponse { code: 0, .. }) => match patch_clash(tun).await {
                Ok(_) => log::info!(target: "app", "change tun mode to {:?}", !enable),
                Err(err) => log::error!(target: "app", "toggle tun mode failed: {err}"),
            },
            Ok(JsonResponse { code: 400, .. }) => {
                // service installed but no enable, need to patch verge to enable service mode
                if let Err(err) = patch_verge(IVerge {
                    enable_service_mode: Some(true),
                    ..IVerge::default()
                })
                .await
                {
                    let _ = handle::Handle::notification(
                        "Tun Mode",
                        format!("{}, {}", toggle_failed_msg, err),
                    );
                } else {
                    let _ = cmds::service::check_service_and_clash().await;
                    handle::Handle::refresh_verge();
                    match patch_clash(tun).await {
                        Ok(_) => log::info!(target: "app", "change tun mode to {:?}", !enable),
                        Err(err) => log::error!(target: "app", "{err}"),
                    }
                }
            }
            Ok(response) => {
                let _ = handle::Handle::notification(
                    "Tun Mode",
                    format!("{}, {}", toggle_failed_msg, response.msg),
                );
            }
            Err(err) => {
                log::error!(target: "app", "toggle service mode failed: {err}");
                let status = handle::Handle::show_block_dialog(
                    "Clash Verge Service",
                    t!("install.service.ask"),
                    MessageDialogKind::Info,
                    MessageDialogButtons::OkCancel,
                )
                .unwrap_or(false);
                if status {
                    if let Ok(_) = install_and_run_service().await {
                        if let Err(err) = cmds::service::check_service_and_clash().await {
                            let _ = handle::Handle::notification(
                                "Tun Mode",
                                format!("{}, {}", toggle_failed_msg, err),
                            );
                        } else {
                            if let Err(err) = patch_clash(tun).await {
                                let _ = handle::Handle::notification(
                                    "Tun Mode",
                                    format!("{}, {}", toggle_failed_msg, err),
                                );
                                log::error!(target: "app", "{err}")
                            } else {
                                log::info!(target: "app", "change tun mode to {:?}", !enable);
                            }
                        }
                    }
                }
            }
        }

        let _ = handle::Handle::update_systray_part();
    });
}

async fn install_and_run_service() -> Result<()> {
    if let Err(err) = cmds::service::install_service().await {
        handle::Handle::notification(
            "Clash Verge Service",
            format!("{}, {}", t!("install.failed"), err),
        )?;
        return Err(anyhow!(err));
    }
    if let Err(err) = patch_verge(IVerge {
        enable_service_mode: Some(true),
        ..IVerge::default()
    })
    .await
    {
        handle::Handle::notification(
            "Clash Verge Service",
            format!("{}, {}", t!("service.install.run.failed"), err),
        )?;
        return Err(anyhow!(err));
    }
    handle::Handle::notification("Clash Verge Service", t!("service.install.run.success"))?;
    handle::Handle::refresh_verge();
    Ok(())
}

/// 修改clash的订阅
pub async fn patch_clash(patch: Mapping) -> Result<()> {
    // enable-random-port filed store in verge config, only need update verge config
    if let Some(random_val) = patch.get("enable-random-port") {
        let enable_random_port = random_val.as_bool().unwrap_or(false);
        // disable other port & update clash config
        let mut tmp_map = Mapping::new();
        if enable_random_port {
            let port =
                resolve::find_unused_port().unwrap_or(Config::clash().latest().get_mixed_port());
            tmp_map.insert("mixed-port".into(), port.into());
        } else {
            tmp_map.insert("mixed-port".into(), 7890.into());
        }
        tmp_map.insert("port".into(), 0.into());
        tmp_map.insert("socks-port".into(), 0.into());
        tmp_map.insert("redir-port".into(), 0.into());
        tmp_map.insert("tproxy-port".into(), 0.into());
        let _ = MihomoClientManager::global()
            .mihomo()
            .patch_base_config(&tmp_map)
            .await;
        // clash config
        Config::clash().latest().patch_config(tmp_map);
        Config::clash().latest().save_config()?;
        // runtime config
        Config::generate()?;
        Config::generate_file(ConfigType::Run)?;
        // verge config
        Config::verge().latest().patch_config(IVerge {
            enable_random_port: Some(enable_random_port),
            ..IVerge::default()
        });
        // update sysproxy
        sysopt::Sysopt::global().update_sysproxy()?;
        // emit refresh event & emit set config ok message
        handle::Handle::refresh_verge();
        handle::Handle::refresh_clash();
        handle::Handle::notice_message("set_config::ok", "ok");
        return Result::<()>::Ok(());
    }

    Config::clash()
        .draft()
        .patch_and_merge_config(patch.clone());
    let mut generate_runtime_config = false;
    let res = {
        let mut update_tun_failed = false;
        for key in CLASH_BASIC_CONFIG {
            if patch.get(key).is_some() {
                if !generate_runtime_config {
                    generate_runtime_config = true;
                }
                let mut mapping = Mapping::new();
                let clash_config_mapping = { Config::clash().latest().0.clone() };
                let value = clash_config_mapping.get(key).unwrap();

                mapping.insert(key.into(), value.clone().into());
                let _ = MihomoClientManager::global()
                    .mihomo()
                    .patch_base_config(&mapping)
                    .await;

                // handle tun config
                if key == "tun" {
                    let clash_basic_configs = MihomoClientManager::global()
                        .mihomo()
                        .get_base_config()
                        .await?;
                    let tun_enable = value
                        .as_mapping()
                        .unwrap()
                        .get("enable")
                        .map_or(false, |val| val.as_bool().unwrap_or(false));
                    let tun_enable_by_api = clash_basic_configs.tun.enable;
                    // let tun_enable_by_api = clash_basic_configs
                    //     .tun
                    //     .get("enable")
                    //     .map_or(false, |val| val.as_bool().unwrap_or(false));
                    if tun_enable == tun_enable_by_api {
                        handle::Handle::update_systray_part()?;
                    } else {
                        update_tun_failed = true;
                        break;
                    }
                }
                // handle system proxy
                if key == "mixed-port" {
                    sysopt::Sysopt::global().update_sysproxy()?;
                }
            }
        }

        if update_tun_failed {
            <Result<(), Error>>::Err(anyhow!(t!("tun.busy")))
        } else {
            // 重新载入订阅
            if patch.get("unified-delay").is_some() {
                update_core_config().await?;
            }
            // 激活订阅
            if patch.get("secret").is_some() || patch.get("external-controller").is_some() {
                Config::generate()?;
                CoreManager::global().run_core().await?;
            }

            if patch.get("mode").is_some() {
                log_err!(handle::Handle::update_systray_part());
            }

            Config::runtime().latest().patch_config(patch);
            if generate_runtime_config {
                // if the clash basic config changed, we need to sync the runtime configuration file now
                Config::generate()?;
                Config::generate_file(ConfigType::Run)?;
            }
            <Result<()>>::Ok(())
        }
    };
    match res {
        Ok(()) => {
            log::info!(target: "app", "update success, apply clash config");
            Config::clash().apply();
            Config::clash().data().save_config()?;
            handle::Handle::refresh_clash();
            Ok(())
        }
        Err(err) => {
            log::error!(target: "app", "update failed, discard clash config");
            Config::clash().discard();
            Err(err)
        }
    }
}

/// 修改verge的订阅
/// 一般都是一个个的修改
pub async fn patch_verge(mut patch: IVerge) -> Result<()> {
    // handle window size when toggle system title bar enable on linux wayland
    let enable_system_title_bar = patch.enable_system_title_bar;
    if let Some(system_title_bar) = enable_system_title_bar {
        if cmds::is_wayland().unwrap_or(false) {
            let verge = Config::verge();
            let verge = verge.latest().clone();
            let verge_size_position = verge.window_size_position;
            if let Some(size_position) = verge_size_position {
                let mut w = size_position[0];
                let mut h = size_position[1];
                let x = size_position[2];
                let y = size_position[3];
                if system_title_bar {
                    w = w + 90.;
                    h = h + 90.;
                } else {
                    w = w - 90.;
                    h = h - 90.;
                }
                patch.window_size_position = Some(vec![w, h, x, y]);
            }
        }
    }
    Config::verge().draft().patch_config(patch.clone());

    let res = resolve_config_settings(patch).await;
    match res {
        Ok(()) => {
            Config::verge().apply();
            Config::verge().data().save_file()?;
            Ok(())
        }
        Err(err) => {
            Config::verge().discard();
            Err(err)
        }
    }
}

pub async fn resolve_config_settings(patch: IVerge) -> Result<()> {
    let auto_launch = patch.enable_auto_launch;
    let system_proxy = patch.enable_system_proxy;
    let pac = patch.proxy_auto_config;
    let pac_content = patch.pac_file_content;
    let proxy_bypass = patch.system_proxy_bypass;
    let language = patch.language;
    #[cfg(target_os = "macos")]
    let tray_icon = patch.tray_icon;
    let common_tray_icon = patch.common_tray_icon;
    let sysproxy_tray_icon = patch.sysproxy_tray_icon;
    let tun_tray_icon = patch.tun_tray_icon;
    let log_level = patch.app_log_level;
    let enable_tray = patch.enable_tray;
    let service_mode = patch.enable_service_mode;

    if log_level.is_some() {
        let log_level = Config::verge().latest().get_log_level();
        VergeLog::update_log_level(log_level)?;
    }

    if service_mode.is_some() {
        log::debug!(target: "app", "change service mode to {}", service_mode.unwrap());
        Config::generate()?;
        CoreManager::global().run_core().await?;
    }
    if auto_launch.is_some() {
        sysopt::Sysopt::global().update_launch()?;
    }
    if system_proxy.is_some() || proxy_bypass.is_some() || pac.is_some() || pac_content.is_some() {
        sysopt::Sysopt::global().update_sysproxy()?;
    }

    if let Some(true) = patch.enable_proxy_guard {
        sysopt::Sysopt::global().guard_proxy();
    }

    if let Some(hotkeys) = patch.hotkeys {
        hotkey::Hotkey::global().update(hotkeys)?;
    }

    if language.is_some() {
        rust_i18n::set_locale(language.unwrap().as_str());
        handle::Handle::update_systray()?;
    } else if system_proxy.is_some()
        || common_tray_icon.is_some()
        || sysproxy_tray_icon.is_some()
        || tun_tray_icon.is_some()
        || service_mode.is_some()
    {
        handle::Handle::update_systray_part()?;
    }
    #[cfg(target_os = "macos")]
    if tray_icon.is_some() {
        handle::Handle::update_systray_part()?;
    }

    if enable_tray.is_some() {
        handle::Handle::set_tray_visible(enable_tray.unwrap())?;
    }

    Ok(())
}

/// 更新某个profile
/// 如果更新当前订阅就激活订阅
pub async fn update_profile(uid: String, option: Option<PrfOption>) -> Result<()> {
    let url_opt = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let item = profiles.get_item(&uid)?;
        let is_remote = item.itype.as_ref().map_or(false, |s| s == "remote");

        if !is_remote {
            None // 直接更新
        } else if item.url.is_none() {
            bail!("failed to get the profile item url");
        } else {
            Some((item.url.clone().unwrap(), item.option.clone()))
        }
    };

    let should_update = match url_opt {
        Some((url, opt)) => {
            let merged_opt = PrfOption::merge(opt, option);
            let item = PrfItem::from_url(&url, None, None, merged_opt).await?;

            let profiles = Config::profiles();
            let mut profiles = profiles.latest();
            profiles.update_item(uid.clone(), item)?;

            Some(uid) == profiles.get_current()
        }
        None => true,
    };

    if should_update {
        update_core_config().await?;
    }

    Ok(())
}

/// 更新订阅
async fn update_core_config() -> Result<()> {
    match CoreManager::global().update_config(false).await {
        Ok(_) => {
            handle::Handle::refresh_clash();
            handle::Handle::notice_message("set_config::ok", "ok");
            Ok(())
        }
        Err(err) => {
            handle::Handle::notice_message("set_config::error", format!("{err}"));
            Err(err)
        }
    }
}

/// copy env variable
pub fn copy_clash_env(app_handle: &AppHandle) {
    let port = { Config::clash().latest().get_mixed_port() };
    let http_proxy = format!("http://127.0.0.1:{}", port);
    let socks5_proxy = format!("socks5://127.0.0.1:{}", port);

    let sh =
        format!("export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}");
    let cmd: String = format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}");
    let ps: String = format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"");

    let cliboard = app_handle.clipboard();

    let env_type = { Config::verge().latest().env_type.clone() };
    let env_type = match env_type {
        Some(env_type) => env_type,
        None => {
            #[cfg(not(target_os = "windows"))]
            let default = "bash";
            #[cfg(target_os = "windows")]
            let default = "powershell";

            default.to_string()
        }
    };
    match env_type.as_str() {
        "bash" => cliboard.write_text(sh).unwrap_or_default(),
        "cmd" => cliboard.write_text(cmd).unwrap_or_default(),
        "powershell" => cliboard.write_text(ps).unwrap_or_default(),
        _ => log::error!(target: "app", "copy_clash_env: Invalid env type! {env_type}"),
    };
}

pub async fn test_delay(url: String) -> Result<u32> {
    use tokio::time::{Duration, Instant};
    let mut builder = reqwest::ClientBuilder::new().use_rustls_tls().no_proxy();

    let port = Config::clash().latest().get_mixed_port();
    let tun_mode = Config::clash().latest().get_enable_tun();

    let proxy_scheme = format!("http://127.0.0.1:{port}");

    if !tun_mode {
        if let Ok(proxy) = reqwest::Proxy::http(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
        if let Ok(proxy) = reqwest::Proxy::https(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
    }

    let request = builder
        .timeout(Duration::from_millis(5000))
        .build()?
        .get(url).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0");
    let start = Instant::now();

    let response = request.send().await;
    match response {
        Ok(response) => {
            log::trace!(target: "app", "test_delay response: {:#?}", response);
            if response.status().is_success() {
                Ok(start.elapsed().as_millis() as u32)
            } else {
                Ok(5000u32)
            }
        }
        Err(err) => {
            log::trace!(target: "app", "test_delay error: {:#?}", err);
            Err(err.into())
        }
    }
}
