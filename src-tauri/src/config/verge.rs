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

    // i18n
    pub language: Option<String>,

    /// `light` or `dark` or `system`
    pub theme_mode: Option<String>,

    /// enable blur mode
    /// maybe be able to set the alpha
    pub theme_blur: Option<bool>,

    /// enable traffic graph default is true
    pub traffic_graph: Option<bool>,

    /// show memory info (only for Clash Meta)
    pub enable_memory_usage: Option<bool>,

    /// clash tun mode
    pub enable_tun_mode: Option<bool>,

    /// windows service mode
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_service_mode: Option<bool>,

    /// can the app auto startup
    pub enable_auto_launch: Option<bool>,

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

    /// 默认的延迟测试连接
    pub default_latency_test: Option<String>,

    /// 支持关闭字段过滤，避免meta的新字段都被过滤掉，默认为真
    pub enable_clash_fields: Option<bool>,

    /// 是否使用内部的脚本支持，默认为真
    pub enable_builtin_enhanced: Option<bool>,

    /// proxy 页面布局 列数
    pub proxy_layout_column: Option<i32>,

    /// window size and position
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_size_position: Option<Vec<f64>>,
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
            clash_core: match cfg!(feature = "default-meta") {
                false => Some("clash".into()),
                true => Some("clash-meta".into()),
            },
            language: match cfg!(feature = "default-meta") {
                false => Some("en".into()),
                true => Some("zh".into()),
            },
            theme_mode: Some("system".into()),
            theme_blur: Some(false),
            traffic_graph: Some(true),
            enable_memory_usage: Some(true),
            enable_auto_launch: Some(false),
            enable_silent_start: Some(false),
            enable_system_proxy: Some(false),
            enable_proxy_guard: Some(false),
            proxy_guard_duration: Some(30),
            auto_close_connection: Some(true),
            enable_builtin_enhanced: Some(true),
            enable_clash_fields: Some(true),
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
        patch!(theme_blur);
        patch!(traffic_graph);
        patch!(enable_memory_usage);

        patch!(enable_tun_mode);
        patch!(enable_service_mode);
        patch!(enable_auto_launch);
        patch!(enable_silent_start);
        patch!(enable_system_proxy);
        patch!(enable_proxy_guard);
        patch!(system_proxy_bypass);
        patch!(proxy_guard_duration);

        patch!(theme_setting);
        patch!(web_ui_list);
        patch!(clash_core);
        patch!(hotkeys);

        patch!(auto_close_connection);
        patch!(default_latency_test);
        patch!(enable_builtin_enhanced);
        patch!(proxy_layout_column);
        patch!(enable_clash_fields);

        patch!(window_size_position);
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
