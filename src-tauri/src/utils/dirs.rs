use std::env::temp_dir;
use std::path::{Path, PathBuf};
use tauri::{
  api::path::{home_dir, resource_dir},
  Env, PackageInfo,
};

/// get the verge app home dir
pub fn app_home_dir() -> PathBuf {
  home_dir()
    .unwrap()
    .join(Path::new(".config"))
    .join(Path::new("clash-verge"))
}

/// get the resources dir
pub fn app_resources_dir(package_info: &PackageInfo) -> PathBuf {
  resource_dir(package_info, &Env::default())
    .unwrap()
    .join("resources")
}

/// profiles dir
pub fn app_profiles_dir() -> PathBuf {
  app_home_dir().join("profiles")
}

/// logs dir
pub fn app_logs_dir() -> PathBuf {
  app_home_dir().join("logs")
}

static CLASH_CONFIG: &str = "config.yaml";
static VERGE_CONFIG: &str = "verge.yaml";
static PROFILE_YAML: &str = "profiles.yaml";
static PROFILE_TEMP: &str = "clash-verge-runtime.yaml";

pub fn clash_path() -> PathBuf {
  app_home_dir().join(CLASH_CONFIG)
}

pub fn verge_path() -> PathBuf {
  app_home_dir().join(VERGE_CONFIG)
}

pub fn profiles_path() -> PathBuf {
  app_home_dir().join(PROFILE_YAML)
}

pub fn profiles_temp_path() -> PathBuf {
  temp_dir().join(PROFILE_TEMP)
}
