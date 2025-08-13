use crate::core::handle;
use anyhow::Result;
use dirs::data_dir;
use once_cell::sync::OnceCell;
use std::path::PathBuf;

#[cfg(not(feature = "verge-dev"))]
pub static APP_ID: &str = "io.github.oomeow.clash-verge-self";
#[cfg(feature = "verge-dev")]
pub static APP_ID: &str = "io.github.oomeow.clash-verge-self.dev";

pub static PORTABLE_FLAG: OnceCell<bool> = OnceCell::new();

pub static CLASH_CONFIG: &str = "config.yaml";
pub static VERGE_CONFIG: &str = "verge.yaml";
pub static PROFILE_YAML: &str = "profiles.yaml";

/// init portable flag
pub fn init_portable_flag() -> Result<()> {
    use tauri::utils::platform::current_exe;

    let app_exe = current_exe()?;
    if let Some(dir) = app_exe.parent() {
        let dir = PathBuf::from(dir).join(".config/PORTABLE");

        if dir.exists() {
            PORTABLE_FLAG.get_or_init(|| true);
        }
    }
    PORTABLE_FLAG.get_or_init(|| false);
    Ok(())
}

/// get the verge app home dir
pub fn app_home_dir() -> Result<PathBuf> {
    use tauri::utils::platform::current_exe;

    let flag = PORTABLE_FLAG.get().unwrap_or(&false);
    if *flag {
        let app_exe = current_exe()?;
        let app_exe = dunce::canonicalize(app_exe)?;
        let app_dir = app_exe
            .parent()
            .ok_or(anyhow::anyhow!("failed to get the portable app dir"))?;
        return Ok(PathBuf::from(app_dir).join(".config").join(APP_ID));
    }

    Ok(data_dir()
        .ok_or(anyhow::anyhow!("failed to get app home dir"))?
        .join(APP_ID))
}

/// get the resources dir
pub fn app_resources_dir() -> Result<PathBuf> {
    use tauri::{Env, utils::platform::resource_dir};

    let app_handle = handle::Handle::app_handle();
    let res_dir = resource_dir(app_handle.package_info(), &Env::default())
        .map_err(|_| anyhow::anyhow!("failed to get the resource dir"))?
        .join("resources");
    Ok(res_dir)
}

/// profiles dir
pub fn app_profiles_dir() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("profiles"))
}

/// logs dir
pub fn app_logs_dir() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("logs"))
}

pub fn clash_path() -> Result<PathBuf> {
    Ok(app_home_dir()?.join(CLASH_CONFIG))
}

pub fn verge_path() -> Result<PathBuf> {
    Ok(app_home_dir()?.join(VERGE_CONFIG))
}

pub fn profiles_path() -> Result<PathBuf> {
    Ok(app_home_dir()?.join(PROFILE_YAML))
}

pub fn service_path() -> Result<PathBuf> {
    let exe_ext = std::env::consts::EXE_SUFFIX;
    let service_bin = format!("clash-verge-service{}", exe_ext);
    Ok(app_resources_dir()?.join(service_bin))
}

pub fn backup_dir() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("backup"))
}

pub fn backup_archive_file() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("archive.zip"))
}

pub fn service_log_file() -> Result<PathBuf> {
    use chrono::Local;

    let log_dir = app_logs_dir()?.join("service");
    let local_time = Local::now().format("%Y-%m-%d-%H%M").to_string();
    let log_file = format!("{local_time}.log");
    let log_file = log_dir.join(log_file);
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir)?;
    }
    if !log_file.exists() {
        std::fs::File::create(&log_file)?;
    }
    Ok(log_file)
}

pub fn path_to_str(path: &PathBuf) -> Result<&str> {
    let path_str = path
        .as_os_str()
        .to_str()
        .ok_or(anyhow::anyhow!("failed to get path from {:?}", path))?;
    Ok(path_str)
}
