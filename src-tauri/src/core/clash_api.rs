use anyhow::Result;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rate {
    pub up: u64,
    pub down: u64,
}

#[cfg(target_os = "macos")]
pub fn get_traffic_ws_url() -> Result<String> {
    use crate::module::mihomo::MihomoManager;

    let (url, _) = MihomoManager::get_clash_client_info().unwrap();
    let ws_url = url.replace("http://", "ws://") + "/traffic";
    Ok(ws_url)
}