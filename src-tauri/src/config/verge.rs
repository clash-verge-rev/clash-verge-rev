use crate::{
    config::{DEFAULT_PAC, deserialize_encrypted, serialize_encrypted},
    logging,
    utils::{dirs, help, i18n, logging::Type},
};
use anyhow::Result;
use log::LevelFilter;
use serde::{Deserialize, Serialize};

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IVerge {
    /// app log level
    /// silent | error | warn | info | debug | trace
    pub app_log_level: Option<String>,

    /// app log max size in KB
    pub app_log_max_size: Option<u64>,

    /// app log max count
    pub app_log_max_count: Option<usize>,

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

    /// enable dns settings - this controls whether dns_config.yaml is applied
    pub enable_dns_settings: Option<bool>,

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

    /// proxy host address
    pub proxy_host: Option<String>,

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

    /// enable global hotkey
    pub enable_global_hotkey: Option<bool>,

    pub home_cards: Option<serde_json::Value>,
    pub auto_close_connection: Option<bool>,
    pub auto_check_update: Option<bool>,
    pub default_latency_test: Option<String>,
    pub default_latency_timeout: Option<i32>,
    pub enable_auto_delay_detection: Option<bool>,
    pub enable_builtin_enhanced: Option<bool>,
    pub proxy_layout_column: Option<i32>,
    pub test_list: Option<Vec<IVergeTestItem>>,

    /// Log cleanup interval: 0=never, 1=1day, 2=7days, 3=30days, 4=90days
    pub auto_log_clean: Option<i32>,

    /// Verge ports override clash ports
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

    #[serde(
        serialize_with = "serialize_encrypted",
        deserialize_with = "deserialize_encrypted",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub webdav_url: Option<String>,

    #[serde(
        serialize_with = "serialize_encrypted",
        deserialize_with = "deserialize_encrypted",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub webdav_username: Option<String>,

    #[serde(
        serialize_with = "serialize_encrypted",
        deserialize_with = "deserialize_encrypted",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub webdav_password: Option<String>,

    pub enable_tray_speed: Option<bool>,
    pub enable_tray_icon: Option<bool>,
    pub tray_inline_proxy_groups: Option<bool>,
    pub enable_auto_light_weight_mode: Option<bool>,
    pub auto_light_weight_minutes: Option<u64>,
    pub enable_hover_jump_navigator: Option<bool>,
    pub enable_external_controller: Option<bool>,
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
    pub const VALID_CLASH_CORES: &'static [&'static str] = &["verge-mihomo", "verge-mihomo-alpha"];

    pub async fn validate_and_fix_config() -> Result<()> {
        let config_path = dirs::verge_path()?;
        let mut config = match help::read_yaml::<IVerge>(&config_path).await {
            Ok(config) => config,
            Err(_) => Self::template(),
        };

        let mut needs_fix = false;

        if let Some(ref core) = config.clash_core {
            let core_str = core.trim();
            if core_str.is_empty() || !Self::VALID_CLASH_CORES.contains(&core_str) {
                logging!(
                    warn,
                    Type::Config,
                    "Invalid clash_core at startup: '{}', auto-correcting to 'verge-mihomo'",
                    core
                );
                config.clash_core = Some("verge-mihomo".into());
                needs_fix = true;
            }
        } else {
            logging!(
                info,
                Type::Config,
                "No clash_core configured at startup, setting to default 'verge-mihomo'"
            );
            config.clash_core = Some("verge-mihomo".into());
            needs_fix = true;
        }

        if needs_fix {
            logging!(info, Type::Config, "Saving corrected config file");
            help::save_yaml(&config_path, &config, Some("# Generated by Clash Verge")).await?;
            logging!(
                info,
                Type::Config,
                "Config file corrected, reloading configuration"
            );

            Self::reload_config_after_fix(config).await?;
        } else {
            logging!(
                info,
                Type::Config,
                "clash_core validation passed: {:?}",
                config.clash_core
            );
        }

        Ok(())
    }

    async fn reload_config_after_fix(updated_config: IVerge) -> Result<()> {
        use crate::config::Config;

        let config_draft = Config::verge().await;
        *config_draft.draft_mut() = Box::new(updated_config.clone());
        config_draft.apply();

        logging!(
            info,
            Type::Config,
            "In-memory config updated, new clash_core: {:?}",
            updated_config.clash_core
        );

        Ok(())
    }

    pub fn get_valid_clash_core(&self) -> String {
        self.clash_core
            .clone()
            .unwrap_or_else(|| "verge-mihomo".into())
    }

    fn get_system_language() -> String {
        let sys_lang = sys_locale::get_locale()
            .unwrap_or_else(|| String::from("en"))
            .to_lowercase();

        let lang_code = sys_lang.split(['_', '-']).next().unwrap_or("en");
        let supported_languages = i18n::get_supported_languages();

        if supported_languages.contains(&lang_code.into()) {
            lang_code.into()
        } else {
            String::from("en")
        }
    }

    pub async fn new() -> Self {
        match dirs::verge_path() {
            Ok(path) => match help::read_yaml::<IVerge>(&path).await {
                Ok(mut config) => {
                    // compatibility
                    if let Some(start_page) = config.start_page.clone()
                        && start_page == "/home"
                    {
                        config.start_page = Some(String::from("/"));
                    }
                    config
                }
                Err(err) => {
                    log::error!(target: "app", "{err}");
                    Self::template()
                }
            },
            Err(err) => {
                log::error!(target: "app", "{err}");
                Self::template()
            }
        }
    }

    pub fn template() -> Self {
        Self {
            app_log_max_size: Some(128),
            app_log_max_count: Some(8),
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
            enable_hover_jump_navigator: Some(true),
            enable_system_proxy: Some(false),
            proxy_auto_config: Some(false),
            pac_file_content: Some(DEFAULT_PAC.into()),
            proxy_host: Some(crate::constants::network::DEFAULT_PROXY_HOST.into()),
            #[cfg(not(target_os = "windows"))]
            verge_redir_port: Some(crate::constants::network::ports::DEFAULT_REDIR),
            #[cfg(not(target_os = "windows"))]
            verge_redir_enabled: Some(false),
            #[cfg(target_os = "linux")]
            verge_tproxy_port: Some(crate::constants::network::ports::DEFAULT_TPROXY),
            #[cfg(target_os = "linux")]
            verge_tproxy_enabled: Some(false),
            verge_mixed_port: Some(crate::constants::network::ports::DEFAULT_MIXED),
            verge_socks_port: Some(crate::constants::network::ports::DEFAULT_SOCKS),
            verge_socks_enabled: Some(false),
            verge_port: Some(crate::constants::network::ports::DEFAULT_HTTP),
            verge_http_enabled: Some(false),
            enable_proxy_guard: Some(false),
            use_default_bypass: Some(true),
            proxy_guard_duration: Some(30),
            auto_close_connection: Some(true),
            auto_check_update: Some(true),
            enable_builtin_enhanced: Some(true),
            auto_log_clean: Some(2),
            webdav_url: None,
            webdav_username: None,
            webdav_password: None,
            enable_tray_speed: Some(false),
            enable_tray_icon: Some(true),
            tray_inline_proxy_groups: Some(false),
            enable_global_hotkey: Some(true),
            enable_auto_light_weight_mode: Some(false),
            auto_light_weight_minutes: Some(10),
            enable_dns_settings: Some(false),
            home_cards: None,
            enable_external_controller: Some(false),
            ..Self::default()
        }
    }

    pub async fn save_file(&self) -> Result<()> {
        help::save_yaml(
            &dirs::verge_path()?,
            &self,
            Some("# Generated by Clash Verge"),
        )
        .await
    }

    pub fn patch_config(&mut self, patch: IVerge) {
        macro_rules! patch {
            ($key: tt) => {
                if patch.$key.is_some() {
                    self.$key = patch.$key;
                }
            };
        }

        patch!(app_log_level);
        patch!(app_log_max_size);
        patch!(app_log_max_count);

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
        patch!(enable_hover_jump_navigator);
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
        patch!(proxy_host);
        patch!(theme_setting);
        patch!(web_ui_list);
        patch!(clash_core);
        patch!(hotkeys);
        patch!(enable_global_hotkey);

        patch!(auto_close_connection);
        patch!(auto_check_update);
        patch!(default_latency_test);
        patch!(default_latency_timeout);
        patch!(enable_auto_delay_detection);
        patch!(enable_builtin_enhanced);
        patch!(proxy_layout_column);
        patch!(test_list);
        patch!(auto_log_clean);

        patch!(webdav_url);
        patch!(webdav_username);
        patch!(webdav_password);
        patch!(enable_tray_speed);
        patch!(enable_tray_icon);
        patch!(tray_inline_proxy_groups);
        patch!(enable_auto_light_weight_mode);
        patch!(auto_light_weight_minutes);
        patch!(enable_dns_settings);
        patch!(home_cards);
        patch!(enable_external_controller);
    }

    pub fn get_singleton_port() -> u16 {
        crate::constants::network::ports::SINGLETON_SERVER
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
    pub app_log_max_size: Option<u64>,
    pub app_log_max_count: Option<usize>,
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
    pub enable_global_hotkey: Option<bool>,
    pub use_default_bypass: Option<bool>,
    pub system_proxy_bypass: Option<String>,
    pub proxy_guard_duration: Option<u64>,
    pub proxy_auto_config: Option<bool>,
    pub pac_file_content: Option<String>,
    pub proxy_host: Option<String>,
    pub theme_setting: Option<IVergeTheme>,
    pub web_ui_list: Option<Vec<String>>,
    pub clash_core: Option<String>,
    pub hotkeys: Option<Vec<String>>,
    pub auto_close_connection: Option<bool>,
    pub auto_check_update: Option<bool>,
    pub default_latency_test: Option<String>,
    pub default_latency_timeout: Option<i32>,
    pub enable_auto_delay_detection: Option<bool>,
    pub enable_builtin_enhanced: Option<bool>,
    pub proxy_layout_column: Option<i32>,
    pub test_list: Option<Vec<IVergeTestItem>>,
    pub auto_log_clean: Option<i32>,
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
    pub enable_tray_icon: Option<bool>,
    pub tray_inline_proxy_groups: Option<bool>,
    pub enable_auto_light_weight_mode: Option<bool>,
    pub auto_light_weight_minutes: Option<u64>,
    pub enable_dns_settings: Option<bool>,
    pub home_cards: Option<serde_json::Value>,
    pub enable_hover_jump_navigator: Option<bool>,
    pub enable_external_controller: Option<bool>,
}

impl From<IVerge> for IVergeResponse {
    fn from(verge: IVerge) -> Self {
        let valid_clash_core = verge.get_valid_clash_core();
        Self {
            app_log_level: verge.app_log_level,
            app_log_max_size: verge.app_log_max_size,
            app_log_max_count: verge.app_log_max_count,
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
            enable_global_hotkey: verge.enable_global_hotkey,
            use_default_bypass: verge.use_default_bypass,
            system_proxy_bypass: verge.system_proxy_bypass,
            proxy_guard_duration: verge.proxy_guard_duration,
            proxy_auto_config: verge.proxy_auto_config,
            pac_file_content: verge.pac_file_content,
            proxy_host: verge.proxy_host,
            theme_setting: verge.theme_setting,
            web_ui_list: verge.web_ui_list,
            hotkeys: verge.hotkeys,
            auto_close_connection: verge.auto_close_connection,
            auto_check_update: verge.auto_check_update,
            default_latency_test: verge.default_latency_test,
            default_latency_timeout: verge.default_latency_timeout,
            enable_auto_delay_detection: verge.enable_auto_delay_detection,
            enable_builtin_enhanced: verge.enable_builtin_enhanced,
            proxy_layout_column: verge.proxy_layout_column,
            test_list: verge.test_list,
            auto_log_clean: verge.auto_log_clean,
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
            enable_tray_icon: verge.enable_tray_icon,
            tray_inline_proxy_groups: verge.tray_inline_proxy_groups,
            enable_auto_light_weight_mode: verge.enable_auto_light_weight_mode,
            auto_light_weight_minutes: verge.auto_light_weight_minutes,
            enable_dns_settings: verge.enable_dns_settings,
            home_cards: verge.home_cards,
            enable_hover_jump_navigator: verge.enable_hover_jump_navigator,
            clash_core: Some(valid_clash_core),
            enable_external_controller: verge.enable_external_controller,
        }
    }
}
