use crate::utils::dirs::{self, PathBufExec as _};
use anyhow::{Result, anyhow};
use clash_verge_logging::{Type, logging};
use std::fs;
use std::os::windows::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use windows::Win32::Globalization::{GetACP, GetOEMCP, MULTI_BYTE_TO_WIDE_CHAR_FLAGS, MultiByteToWideChar};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const TASK_NAME_USER: &str = "Clash Verge";
const TASK_NAME_ADMIN: &str = "Clash Verge (Admin)";
const TASK_XML_DIR: &str = "tasks";
const TASK_XML_USER: &str = "clash-verge-task-user.xml";
const TASK_XML_ADMIN: &str = "clash-verge-task-admin.xml";

#[derive(Clone, Copy)]
pub enum TaskMode {
    User,
    Admin,
}

impl TaskMode {
    const fn name(self) -> &'static str {
        match self {
            Self::User => TASK_NAME_USER,
            Self::Admin => TASK_NAME_ADMIN,
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Admin => "admin",
        }
    }

    const fn xml_run_level(self) -> &'static str {
        match self {
            Self::User => "LeastPrivilege",
            Self::Admin => "HighestAvailable",
        }
    }

    const fn xml_file_name(self) -> &'static str {
        match self {
            Self::User => TASK_XML_USER,
            Self::Admin => TASK_XML_ADMIN,
        }
    }
}

fn get_exe_path() -> Result<PathBuf> {
    let exe_path = std::env::current_exe().map_err(|e| anyhow!("failed to get exe path: {}", e))?;
    Ok(exe_path)
}

fn get_task_user_id() -> Result<String> {
    let username = std::env::var_os("USERNAME")
        .or_else(|| std::env::var_os("USER"))
        .ok_or_else(|| anyhow!("failed to get current user name"))?;
    let username = username.to_string_lossy();
    let username = username.trim();
    if username.is_empty() {
        return Err(anyhow!("current user name is empty"));
    }

    let domain = std::env::var_os("USERDOMAIN")
        .or_else(|| std::env::var_os("COMPUTERNAME"))
        .map(|value| value.to_string_lossy().to_string());

    if let Some(domain) = domain {
        let domain = domain.trim();
        if !domain.is_empty() {
            return Ok(format!("{domain}\\{username}"));
        }
    }

    Ok(username.to_string())
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

    old_shortcut.remove_if_exists().await?;
    new_shortcut.remove_if_exists().await?;
    Ok(())
}

fn task_xml_path(mode: TaskMode) -> Result<PathBuf> {
    let dir = dirs::app_home_dir()?.join(TASK_XML_DIR);
    fs::create_dir_all(&dir).map_err(|e| anyhow!("failed to create task xml dir: {}", e))?;
    Ok(dir.join(mode.xml_file_name()))
}

fn xml_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn build_task_xml(mode: TaskMode) -> Result<String> {
    let exe_path = get_exe_path()?.to_string_lossy().to_string();
    let exe_path = xml_escape(&exe_path);
    let user_id = xml_escape(&get_task_user_id()?);
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>{}</RunLevel>
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
      <Command>{}</Command>
    </Exec>
  </Actions>
</Task>
"#,
        user_id,
        user_id,
        mode.xml_run_level(),
        exe_path
    ))
}

fn encode_utf16le_with_bom(content: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(2 + content.len() * 2);
    bytes.extend_from_slice(&[0xFF, 0xFE]);
    for unit in content.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

fn write_task_xml(mode: TaskMode) -> Result<PathBuf> {
    let task_xml = build_task_xml(mode)?;
    let task_xml_path = task_xml_path(mode)?;
    let encoded = encode_utf16le_with_bom(&task_xml);
    fs::write(&task_xml_path, encoded).map_err(|e| anyhow!("failed to write task xml: {}", e))?;
    Ok(task_xml_path)
}

fn decode_with_code_page(bytes: &[u8], code_page: u32) -> Option<String> {
    if bytes.is_empty() {
        return Some(String::new());
    }

    let len = bytes.len();
    if len > i32::MAX as usize {
        return None;
    }

    let required = unsafe { MultiByteToWideChar(code_page, MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0), bytes, None) };

    if required <= 0 {
        return None;
    }

    let mut wide = vec![0u16; required as usize];
    let written = unsafe { MultiByteToWideChar(code_page, MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0), bytes, Some(&mut wide)) };

    if written <= 0 {
        return None;
    }

    wide.truncate(written as usize);
    Some(String::from_utf16_lossy(&wide))
}

fn decode_console_output(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }

    let oem = unsafe { GetOEMCP() };
    if let Some(text) = decode_with_code_page(bytes, oem) {
        return text;
    }

    let acp = unsafe { GetACP() };
    if let Some(text) = decode_with_code_page(bytes, acp) {
        return text;
    }

    String::from_utf8_lossy(bytes).to_string()
}

fn output_message(output: &Output) -> String {
    let stdout = decode_console_output(&output.stdout);
    let stderr = decode_console_output(&output.stderr);
    let stdout = stdout.trim();
    let stderr = stderr.trim();

    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => "unknown error".to_string(),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (false, false) => format!("{stdout} | {stderr}"),
    }
}

fn schtasks_output(mut cmd: Command) -> Result<Output> {
    cmd.creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| anyhow!("failed to execute schtasks: {}", e))
}

pub fn is_task_enabled(mode: TaskMode) -> Result<bool> {
    let output = schtasks_output({
        let mut cmd = Command::new("schtasks");
        cmd.args(["/Query", "/TN", mode.name()]);
        cmd
    })?;

    Ok(output.status.success())
}

pub fn create_task(mode: TaskMode) -> Result<()> {
    let task_xml_path = write_task_xml(mode)?;
    let output = schtasks_output({
        let mut cmd = Command::new("schtasks");
        cmd.args(["/Create", "/TN", mode.name(), "/XML"]);
        cmd.arg(&task_xml_path);
        cmd.arg("/F");
        cmd
    })?;

    if !output.status.success() {
        return Err(anyhow!(
            "failed to create {} task: {}",
            mode.label(),
            output_message(&output)
        ));
    }

    logging!(info, Type::Setup, "Created {} auto-launch task", mode.label());
    Ok(())
}

pub fn remove_task(mode: TaskMode) -> Result<()> {
    let output = schtasks_output({
        let mut cmd = Command::new("schtasks");
        cmd.args(["/Delete", "/TN", mode.name(), "/F"]);
        cmd
    })?;

    if output.status.success() {
        logging!(info, Type::Setup, "Removed {} auto-launch task", mode.label());
        return Ok(());
    }

    if !is_task_enabled(mode)? {
        logging!(
            info,
            Type::Setup,
            "{} auto-launch task not found, skipping removal",
            mode.label()
        );
        return Ok(());
    }

    Err(anyhow!(
        "failed to remove {} task: {}",
        mode.label(),
        output_message(&output)
    ))
}

pub async fn set_auto_launch(is_enable: bool, is_admin: bool) -> Result<()> {
    let target = if is_admin { TaskMode::Admin } else { TaskMode::User };
    let other = if is_admin { TaskMode::User } else { TaskMode::Admin };

    if let Err(err) = cleanup_legacy_shortcuts().await {
        logging!(warn, Type::Setup, "Failed to cleanup legacy startup shortcuts: {}", err);
    }

    if is_enable {
        if is_admin {
            create_task(target)?;
            if let Err(err) = remove_task(other) {
                let _ = remove_task(target);
                return Err(err);
            }
        } else {
            if is_task_enabled(other)? {
                return Err(anyhow!(
                    "admin auto-launch task exists; run the app as administrator to remove it before creating a user task"
                ));
            }
            create_task(target)?;
        }
        return Ok(());
    }

    if is_admin {
        let mut errors = Vec::new();
        if let Err(err) = remove_task(TaskMode::User) {
            errors.push(err);
        }
        if let Err(err) = remove_task(TaskMode::Admin) {
            errors.push(err);
        }

        if let Some(err) = errors.into_iter().next() {
            return Err(err);
        }

        return Ok(());
    }

    remove_task(TaskMode::User)?;
    if is_task_enabled(TaskMode::Admin)? {
        return Err(anyhow!(
            "admin auto-launch task exists; run the app as administrator to remove it"
        ));
    }

    Ok(())
}

pub fn is_auto_launch_enabled() -> Result<bool> {
    if is_task_enabled(TaskMode::Admin)? {
        return Ok(true);
    }

    is_task_enabled(TaskMode::User)
}
