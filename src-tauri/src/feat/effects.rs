use crate::config::IVerge;
use std::collections::BTreeSet;

/// Variant order defines execution dependency order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Effect {
    RestartCore,
    ClashConfig,
    Autostart,
    Language,
    SystemProxy,
    Hotkey,
    TrayMenu,
    TrayIcon,
    TrayTooltip,
    TrayClick,
    Lightweight,
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
    use_default_bypass => [SystemProxy];
    system_proxy_bypass => [SystemProxy];
    proxy_guard_duration => [SystemProxy];
    proxy_auto_config => [SystemProxy];
    pac_file_content => [SystemProxy];
    proxy_host => [SystemProxy];
    theme_setting => NoEffect;
    web_ui_list => NoEffect;
    clash_core => NoEffect;
    hotkeys => [Hotkey, TrayMenu];
    enable_global_hotkey => NoEffect;
    home_cards => NoEffect;
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

    fn verge_patch(mutate: impl FnOnce(&mut IVerge)) -> IVerge {
        let mut patch = IVerge::default();
        mutate(&mut patch);
        patch
    }

    #[test]
    fn representative_verge_patches_map_to_frozen_effects() {
        assert_eq!(verge_effects(&IVerge::default()), Effects::new());

        let cases: [(IVerge, &[Effect]); 9] = [
            (
                verge_patch(|p| p.verge_mixed_port = Some(27899)),
                &[Effect::RestartCore],
            ),
            (
                verge_patch(|p| p.language = Some("zh".into())),
                &[Effect::TrayMenu, Effect::TrayTooltip, Effect::Language],
            ),
            (
                verge_patch(|p| p.hotkeys = Some(vec!["CmdOrCtrl+K".into()])),
                &[Effect::Hotkey, Effect::TrayMenu],
            ),
            (
                verge_patch(|p| p.enable_system_proxy = Some(true)),
                &[
                    Effect::SystemProxy,
                    Effect::TrayIcon,
                    Effect::TrayMenu,
                    Effect::TrayTooltip,
                ],
            ),
            (
                verge_patch(|p| p.system_proxy_bypass = Some("localhost".into())),
                &[Effect::SystemProxy],
            ),
            (
                verge_patch(|p| p.use_default_bypass = Some(false)),
                &[Effect::SystemProxy],
            ),
            (
                verge_patch(|p| p.proxy_host = Some("localhost".into())),
                &[Effect::SystemProxy],
            ),
            (
                verge_patch(|p| p.tray_event = Some("show_main_window".into())),
                &[Effect::TrayClick],
            ),
            (verge_patch(|p| p.theme_mode = Some("dark".into())), &[]),
        ];
        for (patch, expected) in cases {
            assert_eq!(
                verge_effects(&patch),
                expected.iter().copied().collect::<Effects>(),
                "patch mapping drifted for {expected:?}"
            );
        }

        let tun = verge_patch(|p| p.enable_tun_mode = Some(true));
        #[cfg(target_os = "linux")]
        assert_eq!(
            verge_effects(&tun),
            [
                Effect::RestartCore,
                Effect::ClashConfig,
                Effect::TrayIcon,
                Effect::TrayMenu,
                Effect::TrayTooltip,
            ]
            .into_iter()
            .collect::<Effects>()
        );
        #[cfg(not(target_os = "linux"))]
        assert_eq!(
            verge_effects(&tun),
            [
                Effect::ClashConfig,
                Effect::TrayIcon,
                Effect::TrayMenu,
                Effect::TrayTooltip,
            ]
            .into_iter()
            .collect::<Effects>()
        );
    }

    fn clash_mapping(pairs: &[(&str, &str)]) -> serde_yaml_ng::Mapping {
        let mut mapping = serde_yaml_ng::Mapping::new();
        for (key, value) in pairs {
            mapping.insert((*key).into(), (*value).into());
        }
        mapping
    }

    #[test]
    fn clash_keys_map_to_frozen_effects() {
        let cases: [(serde_yaml_ng::Mapping, &[Effect]); 7] = [
            (clash_mapping(&[]), &[Effect::ClashConfig]),
            (clash_mapping(&[("secret", "s")]), &[Effect::RestartCore]),
            (
                clash_mapping(&[("mode", "rule")]),
                &[Effect::ClashConfig, Effect::TrayIcon, Effect::TrayMenu],
            ),
            (clash_mapping(&[("allow-lan", "true")]), &[Effect::ClashConfig]),
            (clash_mapping(&[("not-a-known-key", "1")]), &[Effect::ClashConfig]),
            // Restart supersedes reload; allow-lan precedes mode.
            (
                clash_mapping(&[("secret", "s"), ("mode", "rule")]),
                &[Effect::RestartCore],
            ),
            (
                clash_mapping(&[("allow-lan", "true"), ("mode", "rule")]),
                &[Effect::ClashConfig],
            ),
        ];
        for (patch, expected) in cases {
            assert_eq!(
                clash_effects(&patch),
                expected.iter().copied().collect::<Effects>(),
                "clash mapping drifted for {expected:?}"
            );
        }
    }
}
