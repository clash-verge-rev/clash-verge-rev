//! Live handles into the attached tray menu and the reconcile decision:
//! state-only changes mutate items in place, a proxy-only structure change
//! swaps the group submenus, anything else rebuilds.

use crate::Type;
use crate::config::{IProfiles, IVerge};
use clash_verge_logging::logging_error;
use parking_lot::Mutex;
use smartstring::alias::String;
use std::collections::HashMap;
use tauri::menu::{CheckMenuItem, IsMenuItem, Submenu};
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Wry};
use tauri_plugin_mihomo::models::Proxies;

use super::{TrayMenuOptions, build_tray_menu, create_subcreate_proxy_menu_item};

pub(super) struct ProxyNodeItem {
    pub(super) name: String,
    pub(super) item: CheckMenuItem<Wry>,
    pub(super) text: String,
    pub(super) checked: bool,
}

pub(super) struct ProxyGroupItems {
    pub(super) name: String,
    pub(super) nodes: Vec<ProxyNodeItem>,
}

pub(super) struct TrayMenuState {
    pub(super) mode_items: [CheckMenuItem<Wry>; 3],
    pub(super) system_proxy_item: CheckMenuItem<Wry>,
    pub(super) tun_item: CheckMenuItem<Wry>,
    pub(super) lightweight_item: CheckMenuItem<Wry>,
    pub(super) profile_items: Vec<(String, CheckMenuItem<Wry>)>,
    pub(super) proxies_submenu: Option<Submenu<Wry>>,
    pub(super) proxy_groups: Vec<ProxyGroupItems>,
    pub(super) signature: String,
    pub(super) proxy_signature: Option<String>,
}

pub(super) fn proxy_delay_text(proxy_nodes_data: &Proxies, proxy_str: &str) -> String {
    proxy_nodes_data
        .proxies
        .get(proxy_str)
        .and_then(|h| h.history.last())
        .map(|h| match h.delay {
            0 => "-ms".into(),
            delay if delay >= 10000 => "-ms".into(),
            _ => format!("{}ms", h.delay).into(),
        })
        .unwrap_or_else(|| "-ms".into())
}

/// Topology inputs that a rebuild cannot reconcile by mutating items.
pub(super) fn menu_signature(verge: &IVerge, profiles: &IProfiles, mode: &str) -> String {
    let hotkeys = verge.hotkeys.as_ref().map(|h| h.join(",")).unwrap_or_default();
    let profiles = profiles
        .profiles_preview()
        .unwrap_or_default()
        .into_iter()
        .map(|profile| format!("{}:{}", profile.uid, profile.name))
        .collect::<Vec<_>>()
        .join(";");
    format!(
        "{}|{}|{mode}|{}|{hotkeys}|{profiles}",
        verge.tray_proxy_groups_display_mode.as_deref().unwrap_or("default"),
        verge.tray_inline_outbound_modes.unwrap_or(false),
        verge.language.as_deref().unwrap_or(""),
    )
    .into()
}

/// Group/node identity plus ordering, canonicalized so it is stable across fetches.
pub(super) fn proxy_structure_signature(
    proxy_mode: &str,
    order_map: Option<&HashMap<String, usize>>,
    proxy_nodes_data: &Proxies,
) -> String {
    let mut parts: Vec<std::string::String> = proxy_nodes_data
        .proxies
        .iter()
        .filter(|(name, data)| {
            let global = name.as_str() == "GLOBAL";
            (match proxy_mode {
                "global" => global,
                _ => !global,
            }) && !data.hidden.unwrap_or_default()
        })
        .filter_map(|(name, data)| {
            data.all.as_ref().map(|all| {
                let order = order_map
                    .and_then(|map| map.get(name.as_str()))
                    .map_or_else(|| "-".to_owned(), |index| index.to_string());
                format!(
                    "{}@{order}:{}",
                    name,
                    all.iter().map(|node| node.as_str()).collect::<Vec<_>>().join(",")
                )
            })
        })
        .collect();
    parts.sort();
    parts.join(";").into()
}

pub(super) struct ReconcileContext<'a> {
    pub(super) app_handle: &'a AppHandle<Wry>,
    pub(super) tray: &'a TrayIcon<Wry>,
    pub(super) options: TrayMenuOptions<'a>,
    pub(super) verge: &'a IVerge,
    pub(super) profiles: &'a IProfiles,
    pub(super) fetched_proxies: Option<&'a Proxies>,
    pub(super) order_map: Option<&'a HashMap<String, usize>>,
    pub(super) menu_signature: &'a str,
    pub(super) proxy_signature: Option<&'a str>,
    pub(super) fetched: bool,
}

pub(super) fn reconcile(state_store: &Mutex<Option<TrayMenuState>>, ctx: ReconcileContext<'_>) -> anyhow::Result<()> {
    let tun_mode_available = crate::core::runstate::RUN_STATE.state().tun_capable();
    {
        let mut attached = state_store.lock();
        if let Some(state) = attached.as_mut().filter(|state| state.signature == ctx.menu_signature) {
            let in_place = !ctx.fetched || state.proxy_signature.as_deref() == ctx.proxy_signature;
            let swapped = !in_place
                && ctx.fetched_proxies.is_some_and(|data| {
                    state.swap_proxy_section(
                        ctx.app_handle,
                        ctx.options.mode.unwrap_or(""),
                        ctx.order_map,
                        data,
                        ctx.proxy_signature,
                    )
                });
            if in_place || swapped {
                state.apply_static(&ctx.options, ctx.profiles, tun_mode_available);
                if in_place && let Some(data) = ctx.fetched_proxies {
                    state.apply_proxy(data);
                }
                return Ok(());
            }
        }
    }

    let (menu, mut new_state) = build_tray_menu(
        ctx.app_handle,
        ctx.options,
        ctx.verge,
        ctx.profiles,
        ctx.order_map,
        ctx.fetched_proxies,
    )?;
    new_state.signature = ctx.menu_signature.into();
    new_state.proxy_signature = if ctx.fetched {
        ctx.proxy_signature.map(Into::into)
    } else {
        None
    };
    logging_error!(Type::Tray, ctx.tray.set_menu(Some(menu)));
    *state_store.lock() = Some(new_state);
    Ok(())
}

impl TrayMenuState {
    fn apply_static(&self, options: &TrayMenuOptions<'_>, profiles: &IProfiles, tun_mode_available: bool) {
        let mode = options.mode.unwrap_or("");
        for (item, name) in self.mode_items.iter().zip(["rule", "global", "direct"]) {
            logging_error!(Type::Tray, item.set_checked(mode == name));
        }
        logging_error!(
            Type::Tray,
            self.system_proxy_item.set_checked(options.system_proxy_enabled)
        );
        logging_error!(Type::Tray, self.tun_item.set_enabled(tun_mode_available));
        logging_error!(Type::Tray, self.tun_item.set_checked(options.tun_mode_enabled));
        logging_error!(
            Type::Tray,
            self.lightweight_item.set_checked(options.is_lightweight_mode)
        );
        let current = profiles.current.as_deref();
        for (uid, item) in &self.profile_items {
            logging_error!(Type::Tray, item.set_checked(current == Some(uid.as_str())));
        }
    }

    fn apply_proxy(&mut self, proxy_nodes_data: &Proxies) {
        for group in self.proxy_groups.iter_mut() {
            let Some(group_data) = proxy_nodes_data.proxies.get(group.name.as_str()) else {
                continue;
            };
            let now = group_data.now.as_deref().unwrap_or_default();
            for node in group.nodes.iter_mut() {
                let text: String = format!(
                    "{}   | {}",
                    node.name,
                    proxy_delay_text(proxy_nodes_data, node.name.as_str())
                )
                .into();
                if node.text != text {
                    logging_error!(Type::Tray, node.item.set_text(&text));
                    node.text = text;
                }
                let checked = node.name == now;
                if node.checked != checked {
                    logging_error!(Type::Tray, node.item.set_checked(checked));
                    node.checked = checked;
                }
            }
        }
    }

    fn swap_proxy_section(
        &mut self,
        app_handle: &AppHandle<Wry>,
        proxy_mode: &str,
        order_map: Option<&HashMap<String, usize>>,
        proxy_nodes_data: &Proxies,
        proxy_signature: Option<&str>,
    ) -> bool {
        let Some(proxies_submenu) = self.proxies_submenu.clone() else {
            return false;
        };
        let (group_menus, group_state) =
            create_subcreate_proxy_menu_item(app_handle, proxy_mode, order_map, proxy_nodes_data);
        if group_menus.is_empty() {
            return false;
        }
        while proxies_submenu.remove_at(0).is_ok_and(|item| item.is_some()) {}
        let group_menus_refs: Vec<&dyn IsMenuItem<Wry>> =
            group_menus.iter().map(|menu| menu as &dyn IsMenuItem<Wry>).collect();
        logging_error!(Type::Tray, proxies_submenu.append_items(&group_menus_refs));
        self.proxy_groups = group_state;
        self.proxy_signature = proxy_signature.map(Into::into);
        true
    }
}
