use rust_i18n::t;
use std::{borrow::Cow, sync::Arc};

fn to_arc_str(value: Cow<'static, str>) -> Arc<str> {
    match value {
        Cow::Borrowed(s) => Arc::from(s),
        Cow::Owned(s) => Arc::from(s.into_boxed_str()),
    }
}

macro_rules! define_menu {
    ($($field:ident => $const_name:ident, $id:expr, $text:expr),+ $(,)?) => {
        #[derive(Debug)]
        pub struct MenuTexts {
            $(pub $field: Arc<str>,)+
        }

        pub struct MenuIds;

        impl MenuTexts {
            pub fn new() -> Self {
                Self {
                    $($field: to_arc_str(t!($text)),)+
                }
            }
        }

        impl MenuIds {
            $(pub const $const_name: &'static str = $id;)+
        }
    };
}

define_menu! {
    dashboard => DASHBOARD, "tray_dashboard", "tray.dashboard",
    rule_mode => RULE_MODE, "tray_rule_mode", "tray.ruleMode",
    global_mode => GLOBAL_MODE, "tray_global_mode", "tray.globalMode",
    direct_mode => DIRECT_MODE, "tray_direct_mode", "tray.directMode",
    outbound_modes => OUTBOUND_MODES, "tray_outbound_modes", "tray.outboundModes",
    profiles => PROFILES, "tray_profiles", "tray.profiles",
    proxies => PROXIES, "tray_proxies", "tray.proxies",
    system_proxy => SYSTEM_PROXY, "tray_system_proxy", "tray.systemProxy",
    tun_mode => TUN_MODE, "tray_tun_mode", "tray.tunMode",
    close_all_connections => CLOSE_ALL_CONNECTIONS, "tray_close_all_connections", "tray.closeAllConnections",
    lightweight_mode => LIGHTWEIGHT_MODE, "tray_lightweight_mode", "tray.lightweightMode",
    copy_env => COPY_ENV, "tray_copy_env", "tray.copyEnv",
    conf_dir => CONF_DIR, "tray_conf_dir", "tray.confDir",
    core_dir => CORE_DIR, "tray_core_dir", "tray.coreDir",
    logs_dir => LOGS_DIR, "tray_logs_dir", "tray.logsDir",
    open_dir => OPEN_DIR, "tray_open_dir", "tray.openDir",
    app_log => APP_LOG, "tray_app_log", "tray.appLog",
    core_log => CORE_LOG, "tray_core_log", "tray.coreLog",
    restart_clash => RESTART_CLASH, "tray_restart_clash", "tray.restartClash",
    restart_app => RESTART_APP, "tray_restart_app", "tray.restartApp",
    verge_version => VERGE_VERSION, "tray_verge_version", "tray.vergeVersion",
    more => MORE, "tray_more", "tray.more",
    exit => EXIT, "tray_exit", "tray.exit",
}
