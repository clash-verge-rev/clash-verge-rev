#[cfg(test)]
use super::claim_core_readiness_generation;
use super::{CoreManager, RunningMode};
use crate::{
    AsyncHandler,
    config::Config,
    core::{handle, logger::Logger, manager::CLASH_LOGGER, proxy_control, service},
    logging,
    utils::{dirs, server},
};
use anyhow::{Context as _, Result};
use clash_verge_logging::Type;
use compact_str::CompactString;
use log::Level;
use scopeguard::defer;
use std::path::Path;
use tauri_plugin_mihomo::MihomoExt as _;
use tauri_plugin_shell::ShellExt as _;

const SIDECAR_READINESS_ATTEMPTS: usize = 30;
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
            Err(error) => last_error = Some(error),
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
    pub async fn get_clash_logs(&self) -> Result<Vec<CompactString>> {
        match *self.get_running_mode() {
            RunningMode::Service => service::get_clash_logs_by_service().await,
            RunningMode::Sidecar => Ok(CLASH_LOGGER.get_logs().await),
            RunningMode::NotRunning => Ok(Vec::new()),
        }
    }

    pub(super) async fn start_core_by_sidecar(&self) -> Result<()> {
        logging!(info, Type::Core, "Starting core in sidecar mode");
        server::set_pac_available(false);
        self.set_running_mode(RunningMode::NotRunning);

        let sidecar_ipc = dirs::sidecar_ipc_path()?;
        handle::Handle::app_handle()
            .mihomo()
            .write()
            .await
            .update_socket_path(dirs::path_to_str(&sidecar_ipc)?.to_owned())?;
        let config_file = Config::generate_file(crate::config::ConfigType::Run).await?;
        let app_handle = handle::Handle::app_handle();
        let clash_core = Config::verge().await.latest_arc().get_valid_clash_core();
        let config_dir = dirs::app_home_dir()?;

        #[cfg(unix)]
        let previous_mask = unsafe { tauri_plugin_clash_verge_sysinfo::libc::umask(0o077) };
        let command = app_handle.shell().sidecar(clash_core.as_str())?.args([
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
        let (mut rx, child) = command.spawn()?;
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
        logging!(trace, Type::Core, "Sidecar started with PID: {}", pid);

        let readiness = poll_sidecar_readiness(SIDECAR_READINESS_ATTEMPTS, SIDECAR_READINESS_INTERVAL, || async {
            tokio::time::timeout(SIDECAR_READINESS_PROBE_TIMEOUT, async {
                handle::Handle::mihomo().await.get_version().await
            })
            .await
            .context("Mihomo readiness probe timed out")??;
            Ok(())
        })
        .await;
        if let Err(readiness_error) = readiness {
            proxy_control::stop_guard().await;
            self.invalidate_core_readiness();
            self.set_running_mode(RunningMode::NotRunning);
            server::set_pac_available(false);
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
        self.set_running_mode(RunningMode::Sidecar);
        server::set_pac_available(true);

        AsyncHandler::spawn(move || async move {
            while let Some(event) = rx.recv().await {
                match event {
                    tauri_plugin_shell::process::CommandEvent::Stdout(line)
                    | tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                        let message = CompactString::from(&*String::from_utf8_lossy(&line));
                        Logger::global().writer_sidecar_log(Level::Error, &message);
                        CLASH_LOGGER.append_log(message).await;
                    }
                    tauri_plugin_shell::process::CommandEvent::Terminated(term) => {
                        let manager = Self::global();
                        let _ = manager.invalidate_core_readiness_if(core_readiness_generation);
                        let message = if let Some(code) = term.code {
                            CompactString::from(format!("Process terminated with code: {}", code))
                        } else if let Some(signal) = term.signal {
                            CompactString::from(format!("Process terminated by signal: {}", signal))
                        } else {
                            CompactString::from("Process terminated")
                        };
                        Logger::global().writer_sidecar_log(Level::Info, &message);
                        CLASH_LOGGER.clear_logs().await;
                        manager.clear_terminated_sidecar(pid).await;
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub(super) fn stop_core_by_sidecar(&self) {
        logging!(info, Type::Core, "Stopping sidecar");
        defer! {
            server::set_pac_available(false);
            self.set_running_mode(RunningMode::NotRunning);
        }
        if let Some(child) = self.take_child_sidecar() {
            let pid = child.pid();

            #[cfg(target_os = "windows")]
            {
                // Setting the job handle to None clears the stored handle and
                // closes the previous Windows job handle in `set_job_handle`.
                self.set_job_handle(None);
                logging!(
                    trace,
                    Type::Core,
                    "Closed job handle for sidecar process (PID: {})",
                    pid
                );
            }

            let result = child.kill();
            logging!(
                trace,
                Type::Core,
                "Sidecar stopped (PID: {:?}, Result: {:?})",
                pid,
                result
            );
        }
    }

    pub(super) async fn start_core_by_service(&self) -> Result<()> {
        logging!(info, Type::Core, "Starting core in service mode");
        server::set_pac_available(false);
        let service_ipc = dirs::ipc_path()?;
        let config_file = Config::generate_file(crate::config::ConfigType::Run).await?;
        handle::Handle::app_handle()
            .mihomo()
            .write()
            .await
            .update_socket_path(dirs::path_to_str(&service_ipc)?.to_owned())?;

        self.start_core_by_service_with_config(&config_file).await
    }

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
                        self.set_running_mode(RunningMode::Service);
                        return Ok(());
                    }
                    Err(e) => {
                        logging!(
                            warn,
                            Type::Core,
                            "service start attempt {}/{} failed: {}",
                            attempt + 1,
                            timing::SERVICE_START_RETRIES,
                            e
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
            self.set_running_mode(RunningMode::Service);
            Ok(())
        }
    }

    pub(super) async fn stop_core_by_service(&self) -> Result<()> {
        logging!(info, Type::Core, "Stopping service");
        service::stop_core_by_service().await?;
        server::set_pac_available(false);
        self.set_running_mode(RunningMode::NotRunning);
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
        server::set_pac_available(false);
        self.invalidate_core_readiness();
        self.set_running_mode(RunningMode::NotRunning);
        self.after_core_process();
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
        let manager = CoreManager::default();
        manager.mark_core_ready();
        manager.set_running_mode(RunningMode::Service);

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

    // 起一个长命子进程用于验证 Job Object 的生命周期绑定。
    // 直接使用 System32 下的 ping.exe，避免 cmd 中间层。
    fn spawn_long_lived() -> Result<Child> {
        let child = Command::new("ping")
            .args(["-n", "999", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        Ok(child)
    }

    // 在超时内轮询子进程是否退出，返回是否已退出。
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

    // 成功路径：进程被分配进 Job Object 后仍存活；drop Job 句柄触发
    // KILL_ON_JOB_CLOSE，进程应在超时内被 OS 终止。
    #[test]
    fn job_kills_child_on_handle_drop() -> Result<()> {
        let mut child = spawn_long_lived()?;

        let job = create_and_assign_sidecar_job(child.id())?;

        // 分配后进程应仍在运行。
        assert!(
            child.try_wait()?.is_none(),
            "child should still be running after being assigned to the job"
        );

        // 关闭 Job 句柄，OS 应连带终止其成员进程。
        drop(job);

        assert!(
            wait_until_exited(&mut child, Duration::from_secs(5))?,
            "child should be terminated after the job handle is dropped"
        );

        Ok(())
    }

    // 失败路径：对一个不存在的 PID 调用时 OpenProcess 应失败，函数返回 Err。
    #[test]
    fn returns_err_for_invalid_pid() {
        // PID 必须为 4 的倍数且极不可能存在；0xFFFF_FFFC 对应不到真实进程。
        let result = create_and_assign_sidecar_job(0xFFFF_FFFC);
        assert!(result.is_err(), "expected Err for a non-existent PID");
    }
}
