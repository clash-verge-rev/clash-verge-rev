use crate::config::DEFAULT_PAC;
use crate::utils::{dirs, help};
use anyhow::Result;
use log::LevelFilter;
use serde::{Deserialize, Serialize};

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IVerge {
    /// app listening port for app singleton
    pub app_singleton_port: Option<u16>,

    /// app log level
    /// silent | error | warn | info | debug | trace
    pub app_log_level: Option<String>,

    // i18n (now supported): zh | en | ru | fa
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

    /// windows service mode
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_service_mode: Option<bool>,

    /// can the app auto startup
    pub enable_auto_launch: Option<bool>,

    /// 是否启用系统标题栏
    #[serde(alias = "enable_system_title", alias = "enable_system_title_bar")]
    pub enable_system_title_bar: Option<bool>,

    /// 是否保持UI界面活动
    pub enable_keep_ui_active: Option<bool>,

    /// 是否开启启动页
    pub enable_splashscreen: Option<bool>,

    /// not show the window on launch
    pub enable_silent_start: Option<bool>,

    /// set system proxy
    pub enable_system_proxy: Option<bool>,

    /// enable proxy guard
    pub enable_proxy_guard: Option<bool>,

    /// set system proxy bypass
    pub system_proxy_bypass: Option<String>,

    /// proxy guard duration
    pub proxy_guard_duration: Option<u64>,

    /// use pac mode
    pub proxy_auto_config: Option<bool>,

    /// pac script content
    pub pac_file_content: Option<String>,

    /// light theme setting
    pub light_theme_setting: Option<IVergeTheme>,

    /// dark theme setting
    pub dark_theme_setting: Option<IVergeTheme>,

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

    /// 测试网站列表
    pub test_list: Option<Vec<IVergeTestItem>>,

    /// 日志清理
    /// 0: 不清理; 1: 7天; 2: 30天; 3: 90天
    pub auto_log_clean: Option<i32>,

    /// window size and position
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_size_position: Option<Vec<f64>>,

    /// window size and position
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_is_maximized: Option<bool>,

    /// 是否启用随机端口
    pub enable_random_port: Option<bool>,

    /// webdav url
    pub webdav_url: Option<String>,
    /// webdav username
    pub webdav_username: Option<String>,
    /// webdav password
    pub webdav_password: Option<String>,

    /// enable tray
    pub enable_tray: Option<bool>,
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
            language: Some("zh".into()),
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
            enable_system_title_bar: Some(false),
            enable_keep_ui_active: Some(false),
            enable_splashscreen: Some(true),
            enable_system_proxy: Some(false),
            proxy_auto_config: Some(false),
            pac_file_content: Some(DEFAULT_PAC.into()),
            enable_random_port: Some(false),
            enable_proxy_guard: Some(false),
            proxy_guard_duration: Some(30),
            auto_close_connection: Some(true),
            auto_check_update: Some(true),
            enable_builtin_enhanced: Some(true),
            auto_log_clean: Some(3),
            enable_tray: Some(true),
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

        patch!(enable_service_mode);
        patch!(enable_auto_launch);
        patch!(enable_silent_start);
        patch!(enable_system_title_bar);
        patch!(enable_keep_ui_active);
        patch!(enable_splashscreen);
        patch!(enable_random_port);
        patch!(enable_system_proxy);
        patch!(enable_proxy_guard);
        patch!(system_proxy_bypass);
        patch!(proxy_guard_duration);
        patch!(proxy_auto_config);
        patch!(pac_file_content);

        patch!(light_theme_setting);
        patch!(dark_theme_setting);
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
        patch!(window_size_position);
        patch!(window_is_maximized);
        patch!(webdav_url);
        patch!(webdav_username);
        patch!(webdav_password);
        patch!(enable_tray);
    }

    /// 在初始化前尝试拿到单例端口的值
    pub fn get_singleton_port() -> u16 {
        #[cfg(not(feature = "verge-dev"))]
        const SERVER_PORT: u16 = 33331;
        #[cfg(feature = "verge-dev")]
        const SERVER_PORT: u16 = 11233;

        match dirs::verge_path().and_then(|path| help::read_yaml::<IVerge>(&path)) {
            Ok(config) => config.app_singleton_port.unwrap_or(SERVER_PORT),
            Err(_) => SERVER_PORT, // 这里就不log错误了
        }
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
