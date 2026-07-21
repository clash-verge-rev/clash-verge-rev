use super::resolve;
use crate::{
    config::{Config, DEFAULT_PAC},
    module::lightweight,
    process::AsyncHandler,
    utils::{dirs, window_manager::WindowManager},
};
use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging, logging_error};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use reqwest::ClientBuilder;
use serde::{Deserialize, Serialize};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::oneshot;
use warp::Filter as _;

const INSTANCE_TOKEN_HEADER: &str = "x-instance-token";
const INSTANCE_RECORD_FILE: &str = "singleton-instance.json";
const INSTANCE_LOCK_FILE: &str = "singleton-instance.lock";

#[derive(Deserialize, Debug)]
struct QueryParam {
    param: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct InstanceRecord {
    port: u16,
    token: String,
}

static SHUTDOWN_SENDER: OnceCell<Mutex<Option<oneshot::Sender<()>>>> = OnceCell::new();
static EMBEDDED_PORT: OnceCell<u16> = OnceCell::new();
static INSTANCE_RECORD_PATH: OnceCell<PathBuf> = OnceCell::new();
static INSTANCE_LOCK: OnceCell<std::fs::File> = OnceCell::new();
static PAC_AVAILABLE: AtomicBool = AtomicBool::new(true);
static COMMANDS_READY: AtomicBool = AtomicBool::new(false);

pub async fn check_singleton() -> Result<()> {
    let record_path = instance_record_path()?;
    let lock = open_instance_lock(&record_path.with_file_name(INSTANCE_LOCK_FILE))?;
    if !try_lock_instance(&lock)? {
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < deadline {
            if let Ok(record) = read_instance_record(&record_path)
                && notify_existing_instance(&record).await
            {
                bail!("app exists");
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        bail!("another app instance is starting");
    }

    let existing = read_instance_record(&record_path).ok();
    if let Some(record) = existing.as_ref()
        && notify_existing_instance(record).await
    {
        bail!("app exists");
    }

    let preferred = existing.as_ref().map_or(0, |record| record.port);
    let listener = match tokio::net::TcpListener::bind(std::net::SocketAddrV4::new(
        std::net::Ipv4Addr::LOCALHOST,
        preferred,
    ))
    .await
    {
        Ok(listener) => listener,
        Err(_) => {
            for _ in 0..10 {
                if let Ok(record) = read_instance_record(&record_path)
                    && notify_existing_instance(&record).await
                {
                    bail!("app exists");
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            tokio::net::TcpListener::bind(std::net::SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 0)).await?
        }
    };
    let port = listener.local_addr()?.port();
    let record = InstanceRecord {
        port,
        token: random_token()?,
    };
    write_instance_record(&record_path, &record)?;
    INSTANCE_LOCK
        .set(lock)
        .map_err(|_| anyhow::anyhow!("singleton lock is already initialized"))?;
    let _ = INSTANCE_RECORD_PATH.set(record_path);
    let _ = EMBEDDED_PORT.set(port);
    start_embedded_server(listener, record.token);
    Ok(())
}

async fn notify_existing_instance(record: &InstanceRecord) -> bool {
    let client = match ClientBuilder::new().timeout(Duration::from_millis(500)).build() {
        Ok(client) => client,
        Err(_) => return false,
    };
    #[cfg(not(target_os = "macos"))]
    let request = if let Some(arg) = std::env::args().nth(1).as_deref() {
        if arg.starts_with("clash:") {
            client
                .get(format!("http://127.0.0.1:{}/commands/scheme", record.port))
                .query(&[("param", arg)])
        } else {
            client.get(format!("http://127.0.0.1:{}/commands/visible", record.port))
        }
    } else {
        client.get(format!("http://127.0.0.1:{}/commands/visible", record.port))
    };
    #[cfg(target_os = "macos")]
    let request = client.get(format!("http://127.0.0.1:{}/commands/visible", record.port));

    request
        .header(INSTANCE_TOKEN_HEADER, &record.token)
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

fn start_embedded_server(listener: tokio::net::TcpListener, token: String) {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let _ = SHUTDOWN_SENDER.set(Mutex::new(Some(shutdown_tx)));

    let auth = warp::header::optional::<String>(INSTANCE_TOKEN_HEADER)
        .and_then(move |provided: Option<String>| {
            let token = token.clone();
            async move {
                if provided.as_deref() == Some(token.as_str()) {
                    Ok::<(), warp::Rejection>(())
                } else {
                    Err(warp::reject())
                }
            }
        })
        .untuple_one();

    let visible = warp::path!("commands" / "visible").and_then(|| async {
        if !COMMANDS_READY.load(Ordering::Acquire) {
            return Ok::<_, warp::Rejection>(warp::reply::with_status(
                "starting".to_string(),
                warp::http::StatusCode::SERVICE_UNAVAILABLE,
            ));
        }
        logging!(info, Type::Window, "检测到从单例模式恢复应用窗口");
        if crate::APP_HANDLE.get().is_some() {
            if !lightweight::exit_lightweight_mode().await {
                WindowManager::show_main_window().await;
            } else {
                logging!(error, Type::Window, "轻量模式退出失败，无法恢复应用窗口");
            }
        }
        Ok::<_, warp::Rejection>(warp::reply::with_status("ok".to_string(), warp::http::StatusCode::OK))
    });

    let pac = warp::path!("commands" / "pac").and_then(|| async move {
        if !PAC_AVAILABLE.load(Ordering::Acquire) {
            return Ok::<_, warp::Rejection>(
                warp::http::Response::builder()
                    .status(warp::http::StatusCode::SERVICE_UNAVAILABLE)
                    .body("PAC endpoint is inactive".to_string())
                    .unwrap_or_default(),
            );
        }
        let verge_config = Config::verge().await;
        let clash_config = Config::clash().await;
        let verge_data = verge_config.data_arc();
        let clash_data = clash_config.data_arc();
        let pac_content = verge_data.pac_file_content.as_deref().unwrap_or(DEFAULT_PAC);
        let pac_port = verge_data
            .verge_mixed_port
            .unwrap_or_else(|| clash_data.get_mixed_port());
        let processed_content = pac_content.replace("%mixed-port%", &format!("{pac_port}"));
        Ok::<_, warp::Rejection>(
            warp::http::Response::builder()
                .header("Content-Type", "application/x-ns-proxy-autoconfig")
                .body(processed_content)
                .unwrap_or_default(),
        )
    });

    let scheme = warp::path!("commands" / "scheme")
        .and(warp::query::<QueryParam>())
        .and_then(|query: QueryParam| async move {
            if !COMMANDS_READY.load(Ordering::Acquire) {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    "starting".to_string(),
                    warp::http::StatusCode::SERVICE_UNAVAILABLE,
                ));
            }
            AsyncHandler::spawn(|| async move {
                logging_error!(Type::Setup, resolve::resolve_scheme(&query.param).await);
            });
            Ok::<_, warp::Rejection>(warp::reply::with_status("ok".to_string(), warp::http::StatusCode::OK))
        });

    let commands = auth.clone().and(visible).or(auth.and(scheme)).or(pac);
    AsyncHandler::spawn(move || async move {
        warp::serve(commands)
            .incoming(listener)
            .graceful(async {
                shutdown_rx.await.ok();
            })
            .run()
            .await;
    });
}

pub fn set_pac_available(available: bool) {
    PAC_AVAILABLE.store(available, Ordering::Release);
}

pub fn set_commands_ready() {
    COMMANDS_READY.store(true, Ordering::Release);
}

pub fn embed_server() {
    if EMBEDDED_PORT.get().is_none() {
        logging!(
            error,
            Type::Window,
            "embedded server was not reserved during singleton check"
        );
    }
}

pub fn embedded_server_port() -> Result<u16> {
    EMBEDDED_PORT
        .get()
        .copied()
        .context("embedded server port is not initialized")
}

pub fn shutdown_embedded_server() {
    logging!(info, Type::Window, "shutting down embedded server");
    if let Some(sender) = SHUTDOWN_SENDER.get()
        && let Some(sender) = sender.lock().take()
    {
        sender.send(()).ok();
    }
    if let Some(path) = INSTANCE_RECORD_PATH.get()
        && let Ok(record) = read_instance_record(path)
        && EMBEDDED_PORT.get().is_some_and(|port| *port == record.port)
    {
        let _ = std::fs::remove_file(path);
    }
}

fn instance_record_path() -> Result<PathBuf> {
    Ok(dirs::preinit_app_data_dir()?.join(INSTANCE_RECORD_FILE))
}

fn open_instance_lock(path: &Path) -> Result<std::fs::File> {
    let parent = path.parent().context("singleton lock has no parent")?;
    std::fs::create_dir_all(parent)?;
    #[cfg(windows)]
    return crate::core::owner_identity::open_or_create_private_current_user_file(path);

    #[cfg(unix)]
    let mut options = std::fs::OpenOptions::new();
    #[cfg(unix)]
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(unix)]
    let file = options.open(path)?;
    #[cfg(unix)]
    let metadata = file.metadata()?;
    #[cfg(unix)]
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("singleton lock is not an ordinary file");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(file)
}

fn try_lock_instance(file: &std::fs::File) -> Result<bool> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd as _;
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result == 0 {
            return Ok(true);
        }
        let error = std::io::Error::last_os_error();
        if error
            .raw_os_error()
            .is_some_and(|code| code == libc::EWOULDBLOCK || code == libc::EAGAIN)
        {
            return Ok(false);
        }
        Err(error).context("failed to lock singleton file")
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle as _;
        use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, GetLastError};
        use windows_sys::Win32::Storage::FileSystem::LockFile;
        let locked = unsafe { LockFile(file.as_raw_handle(), 0, 0, u32::MAX, u32::MAX) };
        if locked != 0 {
            return Ok(true);
        }
        if unsafe { GetLastError() } == ERROR_LOCK_VIOLATION {
            return Ok(false);
        }
        Err(std::io::Error::last_os_error()).context("failed to lock singleton file")
    }
}

fn random_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn read_instance_record(path: &Path) -> Result<InstanceRecord> {
    #[cfg(windows)]
    let mut file = crate::core::owner_identity::open_private_current_user_file(path)?;
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut options = std::fs::OpenOptions::new();
        options.read(true).custom_flags(libc::O_NOFOLLOW);
        options.open(path)?
    };
    let metadata = file.metadata()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("singleton record is not an ordinary file");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.permissions().mode() & 0o777 != 0o600 {
            bail!("singleton record permissions are invalid");
        }
    }
    let mut content = Vec::new();
    file.read_to_end(&mut content)?;
    Ok(serde_json::from_slice(&content)?)
}

fn write_instance_record(path: &Path, record: &InstanceRecord) -> Result<()> {
    let parent = path.parent().context("singleton record has no parent")?;
    std::fs::create_dir_all(parent)?;
    let temporary = path.with_extension(format!("json.tmp-{}-{}", std::process::id(), &random_token()?[..16]));
    #[cfg(windows)]
    let mut file = crate::core::owner_identity::create_private_current_user_file(&temporary)?;
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        options.mode(0o600);
        options.open(&temporary)?
    };
    file.write_all(&serde_json::to_vec(record)?)?;
    file.sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    drop(file);
    replace_file_atomic(&temporary, path)?;
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomic(source: &Path, destination: &Path) -> Result<()> {
    std::fs::rename(source, destination)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file_atomic(source: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW};

    let mut source: Vec<u16> = source.as_os_str().encode_wide().collect();
    source.push(0);
    let mut destination: Vec<u16> = destination.as_os_str().encode_wide().collect();
    destination.push(0);
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error()).context("failed to replace singleton record");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{InstanceRecord, open_instance_lock, read_instance_record, try_lock_instance, write_instance_record};

    #[cfg(unix)]
    #[test]
    fn instance_record_is_private_and_round_trips() -> anyhow::Result<()> {
        use std::os::unix::fs::PermissionsExt as _;

        let root = std::env::temp_dir().join(format!("singleton-record-{}", std::process::id()));
        let path = root.join("instance.json");
        let record = InstanceRecord {
            port: 42_123,
            token: "secret".to_string(),
        };

        write_instance_record(&path, &record)?;

        assert_eq!(read_instance_record(&path)?, record);
        assert_eq!(std::fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn instance_lock_allows_only_one_primary() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("singleton-lock-{}", std::process::id()));
        let path = root.join("instance.lock");
        let first = open_instance_lock(&path)?;
        let second = open_instance_lock(&path)?;

        assert!(try_lock_instance(&first)?);
        assert!(!try_lock_instance(&second)?);
        drop(first);
        assert!(try_lock_instance(&second)?);

        drop(second);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
