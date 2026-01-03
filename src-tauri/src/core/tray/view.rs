use std::borrow::Cow;

use crate::config::IVerge;

pub type IconBytes = Cow<'static, [u8]>;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProxyStatus {
    #[default]
    // Not Proxy, Not TUN
    Idle,
    // Proxy Enabled, Not TUN
    Proxy,
    // Not Proxy, TUN Enabled
    TUN,
    // Proxy Enabled, TUN Enabled
    ProxyTUN,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) enum IconStyle {
    #[default]
    Normal,
    Custom,
    Monochrome,
}

impl From<bool> for IconStyle {
    fn from(is_monochrome: bool) -> Self {
        if is_monochrome {
            IconStyle::Monochrome
        } else {
            IconStyle::Normal
        }
    }
}

impl Into<bool> for IconStyle {
    fn into(self) -> bool {
        match self {
            IconStyle::Monochrome => true,
            _ => false,
        }
    }
}

pub(crate) trait TrayState {
    async fn parse_icon_from_verge(verge: &IVerge) -> (IconStyle, IconBytes);
    async fn get_tray_icon(proxy_status: ProxyStatus, style: IconStyle) -> (IconStyle, IconBytes);
}

pub(crate) struct TrayStateImpl;
