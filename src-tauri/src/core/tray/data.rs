use tauri_plugin_mihomo::models::Proxies;

use crate::core::handle;

#[derive(Debug)]
struct MihomoProxies {
    proxies: Proxies,
    epoch: u64,
}

impl MihomoProxies {
    async fn refresh(&mut self) -> anyhow::Result<()> {
        let proxies = handle::Handle::mihomo().await.get_proxies().await?;
        if proxies != self.proxies {
            self.proxies = proxies;
            self.epoch += 1;
        }
        Ok(())
    }
}
