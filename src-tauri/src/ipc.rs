use crate::cmd;

pub fn builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .types(&platform_types())
        .commands(tauri_specta::collect_commands![
            tauri_plugin_clash_verge_sysinfo::commands::get_system_info,
            tauri_plugin_clash_verge_sysinfo::commands::get_app_uptime,
            tauri_plugin_clash_verge_sysinfo::commands::export_diagnostic_info::<tauri::Wry>,
            cmd::probe_listener,
            cmd::save_proxy_ports,
            cmd::get_sys_proxy,
            cmd::get_auto_proxy,
            cmd::get_embedded_server_port,
            cmd::open_app_dir,
            cmd::open_logs_dir,
            cmd::open_core_dir,
            cmd::get_network_interfaces,
            cmd::get_system_hostname,
            cmd::restart_app,
            cmd::install_update,
            cmd::cancel_update_download,
            cmd::restart_core,
            cmd::upgrade_clash_core,
            cmd::get_runtime_state,
            cmd::get_pending_failures,
            cmd::get_sidecar_failure,
            cmd::entry_lightweight_mode,
            cmd::install_service,
            cmd::uninstall_service,
            cmd::reinstall_service,
            cmd::repair_service,
            cmd::continue_with_sidecar,
            cmd::sync_runtime_providers,
            cmd::get_clash_info,
            cmd::patch_clash_config,
            cmd::patch_clash_mode,
            cmd::get_clash_mode,
            cmd::change_clash_core,
            cmd::get_runtime_config,
            cmd::get_proxy_view,
            cmd::get_runtime_yaml,
            cmd::get_runtime_logs,
            cmd::get_runtime_proxy_chain_config,
            cmd::update_proxy_chain_config_in_runtime,
            cmd::invoke_uwp_tool,
            cmd::copy_clash_env,
            cmd::sync_tray_proxy_selection,
            cmd::record_selected_node,
            cmd::forget_selected_node,
            cmd::save_dns_config,
            cmd::apply_dns_config,
            cmd::set_dns_override,
            cmd::take_dns_override_notice,
            cmd::take_service_fallback_notice,
            cmd::get_core_startup_error,
            cmd::take_service_repair_notice,
            cmd::take_service_owner_notice,
            cmd::take_discarded_keys_notice,
            cmd::get_dns_config_content,
            cmd::validate_dns_config,
            cmd::get_clash_logs,
            cmd::get_verge_config,
            cmd::patch_verge_config,
            cmd::test_delay,
            cmd::get_app_dir,
            cmd::copy_icon_file,
            cmd::download_icon_cache,
            cmd::open_devtools,
            cmd::exit_app,
            cmd::get_network_interfaces_info,
            cmd::get_profiles,
            cmd::enhance_profiles,
            cmd::patch_profiles_config,
            cmd::view_profile,
            cmd::patch_profile,
            cmd::create_profile,
            cmd::import_profile,
            cmd::reorder_profile,
            cmd::update_profile,
            cmd::delete_profile,
            cmd::read_profile_file,
            cmd::save_profile_file,
            cmd::get_next_update_time,
            cmd::create_local_backup,
            cmd::list_local_backup,
            cmd::delete_local_backup,
            cmd::restore_local_backup,
            cmd::import_local_backup,
            cmd::export_local_backup,
            cmd::create_webdav_backup,
            cmd::save_webdav_config,
            cmd::list_webdav_backup,
            cmd::delete_webdav_backup,
            cmd::restore_webdav_backup,
            cmd::get_unlock_items,
            cmd::check_media_unlock,
            cmd::check_media_unlock_item,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .dangerously_cast_bigints_to_number()
        .typ::<crate::core::notify::notification::VergeEventPayloads>()
}

// Tauri transports YAML values as JSON; keep YAML storage out of the IPC type graph.
#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(transparent)]
pub struct YamlMapping(#[specta(type = std::collections::HashMap<String, JsonValue>)] pub serde_yaml_ng::Mapping);

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(transparent)]
pub struct YamlValue(#[specta(type = JsonValue)] pub serde_yaml_ng::Value);

#[derive(serde::Serialize, specta::Type)]
pub struct WebDavFile {
    pub href: String,
    #[specta(type = String)]
    pub last_modified: chrono::DateTime<chrono::Utc>,
}

impl From<reqwest_dav::list_cmd::ListFile> for WebDavFile {
    fn from(file: reqwest_dav::list_cmd::ListFile) -> Self {
        Self {
            href: file.href,
            last_modified: file.last_modified,
        }
    }
}

#[derive(serde::Serialize, specta::Type)]
pub struct NetworkInterfaceView {
    pub name: String,
    #[specta(type = Vec<InterfaceAddress>)]
    pub addr: Vec<network_interface::Addr>,
    pub mac_addr: Option<String>,
    pub index: u32,
    pub internal: bool,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub enum InterfaceAddress {
    V4(IpAddress),
    V6(IpAddress),
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub struct IpAddress {
    pub ip: String,
    pub broadcast: Option<String>,
    pub netmask: Option<String>,
}

impl From<network_interface::NetworkInterface> for NetworkInterfaceView {
    fn from(interface: network_interface::NetworkInterface) -> Self {
        Self {
            name: interface.name,
            addr: interface.addr,
            mac_addr: interface.mac_addr,
            index: interface.index,
            internal: interface.internal,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub struct DelayHistory {
    pub time: String,
    pub delay: u16,
}

fn platform_types() -> specta::Types {
    use specta::datatype::{DataType, Fields};
    let mut types = specta::Types::default().register::<crate::config::IVerge>();
    <PlatformVergeFields as specta::Type>::definition(&mut types);
    let platform = types
        .into_unsorted_iter()
        .find(|ty| ty.name == "PlatformVergeFields")
        .and_then(|ty| ty.ty.clone());
    let Some(DataType::Struct(platform)) = platform else {
        unreachable!()
    };
    let Fields::Named(platform) = platform.fields else {
        unreachable!()
    };
    types.iter_mut(|ty| {
        if ty.name != "IVerge" {
            return;
        }
        let Some(DataType::Struct(config)) = &mut ty.ty else {
            return;
        };
        let Fields::Named(fields) = &mut config.fields else {
            return;
        };
        fields
            .fields
            .retain(|(name, _)| !platform.fields.iter().any(|(platform_name, _)| name == platform_name));
        fields.fields.extend(platform.fields.iter().cloned());
    });
    types
}

// These fields exist only on some hosts; IPC generation covers every desktop target.
#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
struct PlatformVergeFields {
    #[specta(optional)]
    tray_icon: Option<String>,
    #[specta(optional)]
    verge_redir_port: Option<u16>,
    #[specta(optional)]
    verge_redir_enabled: Option<bool>,
    #[specta(optional)]
    verge_tproxy_port: Option<u16>,
    #[specta(optional)]
    verge_tproxy_enabled: Option<bool>,
    #[specta(optional)]
    enable_tray_speed: Option<bool>,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(untagged)]
pub enum JsonValue {
    Null(()),
    Bool(bool),
    Number(f64),
    String(String),
    // Specta resolves fields in nested functions, where Self is unavailable.
    Array(#[specta(type = Vec<JsonValue>)] Vec<Self>),
    Object(#[specta(type = std::collections::HashMap<String, JsonValue>)] std::collections::HashMap<String, Self>),
}
