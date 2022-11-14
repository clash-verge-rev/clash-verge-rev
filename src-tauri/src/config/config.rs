use super::{Draft, IVerge};
use once_cell::sync::OnceCell;

pub struct Config {
    verge_config: Draft<IVerge>,
}

impl Config {
    pub fn global() -> &'static Config {
        static CONFIG: OnceCell<Config> = OnceCell::new();

        CONFIG.get_or_init(|| Config {
            verge_config: Draft::from(IVerge::new()),
        })
    }

    pub fn verge() -> Draft<IVerge> {
        Self::global().verge_config.clone()
    }
}
