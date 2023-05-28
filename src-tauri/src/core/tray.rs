use crate::{cmds, config::Config, feat, utils::resolve};
use anyhow::Result;
use tauri::{
    api, AppHandle, CustomMenuItem, Manager, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
    SystemTraySubmenu,
};

pub struct Tray {}

impl Tray {
    pub fn tray_menu(app_handle: &AppHandle) -> SystemTrayMenu {
        let zh = { Config::verge().latest().language == Some("zh".into()) };

        let version = app_handle.package_info().version.to_string();

        if zh {
            SystemTrayMenu::new()
                .add_item(CustomMenuItem::new("open_window", "打开面板"))
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(CustomMenuItem::new("rule_mode", "规则模式"))
                .add_item(CustomMenuItem::new("global_mode", "全局模式"))
                .add_item(CustomMenuItem::new("direct_mode", "直连模式"))
                .add_item(CustomMenuItem::new("script_mode", "脚本模式"))
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(CustomMenuItem::new("system_proxy", "系统代理"))
                .add_item(CustomMenuItem::new("tun_mode", "TUN 模式"))
                .add_submenu(SystemTraySubmenu::new(
                    "打开目录",
                    SystemTrayMenu::new()
                        .add_item(CustomMenuItem::new("open_app_dir", "应用目录"))
                        .add_item(CustomMenuItem::new("open_core_dir", "内核目录"))
                        .add_item(CustomMenuItem::new("open_logs_dir", "日志目录")),
                ))
                .add_submenu(SystemTraySubmenu::new(
                    "更多",
                    SystemTrayMenu::new()
                        .add_item(CustomMenuItem::new("restart_clash", "重启 Clash"))
                        .add_item(CustomMenuItem::new("restart_app", "重启应用"))
                        .add_item(
                            CustomMenuItem::new("app_version", format!("Version {version}"))
                                .disabled(),
                        ),
                ))
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(CustomMenuItem::new("quit", "退出").accelerator("CmdOrControl+Q"))
        } else {
            SystemTrayMenu::new()
                .add_item(CustomMenuItem::new("open_window", "Dashboard"))
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(CustomMenuItem::new("rule_mode", "Rule Mode"))
                .add_item(CustomMenuItem::new("global_mode", "Global Mode"))
                .add_item(CustomMenuItem::new("direct_mode", "Direct Mode"))
                .add_item(CustomMenuItem::new("script_mode", "Script Mode"))
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(CustomMenuItem::new("system_proxy", "System Proxy"))
                .add_item(CustomMenuItem::new("tun_mode", "Tun Mode"))
                .add_submenu(SystemTraySubmenu::new(
                    "Open Dir",
                    SystemTrayMenu::new()
                        .add_item(CustomMenuItem::new("open_app_dir", "App Dir"))
                        .add_item(CustomMenuItem::new("open_core_dir", "Core Dir"))
                        .add_item(CustomMenuItem::new("open_logs_dir", "Logs Dir")),
                ))
                .add_submenu(SystemTraySubmenu::new(
                    "More",
                    SystemTrayMenu::new()
                        .add_item(CustomMenuItem::new("restart_clash", "Restart Clash"))
                        .add_item(CustomMenuItem::new("restart_app", "Restart App"))
                        .add_item(
                            CustomMenuItem::new("app_version", format!("Version {version}"))
                                .disabled(),
                        ),
                ))
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(CustomMenuItem::new("quit", "Quit").accelerator("CmdOrControl+Q"))
        }
    }

    pub fn update_systray(app_handle: &AppHandle) -> Result<()> {
        app_handle
            .tray_handle()
            .set_menu(Tray::tray_menu(app_handle))?;
        Tray::update_part(app_handle)?;
        Ok(())
    }

    pub fn update_part(app_handle: &AppHandle) -> Result<()> {
        let mode = {
            Config::clash()
                .latest()
                .0
                .get("mode")
                .map(|val| val.as_str().unwrap_or("rule"))
                .unwrap_or("rule")
                .to_owned()
        };

        let tray = app_handle.tray_handle();

        let _ = tray.get_item("rule_mode").set_selected(mode == "rule");
        let _ = tray.get_item("global_mode").set_selected(mode == "global");
        let _ = tray.get_item("direct_mode").set_selected(mode == "direct");
        let _ = tray.get_item("script_mode").set_selected(mode == "script");

        let verge = Config::verge();
        let verge = verge.latest();
        let system_proxy = verge.enable_system_proxy.as_ref().unwrap_or(&false);
        let tun_mode = verge.enable_tun_mode.as_ref().unwrap_or(&false);

        #[cfg(target_os = "windows")]
        {
            let indication_icon = if *system_proxy {
                include_bytes!("../../icons/tray-icon-activated.png").to_vec()
            } else {
                include_bytes!("../../icons/tray-icon.png").to_vec()
            };

            let _ = tray.set_icon(tauri::Icon::Raw(indication_icon));
        }

        let _ = tray.get_item("system_proxy").set_selected(*system_proxy);
        let _ = tray.get_item("tun_mode").set_selected(*tun_mode);

        Ok(())
    }

    pub fn on_system_tray_event(app_handle: &AppHandle, event: SystemTrayEvent) {
        match event {
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                mode @ ("rule_mode" | "global_mode" | "direct_mode" | "script_mode") => {
                    let mode = &mode[0..mode.len() - 5];
                    feat::change_clash_mode(mode.into());
                }

                "open_window" => resolve::create_window(app_handle),
                "system_proxy" => feat::toggle_system_proxy(),
                "tun_mode" => feat::toggle_tun_mode(),
                "open_app_dir" => crate::log_err!(cmds::open_app_dir()),
                "open_core_dir" => crate::log_err!(cmds::open_core_dir()),
                "open_logs_dir" => crate::log_err!(cmds::open_logs_dir()),
                "restart_clash" => feat::restart_clash_core(),
                "restart_app" => api::process::restart(&app_handle.env()),
                "quit" => {
                    resolve::resolve_reset();
                    api::process::kill_children();
                    app_handle.exit(0);
                    std::process::exit(0);
                }
                _ => {}
            },
            #[cfg(target_os = "windows")]
            SystemTrayEvent::LeftClick { .. } => {
                resolve::create_window(app_handle);
            }
            _ => {}
        }
    }
}
