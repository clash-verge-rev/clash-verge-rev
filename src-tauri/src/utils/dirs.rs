use crate::core::{CoreManager, handle, manager::RunningMode};
use anyhow::Result;
use async_trait::async_trait;
use clash_verge_logging::{Type, logging};
use once_cell::sync::OnceCell;
use std::{fs, path::PathBuf};
use tauri::Manager as _;

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
            .ok_or_else(|| anyhow::anyhow!("failed to get the portable app dir"))?;
        return Ok(PathBuf::from(app_dir).join(".config").join(APP_ID));
    }

    // 避免在Handle未初始化时崩溃
    let app_handle = handle::Handle::app_handle();

    match app_handle.path().data_dir() {
        Ok(dir) => Ok(dir.join(APP_ID)),
        Err(e) => {
            logging!(error, Type::File, "Failed to get the app home directory: {e}");
            Err(anyhow::anyhow!("Failed to get the app homedirectory"))
        }
    }
}

pub fn preinit_app_data_dir() -> Result<PathBuf> {
    if PORTABLE_FLAG.get().copied().unwrap_or(false) {
        let executable = std::env::current_exe()?;
        let parent = executable
            .parent()
            .ok_or_else(|| anyhow::anyhow!("portable executable has no parent directory"))?;
        return Ok(parent.join(".config").join(APP_ID));
    }

    #[cfg(target_os = "macos")]
    let root = PathBuf::from(std::env::var_os("HOME").ok_or_else(|| anyhow::anyhow!("HOME is unavailable"))?)
        .join("Library/Application Support");
    #[cfg(target_os = "linux")]
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local/share"));
    #[cfg(windows)]
    let root = PathBuf::from(std::env::var_os("APPDATA").ok_or_else(|| anyhow::anyhow!("APPDATA is unavailable"))?);

    Ok(root.join(APP_ID))
}

/// get the resources dir
pub fn app_resources_dir() -> Result<PathBuf> {
    // 避免在Handle未初始化时崩溃
    let app_handle = handle::Handle::app_handle();

    match app_handle.path().resource_dir() {
        Ok(dir) => Ok(dir.join("resources")),
        Err(e) => {
            logging!(error, Type::File, "Failed to get the resource directory: {e}");
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
    let icon_path = fs::read_dir(&icons_dir)?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .find(|path| {
            let prefix_matches = path
                .file_prefix()
                .and_then(|p| p.to_str())
                .is_some_and(|prefix| prefix.starts_with(target));
            let ext_matches = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("ico") || ext.eq_ignore_ascii_case("png"));
            prefix_matches && ext_matches
        });

    icon_path.map(|path| path_to_str(&path).map(|s| s.into())).transpose()
}

/// logs dir
pub fn app_logs_dir() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("logs"))
}

/// service logs dir
#[cfg(target_os = "macos")]
pub fn service_logs_root_dir() -> Result<PathBuf> {
    Ok(app_home_dir()?.join("service-logs"))
}

/// service logs dir
#[cfg(not(target_os = "macos"))]
pub fn service_logs_root_dir() -> Result<PathBuf> {
    app_logs_dir()
}

// latest verge log
pub fn app_latest_log() -> Result<PathBuf> {
    Ok(app_logs_dir()?.join("latest.log"))
}

/// local backups dir
pub fn local_backup_dir() -> Result<PathBuf> {
    let dir = app_home_dir()?.join(BACKUP_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir)
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

pub fn sidecar_log_dir() -> Result<PathBuf> {
    let log_dir = app_logs_dir()?.join("sidecar");
    let _ = std::fs::create_dir_all(&log_dir);

    Ok(log_dir)
}

pub fn service_log_dir() -> Result<PathBuf> {
    let log_dir = service_logs_root_dir()?.join("service");
    let _ = std::fs::create_dir_all(&log_dir);

    Ok(log_dir)
}

pub fn clash_latest_log() -> Result<PathBuf> {
    match *CoreManager::global().get_running_mode() {
        RunningMode::Service => Ok(service_log_dir()?.join("service_latest.log")),
        RunningMode::Sidecar | RunningMode::NotRunning => Ok(sidecar_log_dir()?.join("sidecar_latest.log")),
    }
}

pub fn path_to_str(path: &PathBuf) -> Result<&str> {
    let path_str = path
        .as_os_str()
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("failed to get path from {:?}", path))?;
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
            fs::create_dir_all(parent).map_err(|e| anyhow::anyhow!("Failed to create key directory: {}", e))?;
        }
        // Save key
        fs::write(&key_path, &key).map_err(|e| anyhow::anyhow!("Failed to save encryption key: {}", e))?;
        Ok(key)
    }
}

pub fn ipc_path() -> Result<PathBuf> {
    Ok(PathBuf::from(clash_verge_service_ipc::mihomo_ipc_path(
        &crate::core::owner_identity::current_owner_identity()?,
    )))
}

#[cfg(target_os = "macos")]
pub fn sidecar_ipc_path() -> Result<PathBuf> {
    sidecar_ipc_path_for(
        std::path::Path::new(""),
        &crate::core::owner_identity::current_owner_identity()?,
    )
}

#[cfg(not(target_os = "macos"))]
pub fn sidecar_ipc_path() -> Result<PathBuf> {
    Ok(sidecar_ipc_path_for(
        &preinit_app_data_dir()?,
        &crate::core::owner_identity::current_owner_identity()?,
    ))
}

#[cfg(target_os = "linux")]
fn sidecar_ipc_path_for(app_root: &std::path::Path, _identity: &clash_verge_service_ipc::OwnerIdentity) -> PathBuf {
    app_root.join("verge-mihomo.sock")
}

#[cfg(target_os = "macos")]
fn sidecar_ipc_path_for(
    _app_root: &std::path::Path,
    _identity: &clash_verge_service_ipc::OwnerIdentity,
) -> Result<PathBuf> {
    use std::{ffi::OsStr, os::unix::ffi::OsStrExt as _};

    // SAFETY: A null buffer with size zero asks confstr for the required buffer length.
    let required_len = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, std::ptr::null_mut(), 0) };
    if required_len == 0 {
        return Err(anyhow::anyhow!("macOS per-user temporary directory is unavailable"));
    }

    let mut buffer = vec![0_u8; required_len];
    // SAFETY: buffer is writable for buffer.len() bytes, as required by confstr.
    let written = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, buffer.as_mut_ptr().cast(), buffer.len()) };
    if written == 0 || written > buffer.len() {
        return Err(anyhow::anyhow!("failed to read macOS per-user temporary directory"));
    }

    let root = std::ffi::CStr::from_bytes_until_nul(&buffer)
        .map_err(|_| anyhow::anyhow!("macOS per-user temporary directory is not NUL-terminated"))?;
    #[cfg(feature = "verge-dev")]
    let filename = "verge-mihomo-dev.sock";
    #[cfg(not(feature = "verge-dev"))]
    let filename = "verge-mihomo.sock";
    let path = PathBuf::from(OsStr::from_bytes(root.to_bytes())).join(filename);

    let path_len = path.as_os_str().as_bytes().len();
    if path_len >= 104 {
        return Err(anyhow::anyhow!(
            "macOS Sidecar IPC path is {path_len} bytes, but sockaddr_un.sun_path requires fewer than 104 bytes: {:?}",
            path,
        ));
    }

    Ok(path)
}

#[cfg(windows)]
fn sidecar_ipc_path_for(_app_root: &std::path::Path, identity: &clash_verge_service_ipc::OwnerIdentity) -> PathBuf {
    PathBuf::from(format!(
        r"\\.\pipe\verge-mihomo-sidecar-{}",
        clash_verge_service_ipc::owner_key(identity)
    ))
}

#[cfg(all(test, target_os = "linux"))]
mod ipc_tests {
    use super::sidecar_ipc_path_for;
    use clash_verge_service_ipc::OwnerIdentity;
    use std::path::Path;

    #[test]
    fn sidecar_ipc_stays_in_the_app_root() {
        let identity = OwnerIdentity::Unix { uid: 501, gid: 20 };
        let app_root = Path::new("/home/test/.local/share/io.github.clash-verge-rev.clash-verge-rev");
        let path = sidecar_ipc_path_for(app_root, &identity);

        assert_eq!(path, app_root.join("verge-mihomo.sock"));
        assert_ne!(
            path.to_string_lossy(),
            clash_verge_service_ipc::mihomo_ipc_path(&identity)
        );
    }
}

#[cfg(all(test, target_os = "macos"))]
mod ipc_tests {
    use super::sidecar_ipc_path_for;
    use clash_verge_service_ipc::OwnerIdentity;
    use std::{ffi::OsStr, os::unix::ffi::OsStrExt, path::Path};

    #[test]
    fn sidecar_ipc_ignores_long_app_root_and_fits_sockaddr_un() {
        let identity = OwnerIdentity::Unix { uid: 501, gid: 20 };
        let app_root =
            Path::new("/Users/support/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev.dev");
        let path = sidecar_ipc_path_for(app_root, &identity).expect("macOS should provide a per-user temp directory");

        assert!(!path.starts_with(app_root));
        assert!(path.as_os_str().as_bytes().len() < 104);
        #[cfg(feature = "verge-dev")]
        assert_eq!(path.file_name(), Some(OsStr::new("verge-mihomo-dev.sock")));
        #[cfg(not(feature = "verge-dev"))]
        assert_eq!(path.file_name(), Some(OsStr::new("verge-mihomo.sock")));
        assert_eq!(
            path,
            sidecar_ipc_path_for(Path::new("/different/root"), &identity).unwrap()
        );
        assert!(path.parent().is_some_and(Path::is_dir));
    }
}

#[cfg(all(test, windows))]
mod ipc_tests {
    use super::sidecar_ipc_path_for;
    use clash_verge_service_ipc::OwnerIdentity;
    use std::path::Path;

    #[test]
    fn sidecar_ipc_uses_the_current_owners_named_pipe() {
        let identity = OwnerIdentity::Windows {
            sid: "S-1-5-21-1000".to_owned(),
        };
        let path = sidecar_ipc_path_for(Path::new(r"C:\ignored"), &identity);

        assert_eq!(
            path,
            Path::new(&format!(
                r"\\.\pipe\verge-mihomo-sidecar-{}",
                clash_verge_service_ipc::owner_key(&identity)
            ))
        );
    }
}
#[async_trait]
pub trait PathBufExec {
    async fn remove_if_exists(&self) -> Result<()>;
}

#[async_trait]
impl PathBufExec for PathBuf {
    async fn remove_if_exists(&self) -> Result<()> {
        if self.exists() {
            tokio::fs::remove_file(self).await?;
            logging!(info, Type::File, "Removed file: {:?}", self);
        }
        Ok(())
    }
}
