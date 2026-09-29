pub mod desktop;
pub mod handle;
pub mod notification;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum NoticeStatus {
    // dead send: no frontend handler
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "import_sub_url::ok")]
    ImportSubUrlOk,
    #[serde(rename = "import_sub_url::error")]
    ImportSubUrlError,
    #[serde(rename = "set_config::error")]
    SetConfigError,
    #[serde(rename = "core_start::error")]
    CoreStartError,
    #[serde(rename = "service_core::repair_required")]
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    ServiceCoreRepairRequired,
    #[serde(rename = "service_core::app_data_not_owned")]
    ServiceCoreAppDataNotOwned,
    #[serde(rename = "service_core::sidecar_fallback")]
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    ServiceCoreSidecarFallback,
    #[serde(rename = "dns_override::auto_disabled")]
    DnsOverrideAutoDisabled,
    #[serde(rename = "enhance::discarded_keys")]
    EnhanceDiscardedKeys,
    #[serde(rename = "tun_mode::auto_disabled")]
    TunModeAutoDisabled,
    #[serde(rename = "tun_mode::auto_disable_failed")]
    TunModeAutoDisableFailed,
    #[serde(rename = "app_restart::core_stop_failed")]
    AppRestartCoreStopFailed,
    #[serde(rename = "app_quit::core_stop_failed")]
    AppQuitCoreStopFailed,
    #[serde(rename = "update_with_clash_proxy")]
    UpdateWithClashProxy,
    #[serde(rename = "update_failed_even_with_clash")]
    UpdateFailedEvenWithClash,
    #[serde(rename = "reactivate_profiles::error")]
    ReactivateProfilesError,
    #[serde(rename = "update_failed")]
    UpdateFailed,
    #[serde(rename = "config_validate::boot_error")]
    ConfigValidateBootError,
    #[serde(rename = "config_validate::error")]
    ConfigValidateError,
    #[serde(rename = "config_validate::process_terminated")]
    ConfigValidateProcessTerminated,
    #[serde(rename = "config_validate::script_error")]
    ConfigValidateScriptError,
    #[serde(rename = "config_validate::script_syntax_error")]
    ConfigValidateScriptSyntaxError,
    #[serde(rename = "config_validate::script_missing_main")]
    ConfigValidateScriptMissingMain,
    #[serde(rename = "config_validate::file_not_found")]
    ConfigValidateFileNotFound,
    #[serde(rename = "config_validate::yaml_syntax_error")]
    ConfigValidateYamlSyntaxError,
    #[serde(rename = "config_validate::yaml_read_error")]
    ConfigValidateYamlReadError,
    #[serde(rename = "config_validate::yaml_mapping_error")]
    ConfigValidateYamlMappingError,
    #[serde(rename = "config_validate::merge_syntax_error")]
    ConfigValidateMergeSyntaxError,
    #[serde(rename = "config_validate::merge_mapping_error")]
    ConfigValidateMergeMappingError,
    #[serde(rename = "config_core::change_success")]
    ConfigCoreChangeSuccess,
    #[serde(rename = "config_core::change_error")]
    ConfigCoreChangeError,
    #[serde(rename = "mixed_port::fallback")]
    MixedPortFallback,
    #[serde(rename = "mixed_port::fallback_error")]
    MixedPortFallbackError,
    // dead listener: frontend handler retained
    #[allow(dead_code)]
    #[serde(rename = "config_validate::core_change")]
    ConfigValidateCoreChange,
    // dead listener: frontend handler retained
    #[allow(dead_code)]
    #[serde(rename = "config_validate::stdout_error")]
    ConfigValidateStdoutError,
    // dead listener: frontend handler retained
    #[allow(dead_code)]
    #[serde(rename = "config_validate::yaml_key_error")]
    ConfigValidateYamlKeyError,
    // dead listener: frontend handler retained
    #[allow(dead_code)]
    #[serde(rename = "config_validate::yaml_error")]
    ConfigValidateYamlError,
    // dead listener: frontend handler retained
    #[allow(dead_code)]
    #[serde(rename = "config_validate::merge_key_error")]
    ConfigValidateMergeKeyError,
    // dead listener: frontend handler retained
    #[allow(dead_code)]
    #[serde(rename = "config_validate::merge_error")]
    ConfigValidateMergeError,
    // dead send: no frontend handler
    #[serde(rename = "set_config::ok")]
    SetConfigOk,
}

#[cfg(test)]
mod tests {
    use super::NoticeStatus;

    #[test]
    fn notice_status_wire_contract() {
        let statuses = [
            NoticeStatus::Info,
            NoticeStatus::ImportSubUrlOk,
            NoticeStatus::ImportSubUrlError,
            NoticeStatus::SetConfigError,
            NoticeStatus::CoreStartError,
            NoticeStatus::ServiceCoreRepairRequired,
            NoticeStatus::ServiceCoreAppDataNotOwned,
            NoticeStatus::ServiceCoreSidecarFallback,
            NoticeStatus::DnsOverrideAutoDisabled,
            NoticeStatus::EnhanceDiscardedKeys,
            NoticeStatus::TunModeAutoDisabled,
            NoticeStatus::TunModeAutoDisableFailed,
            NoticeStatus::AppRestartCoreStopFailed,
            NoticeStatus::AppQuitCoreStopFailed,
            NoticeStatus::UpdateWithClashProxy,
            NoticeStatus::UpdateFailedEvenWithClash,
            NoticeStatus::ReactivateProfilesError,
            NoticeStatus::UpdateFailed,
            NoticeStatus::ConfigValidateBootError,
            NoticeStatus::ConfigValidateError,
            NoticeStatus::ConfigValidateProcessTerminated,
            NoticeStatus::ConfigValidateScriptError,
            NoticeStatus::ConfigValidateScriptSyntaxError,
            NoticeStatus::ConfigValidateScriptMissingMain,
            NoticeStatus::ConfigValidateFileNotFound,
            NoticeStatus::ConfigValidateYamlSyntaxError,
            NoticeStatus::ConfigValidateYamlReadError,
            NoticeStatus::ConfigValidateYamlMappingError,
            NoticeStatus::ConfigValidateMergeSyntaxError,
            NoticeStatus::ConfigValidateMergeMappingError,
            NoticeStatus::ConfigCoreChangeSuccess,
            NoticeStatus::ConfigCoreChangeError,
            NoticeStatus::MixedPortFallback,
            NoticeStatus::MixedPortFallbackError,
            NoticeStatus::ConfigValidateCoreChange,
            NoticeStatus::ConfigValidateStdoutError,
            NoticeStatus::ConfigValidateYamlKeyError,
            NoticeStatus::ConfigValidateYamlError,
            NoticeStatus::ConfigValidateMergeKeyError,
            NoticeStatus::ConfigValidateMergeError,
            NoticeStatus::SetConfigOk,
        ];
        let expected = [
            "info",
            "import_sub_url::ok",
            "import_sub_url::error",
            "set_config::error",
            "core_start::error",
            "service_core::repair_required",
            "service_core::app_data_not_owned",
            "service_core::sidecar_fallback",
            "dns_override::auto_disabled",
            "enhance::discarded_keys",
            "tun_mode::auto_disabled",
            "tun_mode::auto_disable_failed",
            "app_restart::core_stop_failed",
            "app_quit::core_stop_failed",
            "update_with_clash_proxy",
            "update_failed_even_with_clash",
            "reactivate_profiles::error",
            "update_failed",
            "config_validate::boot_error",
            "config_validate::error",
            "config_validate::process_terminated",
            "config_validate::script_error",
            "config_validate::script_syntax_error",
            "config_validate::script_missing_main",
            "config_validate::file_not_found",
            "config_validate::yaml_syntax_error",
            "config_validate::yaml_read_error",
            "config_validate::yaml_mapping_error",
            "config_validate::merge_syntax_error",
            "config_validate::merge_mapping_error",
            "config_core::change_success",
            "config_core::change_error",
            "mixed_port::fallback",
            "mixed_port::fallback_error",
            "config_validate::core_change",
            "config_validate::stdout_error",
            "config_validate::yaml_key_error",
            "config_validate::yaml_error",
            "config_validate::merge_key_error",
            "config_validate::merge_error",
            "set_config::ok",
        ];
        let actual: Vec<_> = statuses
            .into_iter()
            .map(serde_json::to_value)
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actual, expected.map(serde_json::Value::from));
    }
}
