use crate::config::DEFAULT_PAC;
use crate::config::{deserialize_encrypted, serialize_encrypted};
use crate::utils::i18n;
use crate::utils::{dirs, help};
use anyhow::Result;
use log::LevelFilter;
use serde::{Deserialize, Serialize};

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IVerge {
    /// app log level
    /// silent | error | warn | info | debug | trace
    pub app_log_level: Option<String>,

    // i18n
    pub language: Option<String>,

    /// `light` or `dark` or `system`
    pub theme_mode: Option<String>,

    /// tray click event
    pub tray_event: Option<String>,

    /// copy env type
    pub env_type: Option<String>,

    /// start page
    pub start_page: Option<String>,
    /// startup script path
    pub startup_script: Option<String>,

    /// enable traffic graph default is true
    pub traffic_graph: Option<bool>,

    /// show memory info (only for Clash Meta)
    pub enable_memory_usage: Option<bool>,

    /// enable group icon
    pub enable_group_icon: Option<bool>,

    /// common tray icon
    pub common_tray_icon: Option<bool>,

    /// tray icon
    #[cfg(target_os = "macos")]
    pub tray_icon: Option<String>,

    /// menu icon
    pub menu_icon: Option<String>,

    /// sysproxy tray icon
    pub sysproxy_tray_icon: Option<bool>,

    /// tun tray icon
    pub tun_tray_icon: Option<bool>,

    /// clash tun mode
    pub enable_tun_mode: Option<bool>,

    /// can the app auto startup
    pub enable_auto_launch: Option<bool>,

    /// not show the window on launch
    pub enable_silent_start: Option<bool>,

    /// set system proxy
    pub enable_system_proxy: Option<bool>,

    /// enable proxy guard
    pub enable_proxy_guard: Option<bool>,

    /// always use default bypass
    pub use_default_bypass: Option<bool>,

    /// set system proxy bypass
    pub system_proxy_bypass: Option<String>,

    /// proxy guard duration
    pub proxy_guard_duration: Option<u64>,

    /// use pac mode
    pub proxy_auto_config: Option<bool>,

    /// pac script content
    pub pac_file_content: Option<String>,

    /// theme setting
    pub theme_setting: Option<IVergeTheme>,

    /// web ui list
    pub web_ui_list: Option<Vec<String>>,

    /// clash core path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clash_core: Option<String>,

    /// hotkey map
    /// format: {func},{key}
    pub hotkeys: Option<Vec<String>>,

    /// 切换代理时自动关闭连接
    pub auto_close_connection: Option<bool>,

    /// 是否自动检查更新
    pub auto_check_update: Option<bool>,

    /// 默认的延迟测试连接
    pub default_latency_test: Option<String>,

    /// 默认的延迟测试超时时间
    pub default_latency_timeout: Option<i32>,

    /// 是否使用内部的脚本支持，默认为真
    pub enable_builtin_enhanced: Option<bool>,

    /// proxy 页面布局 列数
    pub proxy_layout_column: Option<i32>,

    /// 测试站列表
    pub test_list: Option<Vec<IVergeTestItem>>,

    /// 日志清理
    /// 0: 不清理; 1: 7天; 2: 30天; 3: 90天
    pub auto_log_clean: Option<i32>,

    /// 是否启用随机端口
    pub enable_random_port: Option<bool>,

    /// verge 的各种 port 用于覆盖 clash 的各种 port
    #[cfg(not(target_os = "windows"))]
    pub verge_redir_port: Option<u16>,

    #[cfg(not(target_os = "windows"))]
    pub verge_redir_enabled: Option<bool>,

    #[cfg(target_os = "linux")]
    pub verge_tproxy_port: Option<u16>,

    #[cfg(target_os = "linux")]
    pub verge_tproxy_enabled: Option<bool>,

    pub verge_mixed_port: Option<u16>,

    pub verge_socks_port: Option<u16>,

    pub verge_socks_enabled: Option<bool>,

    pub verge_port: Option<u16>,

    pub verge_http_enabled: Option<bool>,

    /// WebDAV 配置 (加密存储)
    #[serde(
        serialize_with = "serialize_encrypted",
        deserialize_with = "deserialize_encrypted",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub webdav_url: Option<String>,

    /// WebDAV 用户名 (加密存储)
    #[serde(
        serialize_with = "serialize_encrypted",
        deserialize_with = "deserialize_encrypted",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub webdav_username: Option<String>,

    /// WebDAV 密码 (加密存储)
    #[serde(
        serialize_with = "serialize_encrypted",
        deserialize_with = "deserialize_encrypted",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub webdav_password: Option<String>,

    pub enable_tray_speed: Option<bool>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IVergeTestItem {
    pub uid: Option<String>,
    pub name: Option<String>,
    pub icon: Option<String>,
    pub url: Option<String>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IVergeTheme {
    pub primary_color: Option<String>,
    pub secondary_color: Option<String>,
    pub primary_text: Option<String>,
    pub secondary_text: Option<String>,

    pub info_color: Option<String>,
    pub error_color: Option<String>,
    pub warning_color: Option<String>,
    pub success_color: Option<String>,

    pub font_family: Option<String>,
    pub css_injection: Option<String>,
}

impl IVerge {
    fn get_system_language() -> String {
        let sys_lang = sys_locale::get_locale()
            .unwrap_or_else(|| String::from("en"))
            .to_lowercase();

        let lang_code = sys_lang.split(['_', '-']).next().unwrap_or("en");
        let supported_languages = i18n::get_supported_languages();

        if supported_languages.contains(&lang_code.to_string()) {
            lang_code.to_string()
        } else {
            String::from("en")
        }
    }

    pub fn new() -> Self {
        match dirs::verge_path().and_then(|path| help::read_yaml::<IVerge>(&path)) {
            Ok(config) => config,
            Err(err) => {
                log::error!(target: "app", "{err}");
                Self::template()
            }
        }
    }

    pub fn template() -> Self {
        Self {
            clash_core: Some("verge-mihomo".into()),
            language: Some(Self::get_system_language()),
            theme_mode: Some("system".into()),
            #[cfg(not(target_os = "windows"))]
            env_type: Some("bash".into()),
            #[cfg(target_os = "windows")]
            env_type: Some("powershell".into()),
            start_page: Some("/".into()),
            traffic_graph: Some(true),
            enable_memory_usage: Some(true),
            enable_group_icon: Some(true),
            #[cfg(target_os = "macos")]
            tray_icon: Some("monochrome".into()),
            menu_icon: Some("monochrome".into()),
            common_tray_icon: Some(false),
            sysproxy_tray_icon: Some(false),
            tun_tray_icon: Some(false),
            enable_auto_launch: Some(false),
            enable_silent_start: Some(false),
            enable_system_proxy: Some(false),
            proxy_auto_config: Some(false),
            pac_file_content: Some(DEFAULT_PAC.into()),
            enable_random_port: Some(false),
            #[cfg(not(target_os = "windows"))]
            verge_redir_port: Some(7895),
            #[cfg(not(target_os = "windows"))]
            verge_redir_enabled: Some(false),
            #[cfg(target_os = "linux")]
            verge_tproxy_port: Some(7896),
            #[cfg(target_os = "linux")]
            verge_tproxy_enabled: Some(false),
            verge_mixed_port: Some(7897),
            verge_socks_port: Some(7898),
            verge_socks_enabled: Some(false),
            verge_port: Some(7899),
            verge_http_enabled: Some(false),
            enable_proxy_guard: Some(false),
            use_default_bypass: Some(true),
            proxy_guard_duration: Some(30),
            auto_close_connection: Some(true),
            auto_check_update: Some(true),
            enable_builtin_enhanced: Some(true),
            auto_log_clean: Some(3),
            webdav_url: None,
            webdav_username: None,
            webdav_password: None,
            enable_tray_speed: Some(true),
            ..Self::default()
        }
    }

    /// Save IVerge App Config
    pub fn save_file(&self) -> Result<()> {
        help::save_yaml(&dirs::verge_path()?, &self, Some("# Clash Verge Config"))
    }

    /// patch verge config
    /// only save to file
    pub fn patch_config(&mut self, patch: IVerge) {
        macro_rules! patch {
            ($key: tt) => {
                if patch.$key.is_some() {
                    self.$key = patch.$key;
                }
            };
        }

        patch!(app_log_level);
        patch!(language);
        patch!(theme_mode);
        patch!(tray_event);
        patch!(env_type);
        patch!(start_page);
        patch!(startup_script);
        patch!(traffic_graph);
        patch!(enable_memory_usage);
        patch!(enable_group_icon);
        #[cfg(target_os = "macos")]
        patch!(tray_icon);
        patch!(menu_icon);
        patch!(common_tray_icon);
        patch!(sysproxy_tray_icon);
        patch!(tun_tray_icon);

        patch!(enable_tun_mode);
        patch!(enable_auto_launch);
        patch!(enable_silent_start);
        patch!(enable_random_port);
        #[cfg(not(target_os = "windows"))]
        patch!(verge_redir_port);
        #[cfg(not(target_os = "windows"))]
        patch!(verge_redir_enabled);
        #[cfg(target_os = "linux")]
        patch!(verge_tproxy_port);
        #[cfg(target_os = "linux")]
        patch!(verge_tproxy_enabled);
        patch!(verge_mixed_port);
        patch!(verge_socks_port);
        patch!(verge_socks_enabled);
        patch!(verge_port);
        patch!(verge_http_enabled);
        patch!(enable_system_proxy);
        patch!(enable_proxy_guard);
        patch!(use_default_bypass);
        patch!(system_proxy_bypass);
        patch!(proxy_guard_duration);
        patch!(proxy_auto_config);
        patch!(pac_file_content);

        patch!(theme_setting);
        patch!(web_ui_list);
        patch!(clash_core);
        patch!(hotkeys);

        patch!(auto_close_connection);
        patch!(auto_check_update);
        patch!(default_latency_test);
        patch!(default_latency_timeout);
        patch!(enable_builtin_enhanced);
        patch!(proxy_layout_column);
        patch!(test_list);
        patch!(auto_log_clean);

        patch!(webdav_url);
        patch!(webdav_username);
        patch!(webdav_password);
        patch!(enable_tray_speed);
    }

    /// 在初始化前尝试拿到单例端口的值
    pub fn get_singleton_port() -> u16 {
        #[cfg(not(feature = "verge-dev"))]
        const SERVER_PORT: u16 = 33331;
        #[cfg(feature = "verge-dev")]
        const SERVER_PORT: u16 = 11233;
        SERVER_PORT
    }

    /// 获取日志等级
    pub fn get_log_level(&self) -> LevelFilter {
        if let Some(level) = self.app_log_level.as_ref() {
            match level.to_lowercase().as_str() {
                "silent" => LevelFilter::Off,
                "error" => LevelFilter::Error,
                "warn" => LevelFilter::Warn,
                "info" => LevelFilter::Info,
                "debug" => LevelFilter::Debug,
                "trace" => LevelFilter::Trace,
                _ => LevelFilter::Info,
            }
        } else {
            LevelFilter::Info
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct IVergeResponse {
    pub app_log_level: Option<String>,
    pub language: Option<String>,
    pub theme_mode: Option<String>,
    pub tray_event: Option<String>,
    pub env_type: Option<String>,
    pub start_page: Option<String>,
    pub startup_script: Option<String>,
    pub traffic_graph: Option<bool>,
    pub enable_memory_usage: Option<bool>,
    pub enable_group_icon: Option<bool>,
    pub common_tray_icon: Option<bool>,
    #[cfg(target_os = "macos")]
    pub tray_icon: Option<String>,
    pub menu_icon: Option<String>,
    pub sysproxy_tray_icon: Option<bool>,
    pub tun_tray_icon: Option<bool>,
    pub enable_tun_mode: Option<bool>,
    pub enable_auto_launch: Option<bool>,
    pub enable_silent_start: Option<bool>,
    pub enable_system_proxy: Option<bool>,
    pub enable_proxy_guard: Option<bool>,
    pub use_default_bypass: Option<bool>,
    pub system_proxy_bypass: Option<String>,
    pub proxy_guard_duration: Option<u64>,
    pub proxy_auto_config: Option<bool>,
    pub pac_file_content: Option<String>,
    pub theme_setting: Option<IVergeTheme>,
    pub web_ui_list: Option<Vec<String>>,
    pub clash_core: Option<String>,
    pub hotkeys: Option<Vec<String>>,
    pub auto_close_connection: Option<bool>,
    pub auto_check_update: Option<bool>,
    pub default_latency_test: Option<String>,
    pub default_latency_timeout: Option<i32>,
    pub enable_builtin_enhanced: Option<bool>,
    pub proxy_layout_column: Option<i32>,
    pub test_list: Option<Vec<IVergeTestItem>>,
    pub auto_log_clean: Option<i32>,
    pub enable_random_port: Option<bool>,
    #[cfg(not(target_os = "windows"))]
    pub verge_redir_port: Option<u16>,
    #[cfg(not(target_os = "windows"))]
    pub verge_redir_enabled: Option<bool>,
    #[cfg(target_os = "linux")]
    pub verge_tproxy_port: Option<u16>,
    #[cfg(target_os = "linux")]
    pub verge_tproxy_enabled: Option<bool>,
    pub verge_mixed_port: Option<u16>,
    pub verge_socks_port: Option<u16>,
    pub verge_socks_enabled: Option<bool>,
    pub verge_port: Option<u16>,
    pub verge_http_enabled: Option<bool>,
    pub webdav_url: Option<String>,
    pub webdav_username: Option<String>,
    pub webdav_password: Option<String>,
    pub enable_tray_speed: Option<bool>,
}

impl From<IVerge> for IVergeResponse {
    fn from(verge: IVerge) -> Self {
        Self {
            app_log_level: verge.app_log_level,
            language: verge.language,
            theme_mode: verge.theme_mode,
            tray_event: verge.tray_event,
            env_type: verge.env_type,
            start_page: verge.start_page,
            startup_script: verge.startup_script,
            traffic_graph: verge.traffic_graph,
            enable_memory_usage: verge.enable_memory_usage,
            enable_group_icon: verge.enable_group_icon,
            common_tray_icon: verge.common_tray_icon,
            #[cfg(target_os = "macos")]
            tray_icon: verge.tray_icon,
            menu_icon: verge.menu_icon,
            sysproxy_tray_icon: verge.sysproxy_tray_icon,
            tun_tray_icon: verge.tun_tray_icon,
            enable_tun_mode: verge.enable_tun_mode,
            enable_auto_launch: verge.enable_auto_launch,
            enable_silent_start: verge.enable_silent_start,
            enable_system_proxy: verge.enable_system_proxy,
            enable_proxy_guard: verge.enable_proxy_guard,
            use_default_bypass: verge.use_default_bypass,
            system_proxy_bypass: verge.system_proxy_bypass,
            proxy_guard_duration: verge.proxy_guard_duration,
            proxy_auto_config: verge.proxy_auto_config,
            pac_file_content: verge.pac_file_content,
            theme_setting: verge.theme_setting,
            web_ui_list: verge.web_ui_list,
            clash_core: verge.clash_core,
            hotkeys: verge.hotkeys,
            auto_close_connection: verge.auto_close_connection,
            auto_check_update: verge.auto_check_update,
            default_latency_test: verge.default_latency_test,
            default_latency_timeout: verge.default_latency_timeout,
            enable_builtin_enhanced: verge.enable_builtin_enhanced,
            proxy_layout_column: verge.proxy_layout_column,
            test_list: verge.test_list,
            auto_log_clean: verge.auto_log_clean,
            enable_random_port: verge.enable_random_port,
            #[cfg(not(target_os = "windows"))]
            verge_redir_port: verge.verge_redir_port,
            #[cfg(not(target_os = "windows"))]
            verge_redir_enabled: verge.verge_redir_enabled,
            #[cfg(target_os = "linux")]
            verge_tproxy_port: verge.verge_tproxy_port,
            #[cfg(target_os = "linux")]
            verge_tproxy_enabled: verge.verge_tproxy_enabled,
            verge_mixed_port: verge.verge_mixed_port,
            verge_socks_port: verge.verge_socks_port,
            verge_socks_enabled: verge.verge_socks_enabled,
            verge_port: verge.verge_port,
            verge_http_enabled: verge.verge_http_enabled,
            webdav_url: verge.webdav_url,
            webdav_username: verge.webdav_username,
            webdav_password: verge.webdav_password,
            enable_tray_speed: verge.enable_tray_speed,
        }
    }
}
