use super::{Draft, IClashTemp, IProfiles, IVerge};
use crate::config::ClashN;
use once_cell::sync::OnceCell;
use serde_yaml::Mapping;

pub struct Config {
    clash_config: Draft<IClashTemp>,
    verge_config: Draft<IVerge>,
    profiles_config: Draft<IProfiles>,
}

impl Config {
    pub fn global() -> &'static Config {
        static CONFIG: OnceCell<Config> = OnceCell::new();

        CONFIG.get_or_init(|| Config {
            clash_config: Draft::from(IClashTemp::new()),
            verge_config: Draft::from(IVerge::new()),
            profiles_config: Draft::from(IProfiles::new()),
        })
    }

    // pub fn clash<'a>() -> MappedMutexGuard<'a, IClash> {
    //     Self::global().clash_config.latest()
    // }

    // pub fn verge<'a>() -> MappedMutexGuard<'a, IVerge> {
    //     Self::global().verge_config.latest()
    // }

    // pub fn profiles<'a>() -> MappedMutexGuard<'a, IProfiles> {
    //     Self::global().profiles_config.latest()
    // }

    pub fn clash() -> Draft<IClashTemp> {
        Self::global().clash_config.clone()
    }

    pub fn verge() -> Draft<IVerge> {
        Self::global().verge_config.clone()
    }

    pub fn profiles() -> Draft<IProfiles> {
        Self::global().profiles_config.clone()
    }
}
