#[cfg(target_os = "windows")]
use anyhow::{anyhow, Result};
#[cfg(target_os = "windows")]
use log::info;

#[cfg(target_os = "windows")]
use std::{fs, os::windows::process::CommandExt, path::Path, path::PathBuf};

#[cfg(target_os = "windows")]
use winreg::{enums::*, RegKey};

/// Windows 下的开机启动文件夹路径
#[cfg(target_os = "windows")]
pub fn get_startup_dir() -> Result<PathBuf> {
    let appdata = std::env::var("APPDATA").map_err(|_| anyhow!("无法获取 APPDATA 环境变量"))?;

    let startup_dir = Path::new(&appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup");

    if !startup_dir.exists() {
        return Err(anyhow!("Startup 目录不存在: {:?}", startup_dir));
    }

    Ok(startup_dir)
}

/// 获取当前可执行文件路径
#[cfg(target_os = "windows")]
pub fn get_exe_path() -> Result<PathBuf> {
    let exe_path =
        std::env::current_exe().map_err(|e| anyhow!("无法获取当前可执行文件路径: {}", e))?;

    Ok(exe_path)
}

/// 创建快捷方式
#[cfg(target_os = "windows")]
pub fn create_shortcut() -> Result<()> {
    let exe_path = get_exe_path()?;
    let startup_dir = get_startup_dir()?;
    let shortcut_path = startup_dir.join("Clash-Verge.lnk");

    // 如果快捷方式已存在，直接返回成功
    if shortcut_path.exists() {
        info!(target: "app", "启动快捷方式已存在");
        return Ok(());
    }

    // 使用 PowerShell 创建快捷方式
    let powershell_command = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = '{}'; \
         $Shortcut.Save()",
        shortcut_path.to_string_lossy().replace("\\", "\\\\"),
        exe_path.to_string_lossy().replace("\\", "\\\\")
    );

    let output = std::process::Command::new("powershell")
        .args(["-Command", &powershell_command])
        // 隐藏 PowerShell 窗口
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| anyhow!("执行 PowerShell 命令失败: {}", e))?;

    if !output.status.success() {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("创建快捷方式失败: {}", error_msg));
    }

    info!(target: "app", "成功创建启动快捷方式");
    Ok(())
}

/// 删除注册表中启动项
#[cfg(target_os = "windows")]
fn remove_registry_startup_entries() -> Result<()> {
    // 定义需要检查的注册表路径
    let registry_paths = vec![
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce",
        ),
    ];

    // 检查Clash Verge的关键字
    let keywords = vec!["Clash Verge", "clash-verge"];

    for (hkey, path) in registry_paths {
        match RegKey::predef(hkey).open_subkey_with_flags(path, KEY_READ | KEY_WRITE) {
            Ok(key) => {
                // 枚举所有值
                for result in key.enum_values() {
                    if let Ok((value_name, _)) = result {
                        // 检查值名称是否包含关键字
                        if keywords.iter().any(|kw| value_name.contains(kw)) {
                            if let Err(e) = key.delete_value(&value_name) {
                                info!(target: "app", "删除注册表值失败 {}: {}", value_name, e);
                            } else {
                                info!(target: "app", "已删除注册表值: {}", value_name);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                info!(target: "app", "无法访问注册表路径 {}: {}", path, e);
            }
        }
    }

    Ok(())
}

/// 删除快捷方式
#[cfg(target_os = "windows")]
pub fn remove_shortcut() -> Result<()> {
    // 先删除注册表中的启动项
    remove_registry_startup_entries()?;

    let startup_dir = get_startup_dir()?;
    let shortcut_path = startup_dir.join("Clash-Verge.lnk");

    // 如果快捷方式不存在，直接返回成功
    if !shortcut_path.exists() {
        info!(target: "app", "启动快捷方式不存在，无需删除");
        return Ok(());
    }

    // 删除快捷方式
    fs::remove_file(&shortcut_path).map_err(|e| anyhow!("删除快捷方式失败: {}", e))?;

    info!(target: "app", "成功删除启动快捷方式");
    Ok(())
}

/// 检查快捷方式是否存在
#[cfg(target_os = "windows")]
pub fn is_shortcut_enabled() -> Result<bool> {
    let startup_dir = get_startup_dir()?;
    let shortcut_path = startup_dir.join("Clash-Verge.lnk");

    Ok(shortcut_path.exists())
}

// 非 Windows 平台使用的空方法
// #[cfg(not(target_os = "windows"))]
// pub fn create_shortcut() -> Result<()> {
//     Ok(())
// }

// #[cfg(not(target_os = "windows"))]
// pub fn remove_shortcut() -> Result<()> {
//     Ok(())
// }

// #[cfg(not(target_os = "windows"))]
// pub fn is_shortcut_enabled() -> Result<bool> {
//     Ok(false)
// }
