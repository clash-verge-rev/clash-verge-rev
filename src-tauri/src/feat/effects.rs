use crate::config::IVerge;
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Effect {
    RestartCore,
    ClashConfig,
    VergeConfig,
    Autostart,
    SystemProxy,
    TrayIcon,
    Hotkey,
    TrayMenu,
    TrayTooltip,
    TrayClick,
    Lightweight,
    Language,
    LogLevel,
    LogFile,
}

pub(super) type Effects = BTreeSet<Effect>;

macro_rules! select_field {
    ($effects:ident, $field:ident, NoEffect) => { let _ = $field; };
    ($effects:ident, $field:ident, [$($effect:ident),*]) => {
        if $field.is_some() { $effects.extend([$(Effect::$effect),*]); }
    };
    ($effects:ident, $field:ident, Tun) => {
        select_field!($effects, $field, [ClashConfig, TrayMenu, TrayTooltip, TrayIcon]);
        #[cfg(target_os = "linux")]
        if *$field == Some(true) { $effects.insert(Effect::RestartCore); }
    };
}

macro_rules! verge_registry {
    ($( $(#[$cfg:meta])* $field:ident => $rule:tt; )*) => {
        pub(super) fn verge_effects(patch: &IVerge) -> Effects {
            // No rest pattern: even fields omitted by serde must be classified at compile time.
            let IVerge { $( $(#[$cfg])* $field, )* } = patch;
            let mut effects = Effects::new();
            $( $(#[$cfg])* { select_field!(effects, $field, $rule); } )*
            effects
        }

        #[cfg(test)]
        const VERGE_FIELDS: &[&str] = &[ $( $(#[$cfg])* stringify!($field), )* ];
    };
}

verge_registry! {
    app_log_level => [LogLevel];
    app_log_max_size => [LogFile];
    app_log_max_count => [LogFile];
    language => [Language, TrayMenu, TrayTooltip];
    theme_mode => NoEffect;
    tray_event => [TrayClick];
    env_type => NoEffect;
    start_page => NoEffect;
    startup_script => NoEffect;
    traffic_graph => NoEffect;
    enable_memory_usage => NoEffect;
    enable_group_icon => NoEffect;
    pause_render_traffic_stats_on_blur => NoEffect;
    common_tray_icon => [TrayIcon];
    #[cfg(target_os = "macos")]
    tray_icon => [TrayIcon];
    menu_icon => NoEffect;
    menu_order => NoEffect;
    proxy_group_tools_position => NoEffect;
    notice_position => NoEffect;
    collapse_navbar => NoEffect;
    sysproxy_tray_icon => [TrayIcon];
    tun_tray_icon => [TrayIcon];
    enable_tun_mode => Tun;
    enable_auto_launch => [Autostart];
    enable_silent_start => NoEffect;
    enable_system_proxy => [SystemProxy, TrayMenu, TrayTooltip, TrayIcon];
    enable_proxy_guard => [SystemProxy];
    enable_bypass_check => NoEffect;
    enable_dns_settings => NoEffect;
    profile_dns_settings => NoEffect;
    use_default_bypass => NoEffect;
    system_proxy_bypass => [SystemProxy];
    proxy_guard_duration => [SystemProxy];
    proxy_auto_config => [SystemProxy];
    pac_file_content => [SystemProxy];
    proxy_host => NoEffect;
    theme_setting => NoEffect;
    web_ui_list => NoEffect;
    clash_core => NoEffect;
    hotkeys => [Hotkey, TrayMenu];
    enable_global_hotkey => [VergeConfig];
    home_cards => [VergeConfig];
    auto_close_connection => NoEffect;
    auto_check_update => NoEffect;
    default_latency_test => NoEffect;
    default_latency_timeout => NoEffect;
    enable_auto_delay_detection => NoEffect;
    auto_delay_detection_interval_minutes => NoEffect;
    enable_builtin_enhanced => NoEffect;
    proxy_layout_column => NoEffect;
    test_list => NoEffect;
    auto_log_clean => NoEffect;
    enable_auto_backup_schedule => NoEffect;
    auto_backup_interval_hours => NoEffect;
    auto_backup_on_change => NoEffect;
    #[cfg(not(target_os = "windows"))]
    verge_redir_port => [RestartCore];
    #[cfg(not(target_os = "windows"))]
    verge_redir_enabled => [RestartCore];
    #[cfg(target_os = "linux")]
    verge_tproxy_port => [RestartCore];
    #[cfg(target_os = "linux")]
    verge_tproxy_enabled => [RestartCore];
    verge_mixed_port => [RestartCore];
    verge_socks_port => [RestartCore];
    verge_socks_enabled => [RestartCore];
    verge_port => [RestartCore];
    verge_http_enabled => [RestartCore];
    webdav_url => NoEffect;
    webdav_username => NoEffect;
    webdav_password => NoEffect;
    #[cfg(target_os = "macos")]
    enable_tray_speed => [TrayIcon];
    tray_proxy_groups_display_mode => [TrayMenu];
    tray_inline_outbound_modes => [TrayMenu];
    enable_auto_light_weight_mode => [Lightweight];
    auto_light_weight_minutes => NoEffect;
    enable_hover_jump_navigator => NoEffect;
    hover_jump_navigator_delay => NoEffect;
    enable_external_controller => [RestartCore];
}

pub(super) fn clash_effects(patch: &serde_yaml_ng::Mapping) -> Effects {
    use clash_verge_logging::{Type, logging};
    let mut effects = Effects::new();
    for key in patch.keys() {
        effects.extend(match key.as_str() {
            Some("secret" | "external-controller") => &[Effect::RestartCore][..],
            Some("allow-lan") => &[Effect::ClashConfig][..],
            Some("mode") => &[Effect::ClashConfig, Effect::TrayMenu, Effect::TrayIcon][..],
            _ => {
                logging!(
                    warn,
                    Type::Config,
                    "Unregistered Clash configuration key {key:?}; reloading configuration"
                );
                &[Effect::ClashConfig][..]
            }
        });
    }
    // These branches were exclusive: restart supersedes reload, and allow-lan precedes mode.
    if effects.contains(&Effect::RestartCore) {
        effects.retain(|effect| *effect == Effect::RestartCore);
    } else if patch.contains_key("allow-lan") {
        effects.retain(|effect| *effect == Effect::ClashConfig);
    }
    if patch.is_empty() {
        effects.insert(Effect::ClashConfig);
    }
    effects
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_serialized_verge_field_is_registered() -> Result<(), serde_json::Error> {
        let fields: std::collections::BTreeMap<String, serde_json::Value> =
            serde_json::from_value(serde_json::to_value(IVerge::default())?)?;
        for field in fields.keys() {
            assert!(VERGE_FIELDS.contains(&field.as_str()), "unregistered field: {field}");
        }
        let unique: BTreeSet<_> = VERGE_FIELDS.iter().collect();
        assert_eq!(unique.len(), VERGE_FIELDS.len());
        Ok(())
    }
}
