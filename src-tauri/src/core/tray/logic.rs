use std::borrow::Cow;

use tokio::fs;

use crate::{
    config::IVerge,
    core::tray::view::{IconBytes, IconStyle, ProxyStatus, TrayState, TrayStateImpl},
    utils::dirs::find_target_icons,
};

impl TrayState for TrayStateImpl {
    async fn parse_icon_from_verge(verge: &IVerge) -> (IconStyle, IconBytes) {
        let enable_proxy = verge.enable_system_proxy.unwrap_or(false);
        let enable_tun = verge.enable_tun_mode.unwrap_or(false);
        let proxy_status = calculate_icon_status(enable_proxy, enable_tun);

        let is_custom = match proxy_status {
            ProxyStatus::Idle => verge.common_tray_icon,
            ProxyStatus::Proxy => verge.sysproxy_tray_icon,
            _ => verge.tun_tray_icon,
        }
        .unwrap_or(false);
        if is_custom {
            if let Some(bytes) = get_custom_icon_bytes(proxy_status).await {
                return (IconStyle::Custom, bytes);
            }
        }

        let is_monochrome = cfg!(target_os = "macos") && verge.tray_icon.as_deref() == Some("monochrome");
        Self::get_tray_icon(proxy_status, is_monochrome.into()).await
    }

    async fn get_tray_icon(proxy_status: ProxyStatus, style: IconStyle) -> (IconStyle, IconBytes) {
        Self::get_builtin_icon(proxy_status, style)
    }
}

impl TrayStateImpl {
    fn get_builtin_icon(status: ProxyStatus, style: IconStyle) -> (IconStyle, IconBytes) {
        let is_mono = cfg!(target_os = "macos") && style == IconStyle::Monochrome;

        let bytes = match (status, is_mono) {
            (ProxyStatus::Idle, true) => include_bytes!("../../../icons/tray-icon-mono.ico").as_slice(),
            (ProxyStatus::Idle, false) => include_bytes!("../../../icons/tray-icon.ico").as_slice(),

            (ProxyStatus::Proxy, true) => include_bytes!("../../../icons/tray-icon-sys-mono-new.ico").as_slice(),
            (ProxyStatus::Proxy, false) => include_bytes!("../../../icons/tray-icon-sys.ico").as_slice(),

            (_, true) => include_bytes!("../../../icons/tray-icon-tun-mono-new.ico").as_slice(),
            (_, false) => include_bytes!("../../../icons/tray-icon-tun.ico").as_slice(),
        };

        (
            if is_mono {
                IconStyle::Monochrome
            } else {
                IconStyle::Normal
            },
            Cow::Borrowed(bytes),
        )
    }
}

fn calculate_icon_status(enable_proxy: bool, enable_tun: bool) -> ProxyStatus {
    match (enable_proxy, enable_tun) {
        (false, false) => ProxyStatus::Idle,
        (true, false) => ProxyStatus::Proxy,
        (false, true) => ProxyStatus::TUN,
        (true, true) => ProxyStatus::ProxyTUN,
    }
}

async fn get_custom_icon_bytes(target: ProxyStatus) -> Option<IconBytes> {
    let tag = match target {
        ProxyStatus::Idle => "common",
        ProxyStatus::Proxy => "sysproxy",
        _ => "tun",
    };

    let path = find_target_icons(tag).ok()??;
    fs::read(path).await.ok().map(Cow::Owned)
}
