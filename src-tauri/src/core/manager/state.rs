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
use windows_sys::Win32::{
    Foundation::{GetLastError, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation, SetInformationJobObject,
        },
        Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
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
            unsafe {
                let job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());

                if job.is_valid() {
                    logging!(trace, Type::Core, "Created job object for sidecar process: {:?}", job);
                    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                    let set_info_result = SetInformationJobObject(
                        job,
                        JobObjectExtendedLimitInformation,
                        &mut info as *mut _ as *mut _,
                        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    );
                    if set_info_result == 0 {
                        logging!(
                            error,
                            Type::Core,
                            "Failed to set information for job object: {}",
                            GetLastError()
                        );
                    } else {
                        logging!(trace, Type::Core, "Set job object information successfully");
                    }

                    let child_pid = child.pid();
                    let process_handle = OpenProcess(
                        PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION,
                        0,
                        child_pid,
                    );
                    if process_handle.is_valid() {
                        logging!(
                            trace,
                            Type::Core,
                            "Opened process handle for sidecar (PID: {}, Handle: {:?})",
                            child_pid,
                            process_handle
                        );
                        let assign_result = AssignProcessToJobObject(job, process_handle);
                        if assign_result == 0 {
                            logging!(
                                error,
                                Type::Core,
                                "Failed to assign sidecar process (PID: {}) to job object {:?}: {}",
                                child_pid,
                                job,
                                std::io::Error::last_os_error()
                            );
                        } else {
                            logging!(
                                trace,
                                Type::Core,
                                "Assigned sidecar process (PID: {}) to job object {:?}",
                                child_pid,
                                job
                            );
                        }
                    } else {
                        logging!(
                            error,
                            Type::Core,
                            "Failed to open process handle for sidecar (PID: {})",
                            child_pid
                        );
                    }
                } else {
                    logging!(error, Type::Core, "Failed to create job object for sidecar process");
                }

                self.set_job_handle(job as isize);
            }
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
                // Setting the job handle to 0 clears the stored handle and
                // closes the previous Windows job handle in `set_job_handle`.
                self.set_job_handle(0);
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
        service::run_core_by_service(&config_file).await?;
        self.set_running_mode(RunningMode::Service);
        Ok(())
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
pub trait HandleExt {
    fn is_valid(&self) -> bool;
}

#[cfg(target_os = "windows")]
impl HandleExt for HANDLE {
    fn is_valid(&self) -> bool {
        // Only handles that are neither 0 nor -1 are truly valid
        *self != 0 as Self && *self != INVALID_HANDLE_VALUE
    }
}
