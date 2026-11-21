use crate::{
    core::owner_identity::{account_sid, current_user_sid},
    utils::dirs::PathBufExec as _,
};
use anyhow::{Context as _, Result, anyhow, bail, ensure};
use clash_verge_logging::{Type, logging};
use quick_xml::escape::escape;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::os::windows::ffi::OsStrExt as _;
use std::path::{Path, PathBuf};
use windows::{
    Win32::{
        Foundation::{E_ACCESSDENIED, ERROR_FILE_NOT_FOUND},
        System::{
            Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize},
            TaskScheduler::{
                ITaskFolder, ITaskService, TASK_CREATE, TASK_CREATION, TASK_LOGON_INTERACTIVE_TOKEN, TASK_UPDATE,
                TaskScheduler,
            },
            Variant::VARIANT,
        },
    },
    core::{BSTR, Error as WindowsError},
};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE},
};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "Clash Verge Auto Launch";

#[derive(Clone, Copy, PartialEq, Eq)]
enum TaskMode {
    User,
    Admin,
}

impl TaskMode {
    const fn name(self) -> &'static str {
        match self {
            Self::User => "Clash Verge",
            Self::Admin => "Clash Verge (Admin)",
        }
    }

    const fn xml_run_level(self) -> &'static str {
        match self {
            Self::User => "LeastPrivilege",
            Self::Admin => "HighestAvailable",
        }
    }
}

fn get_startup_dir() -> Result<PathBuf> {
    let appdata = std::env::var("APPDATA").map_err(|_| anyhow!("failed to read APPDATA env var"))?;
    let startup_dir = Path::new(&appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup");

    if !startup_dir.exists() {
        return Err(anyhow!("startup folder does not exist: {:?}", startup_dir));
    }

    Ok(startup_dir)
}

async fn cleanup_legacy_shortcuts() -> Result<()> {
    let startup_dir = get_startup_dir()?;
    let old_shortcut = startup_dir.join("Clash-Verge.lnk");
    let new_shortcut = startup_dir.join("Clash Verge.lnk");

    old_shortcut
        .remove_if_exists()
        .await
        .with_context(|| format!("failed to remove startup shortcut {}", old_shortcut.display()))?;
    new_shortcut
        .remove_if_exists()
        .await
        .with_context(|| format!("failed to remove startup shortcut {}", new_shortcut.display()))?;
    Ok(())
}

fn build_task_xml(mode: TaskMode, user_sid: &str, exe: &Path) -> String {
    let exe_path = escape(exe.to_string_lossy());
    let run_level = mode.xml_run_level();
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user_sid}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user_sid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>{run_level}</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>3</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe_path}</Command>
    </Exec>
  </Actions>
</Task>
"#
    )
}

struct ComApartment;

impl ComApartment {
    fn initialize() -> Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }.context("failed to initialize COM")?;
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TaskOwner {
    Missing,
    CurrentUser,
    OtherUser,
}

struct ScheduledTasks {
    folder: ITaskFolder,
    user_sid: String,
    // Drop the COM interface before uninitializing the apartment.
    _com: ComApartment,
}

impl ScheduledTasks {
    fn connect() -> Result<Self> {
        let com = ComApartment::initialize()?;
        let service: ITaskService = unsafe { CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER) }
            .context("failed to open Task Scheduler")?;
        let empty = VARIANT::default();
        unsafe { service.Connect(&empty, &empty, &empty, &empty) }.context("failed to connect to Task Scheduler")?;
        let folder =
            unsafe { service.GetFolder(&BSTR::from(r"\")) }.context("failed to open the Task Scheduler root folder")?;
        Ok(Self {
            folder,
            user_sid: current_user_sid()?,
            _com: com,
        })
    }

    fn owner(&self, mode: TaskMode) -> Result<TaskOwner> {
        let task = match unsafe { self.folder.GetTask(&BSTR::from(mode.name())) } {
            Ok(task) => task,
            Err(error) if task_missing(&error) => return Ok(TaskOwner::Missing),
            Err(error) => return Err(error).with_context(|| format!("failed to find the {} task", mode.name())),
        };
        let principal_sid = (|| {
            let principal = unsafe { task.Definition()?.Principal()? };
            let mut user = BSTR::new();
            unsafe { principal.UserId(&mut user)? };
            let user = String::try_from(&user)?;
            if user.starts_with("S-1-") {
                return Ok(user);
            }
            account_sid(&user)
        })()
        .with_context(|| format!("failed to identify the owner of the {} task", mode.name()))?;

        Ok(if principal_sid == self.user_sid {
            TaskOwner::CurrentUser
        } else {
            TaskOwner::OtherUser
        })
    }

    fn has_current_user_task(&self) -> Result<bool> {
        let user_task = self.owner(TaskMode::User)?;
        let admin_task = self.owner(TaskMode::Admin)?;
        Ok(user_task == TaskOwner::CurrentUser || admin_task == TaskOwner::CurrentUser)
    }

    fn register(&self, mode: TaskMode, exe: &Path, flags: TASK_CREATION) -> windows::core::Result<()> {
        let xml = BSTR::from(build_task_xml(mode, &self.user_sid, exe));
        let empty = VARIANT::default();
        unsafe {
            self.folder.RegisterTask(
                &BSTR::from(mode.name()),
                &xml,
                flags.0,
                &empty,
                &empty,
                TASK_LOGON_INTERACTIVE_TOKEN,
                &empty,
            )
        }
        .map(drop)
    }

    fn remove(&self, mode: TaskMode) -> Result<()> {
        match unsafe { self.folder.DeleteTask(&BSTR::from(mode.name()), 0) } {
            Ok(()) => {
                logging!(info, Type::Setup, "Removed the {} auto-launch task", mode.name());
                Ok(())
            }
            Err(error) if task_missing(&error) => Ok(()),
            Err(error) => Err(error).with_context(|| format!("failed to remove the {} task", mode.name())),
        }
    }
}

fn task_missing(error: &WindowsError) -> bool {
    error.code() == ERROR_FILE_NOT_FOUND.to_hresult()
}

fn write_startup_entry(exe: &Path) -> Result<()> {
    let mut command = OsString::from("\"");
    command.push(exe);
    command.push("\"");
    ensure!(
        command.encode_wide().count() <= 260,
        "the startup command exceeds the Windows Run entry limit"
    );

    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
        .context("failed to open the current user's Run key for writing")?;
    key.set_value(RUN_VALUE, &command)
        .context("failed to write the per-user startup entry")
}

fn startup_entry_for_removal() -> Result<Option<RegKey>> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let entry = hkcu
        .open_subkey_with_flags(RUN_KEY, KEY_QUERY_VALUE)
        .and_then(|key| key.get_raw_value(RUN_VALUE));
    match entry {
        Ok(_) => hkcu
            .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
            .map(Some)
            .context("failed to open the current user's Run key for cleanup"),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).context("failed to inspect the per-user startup entry"),
    }
}

fn remove_startup_entry(key: Option<RegKey>) -> Result<()> {
    if let Some(key) = key {
        match key.delete_value(RUN_VALUE) {
            Ok(()) => (),
            Err(error) if error.kind() == ErrorKind::NotFound => (),
            Err(error) => return Err(error).context("failed to remove the per-user startup entry"),
        }
    }
    Ok(())
}

fn enable_auto_launch(
    tasks: &ScheduledTasks,
    mode: TaskMode,
    user_task: TaskOwner,
    admin_task: TaskOwner,
) -> Result<()> {
    let target = match mode {
        TaskMode::User => user_task,
        TaskMode::Admin => admin_task,
    };

    ensure!(
        target != TaskOwner::OtherUser,
        "the {} auto-launch task belongs to another Windows account",
        mode.name()
    );
    let exe = std::env::current_exe().context("failed to get the app executable path")?;
    let exe = dunce::simplified(&exe);
    let fallback = startup_entry_for_removal()?;
    let is_new_task = target == TaskOwner::Missing;
    let flags = if is_new_task { TASK_CREATE } else { TASK_UPDATE };
    if let Err(error) = tasks.register(mode, exe, flags) {
        let can_fallback = mode == TaskMode::User && is_new_task && error.code() == E_ACCESSDENIED;
        // A task could have appeared after the first lookup and may already launch the app.
        if can_fallback && !tasks.has_current_user_task()? {
            write_startup_entry(exe).with_context(|| format!("Task Scheduler denied registration ({error})"))?;
            logging!(
                info,
                Type::Setup,
                "Using the per-user startup entry after Task Scheduler denied registration"
            );
            return Ok(());
        }
        return Err(error).with_context(|| format!("failed to register the {} task", mode.name()));
    }

    let cleanup = (|| {
        if mode == TaskMode::Admin && user_task == TaskOwner::CurrentUser {
            tasks.remove(TaskMode::User)?;
        }
        remove_startup_entry(fallback)
    })();
    if let Err(error) = cleanup {
        if is_new_task && let Err(rollback) = tasks.remove(mode) {
            return Err(error.context(format!(
                "failed to roll back the new {} task: {rollback:#}",
                mode.name()
            )));
        }
        return Err(error);
    }
    logging!(info, Type::Setup, "Registered the {} auto-launch task", mode.name());
    Ok(())
}

fn configure_auto_launch(enabled: bool, mode: TaskMode) -> Result<()> {
    let tasks = ScheduledTasks::connect()?;
    let admin_task = tasks.owner(TaskMode::Admin)?;
    if mode == TaskMode::User && admin_task == TaskOwner::CurrentUser {
        bail!("run Clash Verge as administrator to manage its existing elevated auto-launch task");
    }
    let user_task = tasks.owner(TaskMode::User)?;
    if enabled {
        return enable_auto_launch(&tasks, mode, user_task, admin_task);
    }

    let fallback = startup_entry_for_removal()?;
    if admin_task == TaskOwner::CurrentUser {
        tasks.remove(TaskMode::Admin)?;
    }
    if user_task == TaskOwner::CurrentUser {
        tasks.remove(TaskMode::User)?;
    }
    remove_startup_entry(fallback)
}

pub async fn set_auto_launch(enabled: bool, is_admin: bool) -> Result<()> {
    let mode = if is_admin { TaskMode::Admin } else { TaskMode::User };
    let result = tokio::task::spawn_blocking(move || configure_auto_launch(enabled, mode)).await?;
    result.map_err(|error| {
        if mode == TaskMode::User
            && error
                .downcast_ref::<WindowsError>()
                .is_some_and(|error| error.code() == E_ACCESSDENIED)
        {
            error.context("run Clash Verge as administrator to manage its scheduled auto-launch tasks")
        } else {
            error
        }
    })?;

    if let Err(error) = cleanup_legacy_shortcuts().await {
        logging!(
            warn,
            Type::Setup,
            "Failed to clean up legacy startup shortcuts: {error:#}"
        );
    }
    Ok(())
}
