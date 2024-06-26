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
use crate::utils::dirs::APP_ID;
use crate::utils::resolve;
use crate::utils::resolve::find_unused_port;
use anyhow::{bail, Result};
use serde_yaml::{Mapping, Value};
use tauri::api::notification::Notification;
use tauri::{AppHandle, ClipboardManager, Manager};

// 打开面板
pub fn open_or_close_dashboard() {
    let handle = handle::Handle::global();
    let app_handle = handle.app_handle.lock();
    if let Some(app_handle) = app_handle.as_ref() {
        if let Some(window) = app_handle.get_window("main") {
            if let Ok(true) = window.is_focused() {
                let _ = window.close();
                return;
            }
        }
        resolve::create_window(app_handle);
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

        match clash_api::patch_configs(&mapping).await {
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
    });
}

// 切换tun模式
pub fn toggle_tun_mode() {
    let enable = Config::clash().data().get_enable_tun();

    tauri::async_runtime::spawn(async move {
        match cmds::service::check_service().await {
            Ok(service_status) => {
                if service_status.code != 0 {
                    let content = if service_status.code == 400 {
                        format!("Please check whether clash verge service has been enabled.")
                    } else {
                        format!("Please check whether clash verge service has been installed.")
                    };
                    Notification::new(APP_ID)
                        .title("Clash Verge")
                        .body(content)
                        .show()
                        .unwrap();
                } else {
                    let mut tun = Mapping::new();
                    let mut tun_val = Mapping::new();
                    tun_val.insert("enable".into(), Value::from(!enable));
                    tun.insert("tun".into(), tun_val.into());
                    match patch_clash(tun).await {
                        Ok(_) => log::info!(target: "app", "tun mode to {enable}"),
                        Err(err) => {
                            log::error!(target: "app", "{err}")
                        }
                    }
                }
            }
            Err(err) => {
                let content = format!("Toggle Tun Failed:\n {err}");
                Notification::new(APP_ID)
                    .title("Clash Verge")
                    .body(content)
                    .show()
                    .unwrap();
            }
        }
    });
}

/// 修改clash的订阅
pub async fn patch_clash(patch: Mapping) -> Result<()> {
    // enable-random-port filed store in verge config, only need update verge config
    if let Some(random_val) = patch.get("enable-random-port") {
        let enable_random_port = random_val.as_bool().unwrap_or(false);
        let mut port = 7897;
        if enable_random_port {
            port = find_unused_port().unwrap_or(Config::clash().latest().get_mixed_port());
        }
        // disable other port & update clash config
        let mut tmp_map = Mapping::new();
        tmp_map.insert("mixed-port".into(), port.into());
        tmp_map.insert("port".into(), 0.into());
        tmp_map.insert("socks-port".into(), 0.into());
        tmp_map.insert("redir-port".into(), 0.into());
        tmp_map.insert("tproxy-port".into(), 0.into());
        let _ = clash_api::patch_configs(&tmp_map).await?;
        Config::clash().draft().patch_config(tmp_map);
        // update sysproxy
        sysopt::Sysopt::global().update_sysproxy()?;
        // update verge config
        Config::verge().latest().patch_config(IVerge {
            enable_random_port: Some(enable_random_port),
            ..IVerge::default()
        });
        // emit refresh event & emit set config ok message
        handle::Handle::refresh_verge();
        handle::Handle::refresh_clash();
        handle::Handle::notice_message("set_config::ok", "ok");
        return Result::<()>::Ok(());
    }

    Config::clash()
        .draft()
        .patch_and_merge_config(patch.clone());
    let res = {
        for key in CLASH_BASIC_CONFIG {
            if let Some(manual_val) = patch.get(key) {
                let mut mapping = Mapping::new();
                let is_tun_setting = key == "tun";
                let mut tun_enable = false;
                if is_tun_setting {
                    let mut clash_config = { Config::clash().data().0.clone() };
                    let mut tun_mapping = clash_config.get_mut(key).map_or(Mapping::new(), |val| {
                        val.as_mapping().cloned().unwrap_or(Mapping::new())
                    });
                    let manual_mapping = manual_val.as_mapping().cloned().unwrap_or(Mapping::new());
                    for (tun_key, tun_value) in manual_mapping.into_iter() {
                        tun_mapping.insert(tun_key, tun_value);
                    }
                    tun_enable = tun_mapping
                        .get("enable")
                        .map_or(false, |val| val.as_bool().unwrap_or(false));
                    mapping.insert(key.into(), tun_mapping.into());
                } else {
                    mapping.insert(key.into(), manual_val.clone().into());
                }
                let _ = clash_api::patch_configs(&mapping).await?;
                if is_tun_setting {
                    let clash_configs = clash_api::get_configs().await?;
                    let enable_tun_by_api = clash_configs
                        .tun
                        .get("enable")
                        .map_or(false, |val| val.as_bool().unwrap_or(false));
                    if tun_enable == enable_tun_by_api {
                        handle::Handle::update_systray_part()?;
                        handle::Handle::notice_message("set_config::ok", "ok");
                    } else {
                        handle::Handle::notice_message("set_config::error", "Tun Toggle Failed");
                        bail!("Tun Toggle Failed");
                        // return <Result<()>>::Ok(());
                    }
                }
                if key.contains("mixed-port") {
                    sysopt::Sysopt::global().update_sysproxy()?;
                }
                // this clash basic config need to be synchronized in real time
                Config::generate()?;
                Config::generate_file(ConfigType::Run)?;
                handle::Handle::refresh_clash();
            }
        }

        // 激活订阅
        if patch.get("secret").is_some() || patch.get("external-controller").is_some() {
            Config::generate()?;
            CoreManager::global().run_core().await?;
            // handle::Handle::refresh_clash();
        }

        if patch.get("mode").is_some() {
            log_err!(handle::Handle::update_systray_part());
        }

        Config::runtime().latest().patch_config(patch);

        <Result<()>>::Ok(())
    };
    match res {
        Ok(()) => {
            Config::clash().apply();
            Config::clash().data().save_config()?;
            Ok(())
        }
        Err(err) => {
            Config::clash().discard();
            Err(err)
        }
    }
}

/// 修改verge的订阅
/// 一般都是一个个的修改
pub async fn patch_verge(patch: IVerge) -> Result<()> {
    Config::verge().draft().patch_config(patch.clone());

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
    let res = {
        let service_mode = patch.enable_service_mode;

        if service_mode.is_some() {
            log::debug!(target: "app", "change service mode to {}", service_mode.unwrap());
            Config::generate()?;
            CoreManager::global().run_core().await?;
        }
        if auto_launch.is_some() {
            sysopt::Sysopt::global().update_launch()?;
        }
        if system_proxy.is_some()
            || proxy_bypass.is_some()
            || pac.is_some()
            || pac_content.is_some()
        {
            sysopt::Sysopt::global().update_sysproxy()?;
        }

        if let Some(true) = patch.enable_proxy_guard {
            sysopt::Sysopt::global().guard_proxy();
        }

        if let Some(hotkeys) = patch.hotkeys {
            hotkey::Hotkey::global().update(hotkeys)?;
        }

        if language.is_some() {
            handle::Handle::update_systray()?;
        } else if system_proxy.is_some()
            || common_tray_icon.is_some()
            || sysproxy_tray_icon.is_some()
            || tun_tray_icon.is_some()
        {
            handle::Handle::update_systray_part()?;
        }
        #[cfg(target_os = "macos")]
        if tray_icon.is_some() {
            handle::Handle::update_systray_part()?;
        }

        <Result<()>>::Ok(())
    };
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
    match CoreManager::global().update_config().await {
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

    let mut cliboard = app_handle.clipboard_manager();

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
        .timeout(Duration::from_millis(10000))
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
                Ok(10000u32)
            }
        }
        Err(err) => {
            log::trace!(target: "app", "test_delay error: {:#?}", err);
            Err(err.into())
        }
    }
}
