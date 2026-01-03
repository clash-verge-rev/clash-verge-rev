use std::borrow::Cow;

use tokio::fs;

use crate::{
    config::IVerge,
    core::tray::view::{
        CacheComponent, IconBytes, IconStyle, ProxyStatus, TrayComponent, TrayIcon, TrayIconCache, TrayIconView,
    },
    utils::dirs::find_target_icons,
};
impl TrayIcon {
    const fn calculate_icon_status(enable_proxy: bool, enable_tun: bool) -> ProxyStatus {
        match (enable_proxy, enable_tun) {
            (false, false) => ProxyStatus::Idle,
            (true, false) => ProxyStatus::Proxy,
            (false, true) => ProxyStatus::Tun,
            (true, true) => ProxyStatus::ProxyTUN,
        }
    }

    const fn get_builtin_icon(status: ProxyStatus, is_monochrome: bool) -> (IconStyle, IconBytes) {
        let bytes = match (status, is_monochrome) {
            (ProxyStatus::Idle, true) => include_bytes!("../../../icons/tray-icon-mono.ico").as_slice(),
            (ProxyStatus::Idle, false) => include_bytes!("../../../icons/tray-icon.ico").as_slice(),

            (ProxyStatus::Proxy, true) => include_bytes!("../../../icons/tray-icon-sys-mono-new.ico").as_slice(),
            (ProxyStatus::Proxy, false) => include_bytes!("../../../icons/tray-icon-sys.ico").as_slice(),

            (_, true) => include_bytes!("../../../icons/tray-icon-tun-mono-new.ico").as_slice(),
            (_, false) => include_bytes!("../../../icons/tray-icon-tun.ico").as_slice(),
        };

        (
            if is_monochrome {
                IconStyle::Monochrome
            } else {
                IconStyle::Normal
            },
            Cow::Borrowed(bytes),
        )
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

    async fn from_verge(verge: &IVerge, proxy_status: ProxyStatus, is_monochrome: bool) -> (IconStyle, IconBytes) {
        let is_custom = match proxy_status {
            ProxyStatus::Idle => verge.common_tray_icon,
            ProxyStatus::Proxy => verge.sysproxy_tray_icon,
            _ => verge.tun_tray_icon,
        }
        .unwrap_or(false);
        if is_custom && let Some(bytes) = Self::get_custom_icon_bytes(proxy_status).await {
            return (IconStyle::Custom, bytes);
        }

        Self::get_builtin_icon(proxy_status, is_monochrome)
    }
}

impl CacheComponent for TrayIcon {
    type Cache = TrayIconCache;
    type View<'a>
        = TrayIconView<'a>
    where
        Self: 'a;

    fn is_some(&self) -> bool {
        !self.0.last_icon_bytes.is_empty()
    }

    fn get(&self) -> Self::View<'_> {
        TrayIconView {
            last_icon_style: &self.0.last_icon_style,
            last_icon_bytes: &self.0.last_icon_bytes,
        }
    }

    fn update(&mut self, t: Self::Cache) {
        self.0 = t;
    }

    /// We assume the cache is equal when both status and style are equal
    /// and ignore the actual icon bytes comparison
    fn equals(&self, other: &Self::Cache) -> bool {
        self.0.last_proxy_status == other.last_proxy_status && self.0.last_icon_style == other.last_icon_style
    }
}

#[async_trait::async_trait]
impl TrayComponent for TrayIcon {
    type Context = IVerge;

    async fn refresh(&mut self, force: bool, verge: &Self::Context) -> bool {
        let enable_proxy = verge.enable_system_proxy.unwrap_or(false);
        let enable_tun = verge.enable_tun_mode.unwrap_or(false);
        let is_monochrome = cfg!(target_os = "macos") && verge.tray_icon.as_deref() == Some("monochrome");

        let target_status = Self::calculate_icon_status(enable_proxy, enable_tun);
        let target_style = if is_monochrome {
            IconStyle::Monochrome
        } else {
            IconStyle::Normal
        };

        let cmpare_cache = TrayIconCache {
            last_icon_style: target_style,
            last_proxy_status: target_status,
            last_icon_bytes: Cow::Borrowed(&[]),
        };
        if !force && self.is_some() && self.equals(&cmpare_cache) {
            return false;
        }

        let (icon_style, icon_bytes) = Self::from_verge(verge, target_status, is_monochrome).await;
        self.update(TrayIconCache {
            last_icon_style: icon_style,
            last_proxy_status: target_status,
            last_icon_bytes: icon_bytes,
        });

        true
    }
}
