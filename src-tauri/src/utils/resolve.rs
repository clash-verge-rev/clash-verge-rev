use crate::config::IVerge;
use crate::utils::error;
use crate::{config::Config, config::PrfItem, core::*, utils::init, utils::server};
use crate::{log_err, wrap_err};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use percent_encoding::percent_decode_str;
use serde_yaml::Mapping;
use std::net::TcpListener;
use tauri::{App, Manager};

use url::Url;
//#[cfg(not(target_os = "linux"))]
// use window_shadows::set_shadow;
use tauri_plugin_notification::NotificationExt;

pub static VERSION: OnceCell<String> = OnceCell::new();

pub fn find_unused_port() -> Result<u16> {
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => {
            let port = listener.local_addr()?.port();
            Ok(port)
        }
        Err(_) => {
            let port = Config::verge()
                .latest()
                .verge_mixed_port
                .unwrap_or(Config::clash().data().get_mixed_port());
            log::warn!(target: "app", "use default port: {}", port);
            Ok(port)
        }
    }
}

/// handle something when start app
pub async fn resolve_setup(app: &mut App) {
    error::redirect_panic_to_log();
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    let version = app.package_info().version.to_string();

    handle::Handle::global().init(app.app_handle());
    VERSION.get_or_init(|| version.clone());

    log_err!(init::init_config());
    log_err!(init::init_resources());
    log_err!(init::init_scheme());
    log_err!(init::startup_script().await);
    // 处理随机端口
    log_err!(resolve_random_port_config());
    // 启动核心
    log::trace!(target:"app", "init config");
    log_err!(Config::init_config().await);

    if service::check_service().await.is_err() {
        match service::reinstall_service().await {
            Ok(_) => {
                log::info!(target:"app", "install service susccess.");
                #[cfg(not(target_os = "macos"))]
                std::thread::sleep(std::time::Duration::from_millis(1000));
                #[cfg(target_os = "macos")]
                {
                    let mut service_runing = false;
                    for _ in 0..40 {
                        if service::check_service().await.is_ok() {
                            service_runing = true;
                            break;
                        } else {
                            log::warn!(target: "app", "service not runing, sleep 500ms and check again.");
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                    }
                    if !service_runing {
                        log::error!(target: "app", "service not runing. exit");
                        app.app_handle().exit(-2);
                    }
                }
            }
            Err(e) => {
                log::error!(target: "app", "{e:?}");
                app.app_handle().exit(-1);
            }
        }
    }

    log::trace!(target: "app", "launch core");
    log_err!(CoreManager::global().init().await);

    // setup a simple http server for singleton
    log::trace!(target: "app", "launch embed server");
    server::embed_server();

    log::trace!(target: "app", "init system tray");
    log_err!(tray::Tray::global().init());
    log_err!(tray::Tray::global().create_systray());

    let silent_start = { Config::verge().data().enable_silent_start };
    if !silent_start.unwrap_or(false) {
        create_window();
    }

    log_err!(sysopt::Sysopt::global().update_sysproxy().await);
    log_err!(sysopt::Sysopt::global().init_guard_sysproxy());

    log_err!(tray::Tray::global().update_part());
    log_err!(hotkey::Hotkey::global().init());
    log_err!(timer::Timer::global().init());
}

/// reset system proxy
pub fn resolve_reset() {
    tauri::async_runtime::block_on(async move {
        #[cfg(target_os = "macos")]
        tray::Tray::global().unsubscribe_traffic();

        log_err!(sysopt::Sysopt::global().reset_sysproxy().await);
        log_err!(CoreManager::global().stop_core().await);
        #[cfg(target_os = "macos")]
        restore_public_dns().await;
    });
}

/// create main window
pub fn create_window() {
    let app_handle = handle::Handle::global().app_handle().unwrap();

    if let Some(window) = handle::Handle::global().get_window() {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    #[cfg(target_os = "windows")]
    let _ = tauri::WebviewWindowBuilder::new(
                &app_handle,
                "main".to_string(),
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Clash Verge")
            .visible(false)
            .inner_size(890.0, 700.0)
            .min_inner_size(620.0, 550.0)
            .decorations(false)
            .maximizable(true)
            .additional_browser_args("--enable-features=msWebView2EnableDraggableRegions --disable-features=OverscrollHistoryNavigation,msExperimentalScrolling")
            .transparent(true)
            .shadow(false)
            .build();

    #[cfg(target_os = "macos")]
    let _ = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "main".to_string(),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .decorations(true)
    .hidden_title(true)
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .inner_size(890.0, 700.0)
    .min_inner_size(620.0, 550.0)
    .build()
    .unwrap();

    #[cfg(target_os = "linux")]
    let _ = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "main".to_string(),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .decorations(false)
    .inner_size(890.0, 700.0)
    .min_inner_size(620.0, 550.0)
    .transparent(true)
    .build()
    .unwrap();
}

pub async fn resolve_scheme(param: String) -> Result<()> {
    log::info!(target:"app", "received deep link: {}", param);

    let app_handle = handle::Handle::global().app_handle().unwrap();

    let param_str = if param.starts_with("[") && param.len() > 4 {
        param
            .get(2..param.len() - 2)
            .ok_or_else(|| anyhow::anyhow!("Invalid string slice boundaries"))?
    } else {
        param.as_str()
    };

    // 解析 URL
    let link_parsed = match Url::parse(param_str) {
        Ok(url) => url,
        Err(e) => {
            bail!("failed to parse deep link: {:?}, param: {:?}", e, param);
        }
    };

    if link_parsed.scheme() == "clash" || link_parsed.scheme() == "clash-verge" {
        let name = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "name")
            .map(|(_, value)| value.into_owned());

        let encode_url = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "url")
            .map(|(_, value)| value.into_owned());

        match encode_url {
            Some(url) => {
                let url = percent_decode_str(url.as_ref())
                    .decode_utf8_lossy()
                    .to_string();

                create_window();
                match PrfItem::from_url(url.as_ref(), name, None, None).await {
                    Ok(item) => {
                        let uid = item.uid.clone().unwrap();
                        let _ = wrap_err!(Config::profiles().data().append_item(item));
                        handle::Handle::notice_message("import_sub_url::ok", uid);

                        app_handle
                            .notification()
                            .builder()
                            .title("Clash Verge")
                            .body("Import profile success")
                            .show()
                            .unwrap();
                    }
                    Err(e) => {
                        handle::Handle::notice_message("import_sub_url::error", e.to_string());
                        app_handle
                            .notification()
                            .builder()
                            .title("Clash Verge")
                            .body(format!("Import profile failed: {e}"))
                            .show()
                            .unwrap();
                    }
                }
            }
            None => bail!("failed to get profile url"),
        }
    }

    Ok(())
}

fn resolve_random_port_config() -> Result<()> {
    let verge_config = Config::verge();
    let clash_config = Config::clash();
    let enable_random_port = verge_config.latest().enable_random_port.unwrap_or(false);

    let default_port = verge_config
        .latest()
        .verge_mixed_port
        .unwrap_or(clash_config.data().get_mixed_port());

    let port = if enable_random_port {
        find_unused_port().unwrap_or(default_port)
    } else {
        default_port
    };

    verge_config.data().patch_config(IVerge {
        verge_mixed_port: Some(port),
        ..IVerge::default()
    });
    verge_config.data().save_file()?;

    let mut mapping = Mapping::new();
    mapping.insert("mixed-port".into(), port.into());
    clash_config.data().patch_config(mapping);
    clash_config.data().save_config()?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn set_public_dns(dns_server: String) {
    use crate::core::handle;
    use crate::utils::dirs;
    use tauri_plugin_shell::ShellExt;
    let app_handle = handle::Handle::global().app_handle().unwrap();

    log::info!(target: "app", "try to set system dns");
    let resource_dir = dirs::app_resources_dir().unwrap();
    let script = resource_dir.join("set_dns.sh");
    if !script.exists() {
        log::error!(target: "app", "set_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script, dns_server])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                log::info!(target: "app", "set system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                log::error!(target: "app", "set system dns failed: {code}");
            }
        }
        Err(err) => {
            log::error!(target: "app", "set system dns failed: {err}");
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn restore_public_dns() {
    use crate::core::handle;
    use crate::utils::dirs;
    use tauri_plugin_shell::ShellExt;
    let app_handle = handle::Handle::global().app_handle().unwrap();
    log::info!(target: "app", "try to unset system dns");
    let resource_dir = dirs::app_resources_dir().unwrap();
    let script = resource_dir.join("unset_dns.sh");
    if !script.exists() {
        log::error!(target: "app", "unset_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                log::info!(target: "app", "unset system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                log::error!(target: "app", "unset system dns failed: {code}");
            }
        }
        Err(err) => {
            log::error!(target: "app", "unset system dns failed: {err}");
        }
    }
}
