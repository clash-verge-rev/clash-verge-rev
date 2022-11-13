use crate::config::*;
use crate::core::*;
use crate::log_err;
use anyhow::Result;
use serde_yaml::{Mapping, Value};

// 重启clash
pub fn restart_clash_core() {
    tauri::async_runtime::spawn(async {
        CoreManager::global().run_core()?;
        log_err!(handle_activate().await);
        <Result<()>>::Ok(())
    });
}

// 切换模式 rule/global/direct/script mode
pub fn change_clash_mode(mode: String) {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), mode.clone().into());

    tauri::async_runtime::spawn(async move {
        match clash_api::patch_configs(&mapping).await {
            Ok(_) => {
                // 更新配置
                let mut clash = ClashN::global().config.lock();
                clash.insert(Value::from("mode"), mode.into());
                drop(clash);

                if let Ok(_) = ClashN::global().save_config() {
                    handle::Handle::refresh_clash();
                    log_err!(handle::Handle::update_systray_part());
                }
            }
            Err(err) => {
                log::error!(target: "app", "{err}");
            }
        }
    });
}

// 切换系统代理
pub fn toggle_system_proxy() -> Result<()> {
    let enable = {
        let verge = VergeN::global().config.lock();
        verge.enable_system_proxy.clone().unwrap_or(false)
    };
    patch_verge(IVerge {
        enable_system_proxy: Some(!enable),
        ..IVerge::default()
    })?;
    handle::Handle::refresh_verge();
    Ok(())
}

// 打开系统代理
pub fn enable_system_proxy() -> Result<()> {
    patch_verge(IVerge {
        enable_system_proxy: Some(true),
        ..IVerge::default()
    })?;
    handle::Handle::refresh_verge();
    Ok(())
}

// 关闭系统代理
pub fn disable_system_proxy() -> Result<()> {
    patch_verge(IVerge {
        enable_system_proxy: Some(false),
        ..IVerge::default()
    })?;
    handle::Handle::refresh_verge();
    Ok(())
}

// 切换tun模式
pub fn toggle_tun_mode() -> Result<()> {
    let enable = {
        let verge = VergeN::global().config.lock();
        verge.enable_tun_mode.clone().unwrap_or(false)
    };

    patch_verge(IVerge {
        enable_tun_mode: Some(!enable),
        ..IVerge::default()
    })?;
    handle::Handle::refresh_verge();
    Ok(())
}

// 打开tun模式
pub fn enable_tun_mode() -> Result<()> {
    patch_verge(IVerge {
        enable_tun_mode: Some(true),
        ..IVerge::default()
    })?;
    handle::Handle::refresh_verge();
    Ok(())
}

// 关闭tun模式
pub fn disable_tun_mode() -> Result<()> {
    patch_verge(IVerge {
        enable_tun_mode: Some(false),
        ..IVerge::default()
    })?;
    handle::Handle::refresh_verge();
    Ok(())
}

/// 修改clash的配置
pub fn patch_clash(patch: Mapping) -> Result<()> {
    let patch_cloned = patch.clone();
    let clash_mode = patch.get("mode").is_some();
    let mixed_port = patch.get("mixed-port").is_some();
    let external = patch.get("external-controller").is_some();
    let secret = patch.get("secret").is_some();

    // 更新info信息
    if mixed_port || external || secret {
        let mut tmp_config = { ClashN::global().config.lock().clone() };

        for (key, value) in patch.into_iter() {
            tmp_config.insert(key, value);
        }

        let old_info = ClashN::global().patch_info(ClashInfoN::from(&tmp_config))?;

        if let Err(err) = CoreManager::global().run_core() {
            // 恢复旧值
            ClashN::global().patch_info(old_info)?;
            return Err(err);
        }
    }
    // 存好再搞
    ClashN::global().patch_config(patch_cloned)?;

    // 激活配置
    tauri::async_runtime::spawn(async move {
        match handle_activate().await {
            Ok(_) => {
                // 更新系统代理
                if mixed_port {
                    log_err!(sysopt::Sysopt::global().init_sysproxy());
                }

                if clash_mode {
                    log_err!(handle::Handle::update_systray_part());
                }
            }
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
    Ok(())
}

/// 修改verge的配置
/// 一般都是一个个的修改
pub fn patch_verge(patch: IVerge) -> Result<()> {
    VergeN::global().patch_config(patch.clone())?;

    let tun_mode = patch.enable_tun_mode;
    let auto_launch = patch.enable_auto_launch;
    let system_proxy = patch.enable_system_proxy;
    let proxy_bypass = patch.system_proxy_bypass;
    let proxy_guard = patch.enable_proxy_guard;
    let language = patch.language;

    #[cfg(target_os = "windows")]
    {}

    if tun_mode.is_some() {
        tauri::async_runtime::spawn(async {
            log_err!(handle_activate().await);
        });
    }

    if auto_launch.is_some() {
        sysopt::Sysopt::global().update_launch()?;
    }
    if system_proxy.is_some() || proxy_bypass.is_some() {
        sysopt::Sysopt::global().update_sysproxy()?;
        sysopt::Sysopt::global().guard_proxy();
    }
    if proxy_guard.unwrap_or(false) {
        sysopt::Sysopt::global().guard_proxy();
    }

    if language.is_some() {
        handle::Handle::update_systray()?;
    } else if system_proxy.or(tun_mode).is_some() {
        handle::Handle::update_systray_part()?;
    }

    if patch.hotkeys.is_some() {
        hotkey::Hotkey::global().update(patch.hotkeys.unwrap())?;
    }

    Ok(())
}

/// 激活配置
pub async fn handle_activate() -> Result<()> {
    match CoreManager::global().activate_config().await {
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
