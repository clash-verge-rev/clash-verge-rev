#[derive(Clone)]
pub struct MihomoManager {
    pub(crate) mihomo_server: String,
    pub(crate) client: reqwest::Client,
}
