use super::{CoreManager, RunningMode};
use crate::{
    AsyncHandler,
    config::Config,
    core::{
        handle,
        logger::ClashLogger,
        service,
    },
    logging,
    process::CommandChildGuard,
    utils::{
        dirs,
        init::sidecar_writer,
        logging::{SharedWriter, Type, write_sidecar_log},
    },
};
use anyhow::Result;
use compact_str::CompactString;
use flexi_logger::DeferredNow;
use log::Level;
use std::collections::VecDeque;
use tauri_plugin_shell::ShellExt;

impl CoreManager {
    pub async fn get_clash_logs(&self) -> Result<VecDeque<CompactString>> {
        match self.get_running_mode() {
            RunningMode::Service => service::get_clash_logs_by_service().await,
            RunningMode::Sidecar => Ok(ClashLogger::global().get_logs().clone()),
            RunningMode::NotRunning => Ok(VecDeque::new()),
        }
    }

    pub(super) async fn start_core_by_sidecar(&self) -> Result<()> {
        logging!(info, Type::Core, "Starting core in sidecar mode");

        let config_file = Config::generate_file(crate::config::ConfigType::Run).await?;
        let app_handle = handle::Handle::app_handle();
        let clash_core = Config::verge().await.latest_ref().get_valid_clash_core();
        let config_dir = dirs::app_home_dir()?;

        let (mut rx, child) = app_handle
            .shell()
            .sidecar(&clash_core)?
            .args([
                "-d",
                dirs::path_to_str(&config_dir)?,
                "-f",
                dirs::path_to_str(&config_file)?,
            ])
            .spawn()?;

        let pid = child.pid();
        logging!(trace, Type::Core, "Sidecar started with PID: {}", pid);

        {
            let mut state = self.state.lock();
            state.child_sidecar = Some(CommandChildGuard::new(child));
            state.running_mode = RunningMode::Sidecar;
        }

        let shared_writer: SharedWriter = std::sync::Arc::new(tokio::sync::Mutex::new(sidecar_writer().await?));

        AsyncHandler::spawn(|| async move {
            while let Some(event) = rx.recv().await {
                match event {
                    tauri_plugin_shell::process::CommandEvent::Stdout(line)
                    | tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                        let mut now = DeferredNow::default();
                        let message = CompactString::from(String::from_utf8_lossy(&line).as_ref());
                        let w = shared_writer.lock().await;
                        write_sidecar_log(w, &mut now, Level::Error, &message);
                        ClashLogger::global().append_log(message);
                    }
                    tauri_plugin_shell::process::CommandEvent::Terminated(term) => {
                        let mut now = DeferredNow::default();
                        let message = if let Some(code) = term.code {
                            CompactString::from(format!("Process terminated with code: {}", code))
                        } else if let Some(signal) = term.signal {
                            CompactString::from(format!("Process terminated by signal: {}", signal))
                        } else {
                            CompactString::from("Process terminated")
                        };
                        let w = shared_writer.lock().await;
                        write_sidecar_log(w, &mut now, Level::Info, &message);
                        ClashLogger::global().clear_logs();
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub(super) fn stop_core_by_sidecar(&self) -> Result<()> {
        logging!(info, Type::Core, "Stopping sidecar");

        let mut state = self.state.lock();
        if let Some(child) = state.child_sidecar.take() {
            let pid = child.pid();
            drop(child);
            logging!(trace, Type::Core, "Sidecar stopped (PID: {:?})", pid);
        }
        state.running_mode = RunningMode::NotRunning;
        Ok(())
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
        service::stop_core_by_service().await?;
        self.set_running_mode(RunningMode::NotRunning);
        Ok(())
    }
}

