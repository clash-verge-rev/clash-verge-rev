pub use mihomo::Mihomo;
use tauri::{
    Manager, Runtime,
    async_runtime::RwLock,
    plugin::{Builder as PluginBuilder, TauriPlugin},
};

pub use models::*;

mod commands;
mod error;
mod ipc_request;
mod mihomo;
pub mod models;
mod utils;

pub use error::{Error, Result};

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the mihomo APIs.
pub trait MihomoExt<R: Runtime> {
    fn mihomo(&self) -> &RwLock<Mihomo>;
}

impl<R: Runtime, T: Manager<R>> crate::MihomoExt<R> for T {
    fn mihomo(&self) -> &RwLock<Mihomo> {
        self.state::<RwLock<Mihomo>>().inner()
    }
}

#[derive(Debug)]
pub struct Builder {
    protocol: Protocol,
    external_host: Option<String>,
    external_port: Option<u32>,
    secret: Option<String>,
    socket_path: Option<String>,
}

impl Default for Builder {
    fn default() -> Self {
        Self {
            protocol: Protocol::Http,
            external_host: Some(String::from("127.0.0.1")),
            external_port: Some(9090),
            secret: None,
            socket_path: None,
        }
    }
}

impl Builder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn protocol(mut self, protocol: Protocol) -> Self {
        self.protocol = protocol;
        self
    }

    pub fn external_host<S: Into<String>>(mut self, external_host: S) -> Self {
        self.external_host = Some(external_host.into());
        self
    }

    pub fn external_port(mut self, external_port: u32) -> Self {
        self.external_port = Some(external_port);
        self
    }

    pub fn secret<S: Into<String>>(mut self, secret: S) -> Self {
        self.secret = Some(secret.into());
        self
    }

    pub fn socket_path<S: Into<String>>(mut self, socket_path: S) -> Self {
        self.socket_path = Some(socket_path.into());
        self
    }

    pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
        let protocol = self.protocol;
        let external_host = self.external_host;
        let external_port = self.external_port;
        let secret = self.secret;
        let socket_path = self.socket_path;

        PluginBuilder::new("mihomo")
            .invoke_handler(tauri::generate_handler![
                commands::update_controller,
                commands::update_secret,
                commands::get_version,
                commands::flush_fakeip,
                commands::flush_dns,
                // connections
                commands::get_connections,
                commands::close_all_connections,
                commands::close_connections,
                // groups
                commands::get_groups,
                commands::get_group_by_name,
                commands::delay_group,
                // providers
                commands::get_proxy_providers,
                commands::get_proxy_provider_by_name,
                commands::update_proxy_provider,
                commands::healthcheck_proxy_provider,
                commands::healthcheck_node_in_provider,
                // proxies
                commands::get_proxies,
                commands::get_proxy_by_name,
                commands::select_node_for_group,
                commands::unfixed_proxy,
                commands::delay_proxy_by_name,
                // rules
                commands::get_rules,
                commands::get_rule_providers,
                commands::update_rule_provider,
                // runtime config
                commands::get_base_config,
                commands::reload_config,
                commands::patch_base_config,
                commands::update_geo,
                commands::restart,
                // upgrade
                commands::upgrade_core,
                commands::upgrade_ui,
                commands::upgrade_geo,
                // ws
                commands::ws_traffic,
                commands::ws_memory,
                commands::ws_connections,
                commands::ws_logs,
                commands::ws_disconnect,
                commands::clear_all_ws_connections,
                // commands::ws_send,
            ])
            .setup(move |app, _api| {
                app.manage(RwLock::new(Mihomo {
                    protocol,
                    external_host,
                    external_port,
                    secret,
                    socket_path,
                    connection_manager: Default::default(),
                }));
                Ok(())
            })
            .build()
    }
}
