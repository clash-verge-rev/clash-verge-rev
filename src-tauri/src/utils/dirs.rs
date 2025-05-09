use crate::core::handle;
use anyhow::Result;
use once_cell::sync::OnceCell;
use std::{fs, path::PathBuf};
use tauri::Manager;

#[cfg(not(feature = "verge-dev"))]
pub static APP_ID: &str = "io.github.clash-verge-rev.clash-verge-rev";
#[cfg(not(feature = "verge-dev"))]
pub static BACKUP_DIR: &str = "clash-verge-rev-backup";

#[cfg(feature = "verge-dev")]
pub static APP_ID: &str = "io.github.clash-verge-rev.clash-verge-rev.dev";
#[cfg(feature = "verge-dev")]
pub static BACKUP_DIR: &str = "clash-verge-rev-backup-dev";

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

    // 避免在Handle未初始化时崩溃
    let app_handle = match handle::Handle::global().app_handle() {
        Some(handle) => handle,
        None => {
            log::warn!(target: "app", "app_handle not initialized, using default path");
            // 使用可执行文件目录作为备用
            let exe_path = tauri::utils::platform::current_exe()?;
            let exe_dir = exe_path
                .parent()
                .ok_or(anyhow::anyhow!("failed to get executable directory"))?;

            // 使用系统临时目录 + 应用ID
            #[cfg(target_os = "windows")]
            {
                if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
                    let path = PathBuf::from(local_app_data).join(APP_ID);
                    return Ok(path);
                }
            }

            #[cfg(target_os = "macos")]
            {
                if let Some(home) = std::env::var_os("HOME") {
                    let path = PathBuf::from(home)
                        .join("Library")
                        .join("Application Support")
                        .join(APP_ID);
                    return Ok(path);
                }
            }

            #[cfg(target_os = "linux")]
            {
                if let Some(home) = std::env::var_os("HOME") {
                    let path = PathBuf::from(home)
                        .join(".local")
                        .join("share")
                        .join(APP_ID);
                    return Ok(path);
                }
            }

            // 如果无法获取系统目录，则回退到可执行文件目录
            let fallback_dir = PathBuf::from(exe_dir).join(".config").join(APP_ID);
            log::warn!(target: "app", "Using fallback data directory: {:?}", fallback_dir);
            return Ok(fallback_dir);
        }
    };

    match app_handle.path().data_dir() {
        Ok(dir) => Ok(dir.join(APP_ID)),
        Err(e) => {
            log::error!(target: "app", "Failed to get the app home directory: {}", e);
            Err(anyhow::anyhow!("Failed to get the app homedirectory"))
        }
    }
}

/// get the resources dir
pub fn app_resources_dir() -> Result<PathBuf> {
    // 避免在Handle未初始化时崩溃
    let app_handle = match handle::Handle::global().app_handle() {
        Some(handle) => handle,
        None => {
            log::warn!(target: "app", "app_handle not initialized in app_resources_dir, using fallback");
            // 使用可执行文件目录作为备用
            let exe_dir = tauri::utils::platform::current_exe()?
                .parent()
                .ok_or(anyhow::anyhow!("failed to get executable directory"))?
                .to_path_buf();
            return Ok(exe_dir.join("resources"));
        }
    };

    match app_handle.path().resource_dir() {
        Ok(dir) => Ok(dir.join("resources")),
        Err(e) => {
            log::error!(target: "app", "Failed to get the resource directory: {}", e);
            Err(anyhow::anyhow!("Failed to get the resource directory"))
        }
    }
}

/// profiles dir
pub fn app_profiles_dir() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("profiles"))
}

/// icons dir
pub fn app_icons_dir() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("icons"))
}

pub fn find_target_icons(target: &str) -> Result<Option<String>> {
    let icons_dir = app_icons_dir()?;
    let mut matching_files = Vec::new();

    for entry in fs::read_dir(icons_dir)? {
        let entry = entry?;
        let path = entry.path();

        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            if file_name.starts_with(target)
                && (file_name.ends_with(".ico") || file_name.ends_with(".png"))
            {
                matching_files.push(path);
            }
        }
    }

    if matching_files.is_empty() {
        Ok(None)
    } else {
        let first = path_to_str(matching_files.first().unwrap())?;
        Ok(Some(first.to_string()))
    }
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

#[cfg(target_os = "macos")]
pub fn service_path() -> Result<PathBuf> {
    let res_dir = app_resources_dir()?;
    Ok(res_dir.join("clash-verge-service"))
}

#[cfg(windows)]
pub fn service_path() -> Result<PathBuf> {
    let res_dir = app_resources_dir()?;
    Ok(res_dir.join("clash-verge-service.exe"))
}

pub fn service_log_file() -> Result<PathBuf> {
    use chrono::Local;

    let log_dir = app_logs_dir()?.join("service");

    let local_time = Local::now().format("%Y-%m-%d-%H%M").to_string();
    let log_file = format!("{}.log", local_time);
    let log_file = log_dir.join(log_file);

    let _ = std::fs::create_dir_all(&log_dir);

    Ok(log_file)
}

pub fn path_to_str(path: &PathBuf) -> Result<&str> {
    let path_str = path
        .as_os_str()
        .to_str()
        .ok_or(anyhow::anyhow!("failed to get path from {:?}", path))?;
    Ok(path_str)
}

pub fn get_encryption_key() -> Result<Vec<u8>> {
    let app_dir = app_home_dir()?;
    let key_path = app_dir.join(".encryption_key");

    if key_path.exists() {
        // Read existing key
        fs::read(&key_path).map_err(|e| anyhow::anyhow!("Failed to read encryption key: {}", e))
    } else {
        // Generate and save new key
        let mut key = vec![0u8; 32];
        getrandom::fill(&mut key)?;

        // Ensure directory exists
        if let Some(parent) = key_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| anyhow::anyhow!("Failed to create key directory: {}", e))?;
        }
        // Save key
        fs::write(&key_path, &key)
            .map_err(|e| anyhow::anyhow!("Failed to save encryption key: {}", e))?;
        Ok(key)
    }
}
