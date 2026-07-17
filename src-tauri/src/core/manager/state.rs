use super::{CoreManager, RunningMode};
use crate::{
    AsyncHandler,
    config::{Config, IClashTemp},
    core::{handle, logger::Logger, manager::CLASH_LOGGER, service},
    logging,
    utils::dirs,
};
use anyhow::Result;
use clash_verge_logging::Type;
use compact_str::CompactString;
use log::Level;
use scopeguard::defer;
use tauri_plugin_shell::ShellExt as _;

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

        let config_file = Config::generate_file(crate::config::ConfigType::Run).await?;
        let app_handle = handle::Handle::app_handle();
        let clash_core = Config::verge().await.latest_arc().get_valid_clash_core();
        let config_dir = dirs::app_home_dir()?;

        #[cfg(unix)]
        let previous_mask = unsafe { tauri_plugin_clash_verge_sysinfo::libc::umask(0o007) };
        let (mut rx, child) = app_handle
            .shell()
            .sidecar(clash_core.as_str())?
            .args([
                "-d",
                dirs::path_to_str(&config_dir)?,
                "-f",
                dirs::path_to_str(&config_file)?,
                if cfg!(windows) {
                    "-ext-ctl-pipe"
                } else {
                    "-ext-ctl-unix"
                },
                &IClashTemp::guard_external_controller_ipc(),
            ])
            .spawn()?;
        #[cfg(target_os = "windows")]
        {
            let job = match create_and_assign_sidecar_job(child.pid()) {
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
            };
            self.set_job_handle(Some(job));
        }

        #[cfg(unix)]
        unsafe {
            tauri_plugin_clash_verge_sysinfo::libc::umask(previous_mask)
        };

        let pid = child.pid();
        logging!(trace, Type::Core, "Sidecar started with PID: {}", pid);

        self.set_running_child_sidecar(child);
        self.set_running_mode(RunningMode::Sidecar);

        AsyncHandler::spawn(|| async move {
            while let Some(event) = rx.recv().await {
                match event {
                    tauri_plugin_shell::process::CommandEvent::Stdout(line)
                    | tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                        let message = CompactString::from(&*String::from_utf8_lossy(&line));
                        Logger::global().writer_sidecar_log(Level::Error, &message);
                        CLASH_LOGGER.append_log(message).await;
                    }
                    tauri_plugin_shell::process::CommandEvent::Terminated(term) => {
                        let message = if let Some(code) = term.code {
                            CompactString::from(format!("Process terminated with code: {}", code))
                        } else if let Some(signal) = term.signal {
                            CompactString::from(format!("Process terminated by signal: {}", signal))
                        } else {
                            CompactString::from("Process terminated")
                        };
                        Logger::global().writer_sidecar_log(Level::Info, &message);
                        CLASH_LOGGER.clear_logs().await;
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
        let config_file = Config::generate_file(crate::config::ConfigType::Run).await?;

        // 交接时等待 sidecar 释放 ext-controller 通道。
        #[cfg(target_os = "windows")]
        {
            use crate::constants::timing;
            let mut last_err = None;
            for attempt in 0..timing::SERVICE_START_RETRIES {
                match service::run_core_by_service(&config_file).await {
                    Ok(()) => {
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
            service::run_core_by_service(&config_file).await?;
            self.set_running_mode(RunningMode::Service);
            Ok(())
        }
    }

    pub(super) async fn stop_core_by_service(&self) -> Result<()> {
        logging!(info, Type::Core, "Stopping service");
        defer! {
            self.set_running_mode(RunningMode::NotRunning);
        }
        service::stop_core_by_service().await?;
        Ok(())
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
