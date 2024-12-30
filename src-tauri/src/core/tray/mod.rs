pub mod speed_rate;
use speed_rate::Rate;
pub use speed_rate::{SpeedRate, Traffic};

use crate::utils::dirs;
use crate::{
    cmds,
    config::Config,
    feat, t,
    utils::resolve::{self, VERSION},
};
use anyhow::Result;
use futures::StreamExt;
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::{
    menu::CheckMenuItem,
    tray::{MouseButton, MouseButtonState, TrayIconEvent, TrayIconId},
};
use tauri::{
    menu::{MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    Wry,
};
use tokio::sync::broadcast;

use super::handle;
pub struct Tray {
    pub speed_rate: Arc<Mutex<Option<SpeedRate>>>,
    #[cfg(target_os = "macos")]
    shutdown_tx: Arc<RwLock<Option<broadcast::Sender<()>>>>,
}

impl Tray {
    pub fn global() -> &'static Tray {
        static TRAY: OnceCell<Tray> = OnceCell::new();

        TRAY.get_or_init(|| Tray {
            speed_rate: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "macos")]
            shutdown_tx: Arc::new(RwLock::new(None)),
        })
    }

    pub fn init(&self) -> Result<()> {
        let mut speed_rate = self.speed_rate.lock();
        *speed_rate = Some(SpeedRate::new());
        Ok(())
    }

    pub fn create_systray(&self) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let tray_incon_id = TrayIconId::new("main");
        let tray = app_handle.tray_by_id(&tray_incon_id).unwrap();

        tray.on_tray_icon_event(|_, event| {
            let tray_event = { Config::verge().latest().tray_event.clone() };
            let tray_event: String = tray_event.unwrap_or("main_window".into());

            #[cfg(target_os = "macos")]
            if let TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: MouseButtonState::Down,
                ..
            } = event
            {
                match tray_event.as_str() {
                    "system_proxy" => feat::toggle_system_proxy(),
                    "tun_mode" => feat::toggle_tun_mode(),
                    "main_window" => resolve::create_window(),
                    _ => {}
                }
            }

            #[cfg(not(target_os = "macos"))]
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Down,
                ..
            } = event
            {
                match tray_event.as_str() {
                    "system_proxy" => feat::toggle_system_proxy(),
                    "tun_mode" => feat::toggle_tun_mode(),
                    "main_window" => resolve::create_window(),
                    _ => {}
                }
            }
        });
        tray.on_menu_event(on_menu_event);
        Ok(())
    }

    /// 更新托盘菜单
    pub fn update_menu(&self) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let verge = Config::verge().latest().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let mode = {
            Config::clash()
                .latest()
                .0
                .get("mode")
                .map(|val| val.as_str().unwrap_or("rule"))
                .unwrap_or("rule")
                .to_owned()
        };

        let tray = app_handle.tray_by_id("main").unwrap();
        let _ = tray.set_menu(Some(create_tray_menu(
            &app_handle,
            Some(mode.as_str()),
            *system_proxy,
            *tun_mode,
        )?));
        Ok(())
    }

    /// 更新托盘图标
    pub fn update_icon(&self, rate: Option<Rate>) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let verge = Config::verge().latest().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let common_tray_icon = verge.common_tray_icon.as_ref().unwrap_or(&false);
        let sysproxy_tray_icon = verge.sysproxy_tray_icon.as_ref().unwrap_or(&false);
        let tun_tray_icon = verge.tun_tray_icon.as_ref().unwrap_or(&false);

        let tray = app_handle.tray_by_id("main").unwrap();

        #[cfg(target_os = "macos")]
        let tray_icon = verge.tray_icon.clone().unwrap_or("monochrome".to_string());

        let icon_bytes = if *system_proxy && !*tun_mode {
            #[cfg(target_os = "macos")]
            let mut icon = match tray_icon.as_str() {
                "colorful" => include_bytes!("../../../icons/tray-icon-sys.ico").to_vec(),
                _ => include_bytes!("../../../icons/tray-icon-sys-mono.ico").to_vec(),
            };

            #[cfg(not(target_os = "macos"))]
            let mut icon = include_bytes!("../../../icons/tray-icon-sys.ico").to_vec();
            if *sysproxy_tray_icon {
                let icon_dir_path = dirs::app_home_dir()?.join("icons");
                let png_path = icon_dir_path.join("sysproxy.png");
                let ico_path = icon_dir_path.join("sysproxy.ico");
                if ico_path.exists() {
                    icon = std::fs::read(ico_path).unwrap();
                } else if png_path.exists() {
                    icon = std::fs::read(png_path).unwrap();
                }
            }
            icon
        } else if *tun_mode {
            #[cfg(target_os = "macos")]
            let mut icon = match tray_icon.as_str() {
                "colorful" => include_bytes!("../../../icons/tray-icon-tun.ico").to_vec(),
                _ => include_bytes!("../../../icons/tray-icon-tun-mono.ico").to_vec(),
            };

            #[cfg(not(target_os = "macos"))]
            let mut icon = include_bytes!("../../icons/tray-icon-tun.ico").to_vec();
            if *tun_tray_icon {
                let icon_dir_path = dirs::app_home_dir()?.join("icons");
                let png_path = icon_dir_path.join("tun.png");
                let ico_path = icon_dir_path.join("tun.ico");
                if ico_path.exists() {
                    icon = std::fs::read(ico_path).unwrap();
                } else if png_path.exists() {
                    icon = std::fs::read(png_path).unwrap();
                }
            }
            icon
        } else {
            #[cfg(target_os = "macos")]
            let mut icon = match tray_icon.as_str() {
                "colorful" => include_bytes!("../../../icons/tray-icon.ico").to_vec(),
                _ => include_bytes!("../../../icons/tray-icon-mono.ico").to_vec(),
            };

            #[cfg(not(target_os = "macos"))]
            let mut icon = include_bytes!("../../icons/tray-icon.ico").to_vec();
            if *common_tray_icon {
                let icon_dir_path = dirs::app_home_dir()?.join("icons");
                let png_path = icon_dir_path.join("common.png");
                let ico_path = icon_dir_path.join("common.ico");
                if ico_path.exists() {
                    icon = std::fs::read(ico_path).unwrap();
                } else if png_path.exists() {
                    icon = std::fs::read(png_path).unwrap();
                }
            }
            icon
        };

        #[cfg(target_os = "macos")]
        {
            let is_template =
                crate::utils::help::is_monochrome_image_from_bytes(&icon_bytes).unwrap_or(false);
            // 如果rate为None，获取当前速率
            let rate = rate.or_else(|| {
                self.speed_rate
                    .lock()
                    .as_ref()
                    .and_then(|speed_rate| speed_rate.get_curent_rate())
            });
            let icon_bytes = SpeedRate::add_speed_text(icon_bytes, rate)?;
            let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));
            let _ = tray.set_icon_as_template(is_template);
        }

        #[cfg(not(target_os = "macos"))]
        let _ = tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?));

        Ok(())
    }

    /// 更新托盘提示
    pub fn update_tooltip(&self) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let use_zh = { Config::verge().latest().language == Some("zh".into()) };
        let version = VERSION.get().unwrap();

        let verge = Config::verge().latest().clone();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        let switch_map = {
            let mut map = std::collections::HashMap::new();
            map.insert(true, "on");
            map.insert(false, "off");
            map
        };

        let mut current_profile_name = "None".to_string();
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        if let Some(current_profile_uid) = profiles.get_current() {
            let current_profile = profiles.get_item(&current_profile_uid);
            current_profile_name = match &current_profile.unwrap().name {
                Some(profile_name) => profile_name.to_string(),
                None => current_profile_name,
            };
        };

        let tray = app_handle.tray_by_id("main").unwrap();
        let _ = tray.set_tooltip(Some(&format!(
            "Clash Verge {version}\n{}: {}\n{}: {}\n{}: {}",
            t!("SysProxy", "系统代理", use_zh),
            switch_map[system_proxy],
            t!("TUN", "Tun模式", use_zh),
            switch_map[tun_mode],
            t!("Profile", "当前订阅", use_zh),
            current_profile_name
        )));
        Ok(())
    }

    pub fn update_part(&self) -> Result<()> {
        self.update_menu()?;
        self.update_icon(None)?;
        self.update_tooltip()?;
        Ok(())
    }

    /// 订阅流量数据
    #[cfg(target_os = "macos")]
    pub async fn subscribe_traffic(&self) -> Result<()> {
        log::info!(target: "app", "subscribe traffic");
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        *self.shutdown_tx.write() = Some(shutdown_tx);

        let speed_rate = Arc::clone(&self.speed_rate);

        tauri::async_runtime::spawn(async move {
            let mut shutdown = shutdown_rx;
            if let Ok(mut stream) = Traffic::get_traffic_stream().await {
                loop {
                    tokio::select! {
                        Some(traffic) = stream.next() => {
                            if let Ok(traffic) = traffic {
                                let guard = speed_rate.lock();
                                if let Some(sr) = guard.as_ref() {
                                    if let Some(rate) = sr.update_and_check_changed(traffic.up, traffic.down) {
                                        let _ = Tray::global().update_icon(Some(rate));
                                    }
                                }
                            }
                        }
                        _ = shutdown.recv() => break,
                    }
                }
            }
        });

        Ok(())
    }

    /// 取消订阅 traffic 数据
    #[cfg(target_os = "macos")]
    #[allow(unused)]
    pub fn unsubscribe_traffic(&self) {
        log::info!(target: "app", "unsubscribe traffic");
        if let Some(tx) = self.shutdown_tx.write().take() {
            drop(tx); // 发送端被丢弃时会自动发送关闭信号
        }
    }
}

fn create_tray_menu(
    app_handle: &AppHandle,
    mode: Option<&str>,
    system_proxy_enabled: bool,
    tun_mode_enabled: bool,
) -> Result<tauri::menu::Menu<Wry>> {
    let mode = mode.unwrap_or("");
    let use_zh = { Config::verge().latest().language == Some("zh".into()) };
    let version = VERSION.get().unwrap();

    let open_window = &MenuItem::with_id(
        app_handle,
        "open_window",
        t!("Dashboard", "打开面板", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let rule_mode = &CheckMenuItem::with_id(
        app_handle,
        "rule_mode",
        t!("Rule Mode", "规则模式", use_zh),
        true,
        mode == "rule",
        None::<&str>,
    )
    .unwrap();

    let global_mode = &CheckMenuItem::with_id(
        app_handle,
        "global_mode",
        t!("Global Mode", "全局模式", use_zh),
        true,
        mode == "global",
        None::<&str>,
    )
    .unwrap();

    let direct_mode = &CheckMenuItem::with_id(
        app_handle,
        "direct_mode",
        t!("Direct Mode", "直连模式", use_zh),
        true,
        mode == "direct",
        None::<&str>,
    )
    .unwrap();

    let system_proxy = &CheckMenuItem::with_id(
        app_handle,
        "system_proxy",
        t!("System Proxy", "系统代理", use_zh),
        true,
        system_proxy_enabled,
        None::<&str>,
    )
    .unwrap();

    let tun_mode = &CheckMenuItem::with_id(
        app_handle,
        "tun_mode",
        t!("TUN Mode", "Tun模式", use_zh),
        true,
        tun_mode_enabled,
        None::<&str>,
    )
    .unwrap();

    let copy_env = &MenuItem::with_id(
        app_handle,
        "copy_env",
        t!("Copy Env", "复制环境变量", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let open_app_dir = &MenuItem::with_id(
        app_handle,
        "open_app_dir",
        t!("Conf Dir", "配置目录", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let open_core_dir = &MenuItem::with_id(
        app_handle,
        "open_core_dir",
        t!("Core Dir", "内核目录", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let open_logs_dir = &MenuItem::with_id(
        app_handle,
        "open_logs_dir",
        t!("Logs Dir", "日志目录", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();
    let open_dir = &Submenu::with_id_and_items(
        app_handle,
        "open_dir",
        t!("Open Dir", "打开目录", use_zh),
        true,
        &[open_app_dir, open_core_dir, open_logs_dir],
    )
    .unwrap();

    let restart_clash = &MenuItem::with_id(
        app_handle,
        "restart_clash",
        t!("Restart Clash Core", "重启Clash内核", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let restart_app = &MenuItem::with_id(
        app_handle,
        "restart_app",
        t!("Restart App", "重启App", use_zh),
        true,
        None::<&str>,
    )
    .unwrap();

    let app_version = &MenuItem::with_id(
        app_handle,
        "app_version",
        format!("Version {version}"),
        true,
        None::<&str>,
    )
    .unwrap();

    let more = &Submenu::with_id_and_items(
        app_handle,
        "more",
        t!("More", "更多", use_zh),
        true,
        &[restart_clash, restart_app, app_version],
    )
    .unwrap();

    let quit = &MenuItem::with_id(
        app_handle,
        "quit",
        t!("Quit", "退出", use_zh),
        true,
        Some("CmdOrControl+Q"),
    )
    .unwrap();

    let separator = &PredefinedMenuItem::separator(app_handle).unwrap();

    let menu = tauri::menu::MenuBuilder::new(app_handle)
        .items(&[
            open_window,
            separator,
            rule_mode,
            global_mode,
            direct_mode,
            separator,
            system_proxy,
            tun_mode,
            copy_env,
            open_dir,
            more,
            separator,
            quit,
        ])
        .build()
        .unwrap();
    Ok(menu)
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        mode @ ("rule_mode" | "global_mode" | "direct_mode") => {
            let mode = &mode[0..mode.len() - 5];
            println!("change mode to: {}", mode);
            feat::change_clash_mode(mode.into());
        }
        "open_window" => resolve::create_window(),
        "system_proxy" => feat::toggle_system_proxy(),
        "tun_mode" => feat::toggle_tun_mode(),
        "copy_env" => feat::copy_clash_env(),
        "open_app_dir" => crate::log_err!(cmds::open_app_dir()),
        "open_core_dir" => crate::log_err!(cmds::open_core_dir()),
        "open_logs_dir" => crate::log_err!(cmds::open_logs_dir()),
        "restart_clash" => feat::restart_clash_core(),
        "restart_app" => feat::restart_app(),
        "quit" => {
            println!("quit");
            feat::quit(Some(0));
        }
        _ => {}
    }
}
