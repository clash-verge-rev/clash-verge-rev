use super::CoreManager;
#[cfg(windows)]
use crate::process::AsyncHandler;
use crate::{
    constants::{process, timing},
    logging,
    utils::logging::Type,
};
use anyhow::Result;
#[cfg(windows)]
use anyhow::anyhow;

impl CoreManager {
    pub async fn cleanup_orphaned_processes(&self) -> Result<()> {
        logging!(info, Type::Core, "Cleaning orphaned mihomo processes");

        let current_pid = self
            .state
            .lock()
            .child_sidecar
            .as_ref()
            .and_then(|c| c.pid());
        let target_processes = process::process_names();

        let process_futures = target_processes.iter().map(|&name| {
            let process_name = process::with_extension(name);
            self.find_processes_by_name(process_name, name)
        });

        let process_results = futures::future::join_all(process_futures).await;

        let pids_to_kill: Vec<_> = process_results
            .into_iter()
            .filter_map(Result::ok)
            .flat_map(|(pids, name)| {
                pids.into_iter()
                    .filter(move |&pid| Some(pid) != current_pid)
                    .map(move |pid| (pid, name.clone()))
            })
            .collect();

        if pids_to_kill.is_empty() {
            return Ok(());
        }

        let kill_futures = pids_to_kill
            .iter()
            .map(|(pid, name)| self.kill_process_verified(*pid, name.clone()));

        let killed_count = futures::future::join_all(kill_futures)
            .await
            .into_iter()
            .filter(|&success| success)
            .count();

        if killed_count > 0 {
            logging!(
                info,
                Type::Core,
                "Cleaned {} orphaned processes",
                killed_count
            );
        }

        Ok(())
    }

    async fn find_processes_by_name(
        &self,
        process_name: String,
        _target: &str,
    ) -> Result<(Vec<u32>, String)> {
        #[cfg(windows)]
        {
            use std::mem;
            use winapi::um::{
                handleapi::CloseHandle,
                tlhelp32::{
                    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
                    TH32CS_SNAPPROCESS,
                },
            };

            let process_name_clone = process_name.clone();
            let pids = AsyncHandler::spawn_blocking(move || -> Result<Vec<u32>> {
                let mut pids = Vec::new();

                unsafe {
                    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                    if snapshot == winapi::um::handleapi::INVALID_HANDLE_VALUE {
                        return Err(anyhow!("Failed to create process snapshot"));
                    }

                    let mut pe32: PROCESSENTRY32W = mem::zeroed();
                    pe32.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

                    if Process32FirstW(snapshot, &mut pe32) != 0 {
                        loop {
                            let end_pos = pe32
                                .szExeFile
                                .iter()
                                .position(|&x| x == 0)
                                .unwrap_or(pe32.szExeFile.len());

                            let exe_file = String::from_utf16_lossy(&pe32.szExeFile[..end_pos]);
                            if exe_file.eq_ignore_ascii_case(&process_name_clone) {
                                pids.push(pe32.th32ProcessID);
                            }

                            if Process32NextW(snapshot, &mut pe32) == 0 {
                                break;
                            }
                        }
                    }

                    CloseHandle(snapshot);
                }

                Ok(pids)
            })
            .await??;

            Ok((pids, process_name))
        }

        #[cfg(not(windows))]
        {
            let cmd = if cfg!(target_os = "macos") {
                "pgrep"
            } else {
                "pidof"
            };
            let output = tokio::process::Command::new(cmd)
                .arg(&process_name)
                .output()
                .await?;

            if !output.status.success() {
                return Ok((Vec::new(), process_name));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();

            Ok((pids, process_name))
        }
    }

    async fn kill_process_verified(&self, pid: u32, process_name: String) -> bool {
        #[cfg(windows)]
        let success = {
            use winapi::um::{
                handleapi::CloseHandle,
                processthreadsapi::{OpenProcess, TerminateProcess},
                winnt::{HANDLE, PROCESS_TERMINATE},
            };

            AsyncHandler::spawn_blocking(move || unsafe {
                let handle: HANDLE = OpenProcess(PROCESS_TERMINATE, 0, pid);
                if handle.is_null() {
                    return false;
                }
                let result = TerminateProcess(handle, 1) != 0;
                CloseHandle(handle);
                result
            })
            .await
            .unwrap_or(false)
        };

        #[cfg(not(windows))]
        let success = tokio::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false);

        if !success {
            return false;
        }

        tokio::time::sleep(timing::PROCESS_VERIFY_DELAY).await;

        if self.is_process_running(pid).await.unwrap_or(false) {
            logging!(
                warn,
                Type::Core,
                "Process {} (PID: {}) still running after termination",
                process_name,
                pid
            );
            false
        } else {
            logging!(
                info,
                Type::Core,
                "Terminated process {} (PID: {})",
                process_name,
                pid
            );
            true
        }
    }

    async fn is_process_running(&self, pid: u32) -> Result<bool> {
        #[cfg(windows)]
        {
            use winapi::{
                shared::minwindef::DWORD,
                um::{
                    handleapi::CloseHandle,
                    processthreadsapi::{GetExitCodeProcess, OpenProcess},
                    winnt::{HANDLE, PROCESS_QUERY_INFORMATION},
                },
            };

            AsyncHandler::spawn_blocking(move || unsafe {
                let handle: HANDLE = OpenProcess(PROCESS_QUERY_INFORMATION, 0, pid);
                if handle.is_null() {
                    return Ok(false);
                }
                let mut exit_code: DWORD = 0;
                let result = GetExitCodeProcess(handle, &mut exit_code);
                CloseHandle(handle);
                Ok(result != 0 && exit_code == 259)
            })
            .await?
        }

        #[cfg(not(windows))]
        {
            let output = tokio::process::Command::new("ps")
                .args(["-p", &pid.to_string()])
                .output()
                .await?;

            Ok(output.status.success() && !output.stdout.is_empty())
        }
    }
}
