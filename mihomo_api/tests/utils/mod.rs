use anyhow::Result;
use mihomo_api::{model::Protocol, Mihomo, MihomoBuilder};

pub fn default_mihomo() -> Result<Mihomo> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("IAzIM_8wH6ftJxjRXDcS6")
        .build()?;
    Ok(mihomo)
}
