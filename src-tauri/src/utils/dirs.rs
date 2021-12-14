use std::path::{Path, PathBuf};
use tauri::{
  api::path::{home_dir, resource_dir},
  PackageInfo,
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
  resource_dir(package_info).unwrap().join("resources")
}
