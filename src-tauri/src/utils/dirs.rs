use anyhow::Result;
use std::path::PathBuf;
use tauri::{
    api::path::{home_dir, resource_dir},
    Env, PackageInfo,
};

#[cfg(not(feature = "verge-dev"))]
static APP_DIR: &str = "clash-verge";
#[cfg(feature = "verge-dev")]
static APP_DIR: &str = "clash-verge-dev";

static CLASH_CONFIG: &str = "config.yaml";
static VERGE_CONFIG: &str = "verge.yaml";
static PROFILE_YAML: &str = "profiles.yaml";

static mut RESOURCE_DIR: Option<PathBuf> = None;

/// portable flag
#[allow(unused)]
static mut PORTABLE_FLAG: bool = false;

pub static mut APP_VERSION: &str = "v1.2.0";

/// initialize portable flag
#[cfg(target_os = "windows")]
pub unsafe fn init_portable_flag() -> Result<()> {
    use tauri::utils::platform::current_exe;

    let exe = current_exe()?;

    if let Some(dir) = exe.parent() {
        let dir = PathBuf::from(dir).join(".config/PORTABLE");

        if dir.exists() {
            PORTABLE_FLAG = true;
        }
    }

    Ok(())
}

/// get the verge app home dir
pub fn app_home_dir() -> Result<PathBuf> {
    #[cfg(target_os = "windows")]
    unsafe {
        use tauri::utils::platform::current_exe;

        if !PORTABLE_FLAG {
            Ok(home_dir()
                .ok_or(anyhow::anyhow!("failed to get app home dir"))?
                .join(".config")
                .join(APP_DIR))
        } else {
            let app_exe = current_exe()?;
            let app_exe = dunce::canonicalize(app_exe)?;
            let app_dir = app_exe
                .parent()
                .ok_or(anyhow::anyhow!("failed to get the portable app dir"))?;
            Ok(PathBuf::from(app_dir).join(".config").join(APP_DIR))
        }
    }

    #[cfg(not(target_os = "windows"))]
    Ok(home_dir()
        .ok_or(anyhow::anyhow!("failed to get the app home dir"))?
        .join(".config")
        .join(APP_DIR))
}

/// get the resources dir
pub fn app_resources_dir(package_info: &PackageInfo) -> Result<PathBuf> {
    let res_dir = resource_dir(package_info, &Env::default())
        .ok_or(anyhow::anyhow!("failed to get the resource dir"))?
        .join("resources");

    unsafe {
        RESOURCE_DIR = Some(res_dir.clone());

        let ver = package_info.version.to_string();
        let ver_str = format!("v{ver}");
        APP_VERSION = Box::leak(Box::new(ver_str));
    }

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

#[allow(unused)]
pub fn app_res_dir() -> Result<PathBuf> {
    unsafe {
        Ok(RESOURCE_DIR
            .clone()
            .ok_or(anyhow::anyhow!("failed to get the resource dir"))?)
    }
}

pub fn clash_pid_path() -> Result<PathBuf> {
    unsafe {
        Ok(RESOURCE_DIR
            .clone()
            .ok_or(anyhow::anyhow!("failed to get the resource dir"))?
            .join("clash.pid"))
    }
}

#[cfg(windows)]
pub fn service_path() -> Result<PathBuf> {
    unsafe {
        let res_dir = RESOURCE_DIR
            .clone()
            .ok_or(anyhow::anyhow!("failed to get the resource dir"))?;
        Ok(res_dir.join("clash-verge-service.exe"))
    }
}

#[cfg(windows)]
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
