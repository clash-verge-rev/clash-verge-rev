#[cfg(test)]
use super::claim_core_readiness_generation;
use super::{CoreManager, PROFILE_SELECTIONS_PENDING_COMMIT, RunningMode};
use crate::{
    AsyncHandler,
    config::Config,
    core::{handle, logger::Logger, manager::CLASH_LOGGER, proxy_control, service},
    logging,
    utils::dirs,
};
use anyhow::{Context as _, Result};
use clash_verge_logging::Type;
use log::Level;
use scopeguard::defer;
use std::path::Path;
use tauri_plugin_mihomo::MihomoExt as _;
use tauri_plugin_shell::ShellExt as _;

const SIDECAR_READINESS_ATTEMPTS: usize = 30;

impl CoreManager {
    /// Restores profile selections before callers enable the system proxy.
    /// The bounded first pass continues in the background, and later calls supersede earlier ones.
    async fn restore_selected_nodes(&self) {
        if PROFILE_SELECTIONS_PENDING_COMMIT
            .try_with(|pending| *pending)
            .unwrap_or(false)
        {
            return;
        }
        crate::config::profiles::restore_selected_nodes().await;
    }
}

const SIDECAR_READINESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
const SIDECAR_READINESS_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(400);

async fn poll_sidecar_readiness<F, Fut>(
    max_attempts: usize,
    retry_delay: std::time::Duration,
    mut probe: F,
) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let mut last_error = None;
    for attempt in 0..max_attempts {
        match probe().await {
            Ok(()) => return Ok(()),
            Err(error) => {
                logging!(
                    debug,
                    Type::Core,
                    "sidecar readiness probe {}/{} failed: {error:#}",
                    attempt + 1,
                    max_attempts
                );
                last_error = Some(error);
            }
        }
        if attempt + 1 < max_attempts {
            tokio::time::sleep(retry_delay).await;
        }
    }
    Err(last_error
        .unwrap_or_else(|| anyhow::anyhow!("sidecar readiness was configured with no attempts"))
        .context("Mihomo API did not become ready"))
}

fn should_clear_terminated_sidecar(running_mode: &RunningMode, current_pid: Option<u32>, terminated_pid: u32) -> bool {
    matches!(running_mode, RunningMode::Sidecar) && current_pid == Some(terminated_pid)
}

#[cfg(target_os = "windows")]
use {
    std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle},
    windows_sys::Win32::{
        Foundation::HANDLE,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation, SetInformationJobObject,
            },
            Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    },
};

impl CoreManager {
    pub async fn get_clash_logs(&self) -> Result<Vec<String>> {
        match *self.get_running_mode() {
            RunningMode::Service => service::get_clash_logs_by_service().await,
            RunningMode::Sidecar => Ok(CLASH_LOGGER.get_logs()),
            RunningMode::NotRunning => Ok(Vec::new()),
        }
    }

    #[tracing::instrument(skip_all, level = "info", fields(pid = tracing::field::Empty))]
    pub(super) async fn start_core_by_sidecar(&self) -> Result<()> {
        self.core_stopped();

        let sidecar_ipc = dirs::sidecar_ipc_path()?;
        handle::Handle::app_handle()
            .mihomo()
            .update_socket_path(dirs::path_to_str(&sidecar_ipc)?.to_owned())?;
        let config_file = Config::generate_file().await?;
        let app_handle = handle::Handle::app_handle();
        let clash_core = Config::verge().await.latest_arc().get_valid_clash_core();
        let config_dir = dirs::app_home_dir()?;
        #[cfg(unix)]
        discard_unwritable_core_cache(&config_dir);

        #[cfg(unix)]
        let previous_mask = unsafe { tauri_plugin_clash_verge_sysinfo::libc::umask(0o077) };
        let command = app_handle
            .shell()
            .sidecar(clash_core.as_str())
            .map_err(|error| anyhow::anyhow!("failed to build sidecar command for core {clash_core:?}: {error:#}"))?;
        let command = command.args([
            "-d",
            dirs::path_to_str(&config_dir)?,
            "-f",
            dirs::path_to_str(&config_file)?,
            if cfg!(windows) {
                "-ext-ctl-pipe"
            } else {
                "-ext-ctl-unix"
            },
            dirs::path_to_str(&sidecar_ipc)?,
        ]);
        #[cfg(windows)]
        let command = command.env(
            "LISTEN_NAMEDPIPE_SDDL",
            crate::core::owner_identity::current_user_pipe_sddl()?,
        );
        let (mut rx, child) = command.spawn().map_err(|error| {
            anyhow::anyhow!(
                "failed to start sidecar core {clash_core:?} with config {} and data directory {}: {error:#}",
                config_file.display(),
                config_dir.display()
            )
        })?;
        #[cfg(target_os = "windows")]
        let job = {
            match create_and_assign_sidecar_job(child.pid()) {
                Ok(job) => job,
                Err(job_error) => {
                    let pid = child.pid();

                    let error = match child.kill() {
                        Ok(()) => job_error,
                        Err(kill_error) => anyhow::anyhow!(
                            "failed to configure Job Object for sidecar PID {pid}: \
                            {job_error:#}; failed to terminate child: {kill_error:#}"
                        ),
                    };

                    logging!(error, Type::Core, "Failed to start sidecar: {error:#}");
                    return Err(error);
                }
            }
        };

        #[cfg(unix)]
        unsafe {
            tauri_plugin_clash_verge_sysinfo::libc::umask(previous_mask)
        };

        let pid = child.pid();
        tracing::Span::current().record("pid", pid);

        let readiness = poll_sidecar_readiness(SIDECAR_READINESS_ATTEMPTS, SIDECAR_READINESS_INTERVAL, || async {
            tokio::time::timeout(SIDECAR_READINESS_PROBE_TIMEOUT, async {
                handle::Handle::mihomo().get_version().await
            })
            .await
            .context("Mihomo readiness probe timed out")??;
            Ok(())
        })
        .await;
        if let Err(readiness_error) = readiness {
            proxy_control::stop_guard().await;
            self.core_stopped();
            return match child.kill() {
                Ok(()) => Err(readiness_error),
                Err(kill_error) => Err(anyhow::anyhow!(
                    "{readiness_error:#}; failed to terminate unready sidecar PID {pid}: {kill_error:#}"
                )),
            };
        }

        #[cfg(target_os = "windows")]
        self.set_job_handle(Some(job));
        self.set_running_child_sidecar(child);
        let core_readiness_generation = self.mark_core_ready();
        self.core_started(RunningMode::Sidecar);
        self.restore_selected_nodes().await;

        AsyncHandler::spawn(move || async move {
            while let Some(event) = rx.recv().await {
                match event {
                    tauri_plugin_shell::process::CommandEvent::Stdout(line)
                    | tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                        let message = String::from_utf8_lossy(&line).into_owned();
                        Logger::global().writer_sidecar_log(Level::Error, &message);
                        CLASH_LOGGER.append_log(message);
                    }
                    tauri_plugin_shell::process::CommandEvent::Terminated(term) => {
                        let manager = Self::global();
                        let _ = manager.invalidate_core_readiness_if(core_readiness_generation);
                        let message = if let Some(code) = term.code {
                            format!("Process terminated with code: {}", code)
                        } else if let Some(signal) = term.signal {
                            format!("Process terminated by signal: {}", signal)
                        } else {
                            String::from("Process terminated")
                        };
                        Logger::global().writer_sidecar_log(Level::Info, &message);
                        CLASH_LOGGER.clear_logs();
                        manager.clear_terminated_sidecar(pid).await;
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Terminates the sidecar after its caller has successfully cleared the
    /// system proxy.
    pub(super) fn stop_core_by_sidecar_unprepared(&self) {
        defer! {
            self.core_stopped();
        }
        if let Some(child) = self.take_child_sidecar() {
            let pid = child.pid();

            #[cfg(target_os = "windows")]
            {
                // Setting the job handle to None clears the stored handle and
                // closes the previous Windows job handle in `set_job_handle`.
                self.set_job_handle(None);
                let _ = pid;
            }

            if let Err(error) = child.kill() {
                logging!(warn, Type::Core, "failed to terminate sidecar PID {pid}: {error:#}");
            }
        }
    }

    pub(super) async fn start_core_by_service(&self) -> Result<()> {
        self.core_starting();
        let service_ipc = dirs::ipc_path()?;
        let config_file = Config::generate_file().await?;
        handle::Handle::app_handle()
            .mihomo()
            .update_socket_path(dirs::path_to_str(&service_ipc)?.to_owned())?;

        self.start_core_by_service_with_config(&config_file).await
    }

    #[tracing::instrument(skip_all, level = "info", fields(config_file = %config_file.display()))]
    pub(super) async fn start_core_by_service_with_config(&self, config_file: &Path) -> Result<()> {
        // 交接时等待 sidecar 释放 ext-controller 通道。
        #[cfg(target_os = "windows")]
        {
            use crate::constants::timing;
            let mut last_err = None;
            for attempt in 0..timing::SERVICE_START_RETRIES {
                match service::run_core_by_service(config_file).await {
                    Ok(()) => {
                        self.mark_core_ready();
                        self.core_started(RunningMode::Service);
                        self.restore_selected_nodes().await;
                        return Ok(());
                    }
                    Err(e) => {
                        logging!(
                            warn,
                            Type::Core,
                            "service start attempt {}/{} failed: {e:#}",
                            attempt + 1,
                            timing::SERVICE_START_RETRIES
                        );
                        last_err = Some(e);
                        tokio::time::sleep(timing::SERVICE_START_RETRY_DELAY).await;
                    }
                }
            }
            Err(last_err.unwrap_or_else(|| anyhow::anyhow!("service start failed")))
        }

        #[cfg(not(target_os = "windows"))]
        {
            service::run_core_by_service(config_file).await?;
            self.mark_core_ready();
            self.core_started(RunningMode::Service);
            self.restore_selected_nodes().await;
            Ok(())
        }
    }

    pub(super) async fn stop_core_by_service(&self) -> Result<()> {
        service::stop_core_by_service().await?;
        self.core_stopped();
        Ok(())
    }

    async fn clear_terminated_sidecar(&self, terminated_pid: u32) {
        let _life = self.lifecycle_lock.lock().await;
        if !should_clear_terminated_sidecar(&self.get_running_mode(), self.get_running_sidecar_pid(), terminated_pid) {
            return;
        }

        let _ = self.take_child_sidecar();
        #[cfg(target_os = "windows")]
        self.set_job_handle(None);
        proxy_control::stop_guard().await;
        self.core_stopped();
    }
}

/// Drops a `cache.db` the current user cannot write before handing the directory to the core.
///
/// mihomo keeps `profile.store-selected` in `cache.db` inside its data directory. Service builds
/// before the runtime staging rework ran the core as root against this same directory without a
/// umask, leaving the file as `root:staff 0644`: still readable, so the core loads stale
/// selections, but never writable again, so it silently stops recording new ones. Nothing
/// repairs it either, because the service-side cleanup only runs inside the service. Removing it
/// lets the core recreate the cache under the current user; the fake-ip leases and frozen
/// selections that go with it could not be updated anyway.
#[cfg(unix)]
fn discard_unwritable_core_cache(config_dir: &Path) {
    let cache = config_dir.join("cache.db");
    // Appending neither creates nor truncates, so this only asks whether a write would be allowed.
    match std::fs::OpenOptions::new().append(true).open(&cache) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            // Unlinking is governed by the directory, which the current user owns.
            match std::fs::remove_file(&cache) {
                Ok(()) => logging!(
                    info,
                    Type::Core,
                    "Discarded a core cache the current user cannot write: {}",
                    cache.display()
                ),
                Err(error) => logging!(
                    warn,
                    Type::Core,
                    "Failed to discard the unwritable core cache {}: {error}",
                    cache.display()
                ),
            }
        }
        Err(error) => logging!(
            warn,
            Type::Core,
            "Failed to probe the core cache {}: {error}",
            cache.display()
        ),
    }
}

#[cfg(all(test, unix))]
mod core_cache_tests {
    use super::discard_unwritable_core_cache;
    use std::os::unix::fs::PermissionsExt as _;

    fn scratch(name: &str) -> anyhow::Result<std::path::PathBuf> {
        let root = std::env::temp_dir().join(format!("clash-verge-core-cache-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root)?;
        Ok(root)
    }

    #[test]
    fn an_unwritable_cache_is_discarded() -> anyhow::Result<()> {
        // root ignores the permission bits, so the probe cannot fail there.
        if unsafe { tauri_plugin_clash_verge_sysinfo::libc::geteuid() } == 0 {
            return Ok(());
        }
        let root = scratch("unwritable")?;
        let cache = root.join("cache.db");
        std::fs::write(&cache, b"stale")?;
        std::fs::set_permissions(&cache, std::fs::Permissions::from_mode(0o444))?;

        discard_unwritable_core_cache(&root);

        assert!(!cache.exists(), "an unwritable cache must not be handed to the core");
        let _ = std::fs::remove_dir_all(&root);
        Ok(())
    }

    #[test]
    fn a_writable_cache_is_kept() -> anyhow::Result<()> {
        let root = scratch("writable")?;
        let cache = root.join("cache.db");
        std::fs::write(&cache, b"live")?;

        discard_unwritable_core_cache(&root);

        assert_eq!(
            std::fs::read(&cache)?,
            b"live",
            "a writable cache carries the stored selections and must survive"
        );
        let _ = std::fs::remove_dir_all(&root);
        Ok(())
    }

    #[test]
    fn a_missing_cache_is_not_an_error() -> anyhow::Result<()> {
        let root = scratch("missing")?;

        discard_unwritable_core_cache(&root);

        assert!(!root.join("cache.db").exists());
        let _ = std::fs::remove_dir_all(&root);
        Ok(())
    }
}

#[cfg(test)]
mod readiness_tests {
    use super::{claim_core_readiness_generation, poll_sidecar_readiness, should_clear_terminated_sidecar};
    use crate::core::manager::{CoreManager, RunningMode};
    use std::{
        sync::{
            Arc,
            atomic::{AtomicU64, AtomicUsize, Ordering},
        },
        time::Duration,
    };

    #[tokio::test]
    async fn sidecar_readiness_poll_is_bounded_and_accepts_a_real_api_response() -> anyhow::Result<()> {
        let attempts = Arc::new(AtomicUsize::new(0));
        let probe_attempts = Arc::clone(&attempts);
        poll_sidecar_readiness(3, Duration::ZERO, move || {
            let attempt = probe_attempts.fetch_add(1, Ordering::SeqCst) + 1;
            async move {
                if attempt == 3 {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!("not ready"))
                }
            }
        })
        .await?;
        assert_eq!(attempts.load(Ordering::SeqCst), 3);

        let failed_attempts = Arc::new(AtomicUsize::new(0));
        let probe_attempts = Arc::clone(&failed_attempts);
        assert!(
            poll_sidecar_readiness(3, Duration::ZERO, move || {
                probe_attempts.fetch_add(1, Ordering::SeqCst);
                async { Err(anyhow::anyhow!("still unavailable")) }
            })
            .await
            .is_err()
        );
        assert_eq!(failed_attempts.load(Ordering::SeqCst), 3);
        Ok(())
    }

    #[test]
    fn only_the_current_sidecar_termination_clears_local_state() {
        assert!(should_clear_terminated_sidecar(&RunningMode::Sidecar, Some(42), 42));
        assert!(!should_clear_terminated_sidecar(&RunningMode::Sidecar, Some(43), 42));
        assert!(!should_clear_terminated_sidecar(&RunningMode::Service, Some(42), 42));
        assert!(!should_clear_terminated_sidecar(&RunningMode::NotRunning, None, 42));
    }

    #[test]
    fn core_readiness_generation_can_only_be_claimed_once() {
        let generation = AtomicU64::new(7);

        assert!(claim_core_readiness_generation(&generation, 7));
        assert_eq!(generation.load(Ordering::Acquire), 8);
        assert!(!claim_core_readiness_generation(&generation, 7));
    }

    #[test]
    fn invalidated_core_readiness_cannot_be_recaptured_from_stale_mode() {
        let manager = CoreManager::isolated();
        manager.mark_core_ready();
        manager.core_started(RunningMode::Service);

        manager.invalidate_core_readiness();

        assert_eq!(*manager.get_running_mode(), RunningMode::Service);
        assert_eq!(manager.current_core_readiness_generation(), None);
    }
}

#[cfg(target_os = "windows")]
fn create_and_assign_sidecar_job(child_pid: u32) -> Result<OwnedHandle> {
    unsafe {
        let raw_job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if raw_job.is_null() {
            return Err(last_win32_error("CreateJobObjectW failed"));
        }
        let job = OwnedHandle::from_raw_handle(raw_job);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let set_info_result = SetInformationJobObject(
            job.as_raw_handle() as HANDLE,
            JobObjectExtendedLimitInformation,
            &mut info as *mut _ as *mut _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if set_info_result == 0 {
            return Err(last_win32_error("SetInformationJobObject failed"));
        }

        let raw_process_handle = OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION,
            0,
            child_pid,
        );
        if raw_process_handle.is_null() {
            return Err(last_win32_error("OpenProcess failed"));
        }
        let process_handle = OwnedHandle::from_raw_handle(raw_process_handle);

        let assign_result = AssignProcessToJobObject(job.as_raw_handle(), process_handle.as_raw_handle());
        if assign_result == 0 {
            return Err(last_win32_error("AssignProcessToJobObject failed"));
        }

        Ok(job)
    }
}

#[cfg(target_os = "windows")]
fn last_win32_error(operation: &'static str) -> anyhow::Error {
    anyhow::Error::new(std::io::Error::last_os_error()).context(operation)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::create_and_assign_sidecar_job;
    use anyhow::Result;
    use std::{
        process::{Child, Command, Stdio},
        thread::sleep,
        time::{Duration, Instant},
    };

    // Use ping directly as a long-lived process without a cmd.exe intermediary.
    fn spawn_long_lived() -> Result<Child> {
        let child = Command::new("ping")
            .args(["-n", "999", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        Ok(child)
    }

    fn wait_until_exited(child: &mut Child, timeout: Duration) -> Result<bool> {
        let deadline = Instant::now() + timeout;
        loop {
            if child.try_wait()?.is_some() {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn job_kills_child_on_handle_drop() -> Result<()> {
        let mut child = spawn_long_lived()?;

        let job = create_and_assign_sidecar_job(child.id())?;

        assert!(
            child.try_wait()?.is_none(),
            "child should still be running after being assigned to the job"
        );

        drop(job);

        assert!(
            wait_until_exited(&mut child, Duration::from_secs(5))?,
            "child should be terminated after the job handle is dropped"
        );

        Ok(())
    }

    #[test]
    fn returns_err_for_invalid_pid() {
        // Windows PIDs are multiples of four; this one is effectively impossible.
        let result = create_and_assign_sidecar_job(0xFFFF_FFFC);
        assert!(result.is_err(), "expected Err for a non-existent PID");
    }
}
