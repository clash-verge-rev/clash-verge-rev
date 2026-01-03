use std::borrow::Cow;

pub type IconBytes = Cow<'static, [u8]>;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProxyStatus {
    #[default]
    // Not Proxy, Not TUN
    Idle,
    // Proxy Enabled, Not TUN
    Proxy,
    // Not Proxy, TUN Enabled
    Tun,
    // Proxy Enabled, TUN Enabled
    ProxyTUN,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IconStyle {
    #[default]
    Normal,
    Custom,
    Monochrome,
}

#[async_trait::async_trait]
pub(crate) trait TrayComponent: CacheComponent {
    type Context;

    async fn refresh(&mut self, force: bool, ctx: &Self::Context) -> bool;
}

pub(crate) trait CacheComponent {
    type Cache;
    type View<'a>
    where
        Self: 'a;

    fn is_some(&self) -> bool;
    fn get(&self) -> Self::View<'_>;
    fn update(&mut self, t: Self::Cache);
    fn equals(&self, other: &Self::Cache) -> bool;
}

#[derive(Default)]
pub(crate) struct TrayIconCache {
    pub(crate) last_icon_style: IconStyle,
    pub(crate) last_proxy_status: ProxyStatus,
    pub(crate) last_icon_bytes: IconBytes,
}

pub(crate) struct TrayIconView<'a> {
    pub(crate) last_icon_style: &'a IconStyle,
    pub(crate) last_icon_bytes: &'a IconBytes,
}

#[derive(Default)]
pub(crate) struct TrayIcon(pub TrayIconCache);
