use crate::utils::i18n::t;
use std::sync::Arc;

macro_rules! define_menu {
    ($($field:ident => $const_name:ident, $id:expr, $text:expr),+ $(,)?) => {
        #[derive(Debug)]
        pub struct MenuTexts {
            $(pub $field: Arc<str>,)+
        }

        pub struct MenuIds;

        impl MenuTexts {
            pub async fn new() -> Self {
                let ($($field,)+) = futures::join!($(t($text),)+);
                Self { $($field,)+ }
            }
        }

        impl MenuIds {
            $(pub const $const_name: &'static str = $id;)+
        }
    };
}

define_menu! {
    dashboard => DASHBOARD, "tray_dashboard", "Dashboard",
    rule_mode => RULE_MODE, "tray_rule_mode", "Rule Mode",
    global_mode => GLOBAL_MODE, "tray_global_mode", "Global Mode",
    direct_mode => DIRECT_MODE, "tray_direct_mode", "Direct Mode",
    profiles => PROFILES, "tray_profiles", "Profiles",
    proxies => PROXIES, "tray_proxies", "Proxies",
    system_proxy => SYSTEM_PROXY, "tray_system_proxy", "System Proxy",
    tun_mode => TUN_MODE, "tray_tun_mode", "TUN Mode",
    close_all_connections => CLOSE_ALL_CONNECTIONS, "tray_close_all_connections", "Close All Connections",
    lightweight_mode => LIGHTWEIGHT_MODE, "tray_lightweight_mode", "LightWeight Mode",
    copy_env => COPY_ENV, "tray_copy_env", "Copy Env",
    conf_dir => CONF_DIR, "tray_conf_dir", "Conf Dir",
    core_dir => CORE_DIR, "tray_core_dir", "Core Dir",
    logs_dir => LOGS_DIR, "tray_logs_dir", "Logs Dir",
    open_dir => OPEN_DIR, "tray_open_dir", "Open Dir",
    app_log => APP_LOG, "tray_app_log", "Open App Log",
    core_log => CORE_LOG, "tray_core_log", "Open Core Log",
    restart_clash => RESTART_CLASH, "tray_restart_clash", "Restart Clash Core",
    restart_app => RESTART_APP, "tray_restart_app", "Restart App",
    verge_version => VERGE_VERSION, "tray_verge_version", "Verge Version",
    more => MORE, "tray_more", "More",
    exit => EXIT, "tray_exit", "Exit",
}
