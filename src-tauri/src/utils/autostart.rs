#[cfg(target_os = "windows")]
use anyhow::{Result, anyhow};
#[cfg(target_os = "windows")]
use clash_verge_logging::{Type, logging};

#[cfg(target_os = "windows")]
use std::{os::windows::process::CommandExt as _, path::Path, path::PathBuf};

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
    let exe_path = std::env::current_exe().map_err(|e| anyhow!("无法获取当前可执行文件路径: {}", e))?;

    Ok(exe_path)
}

/// 创建快捷方式
#[cfg(target_os = "windows")]
pub async fn create_shortcut() -> Result<()> {
    use crate::utils::dirs::PathBufExec as _;

    let exe_path = get_exe_path()?;
    let startup_dir = get_startup_dir()?;
    let old_shortcut_path = startup_dir.join("Clash-Verge.lnk");
    let new_shortcut_path = startup_dir.join("Clash Verge.lnk");

    // 移除旧的快捷方式
    let _ = old_shortcut_path
        .remove_if_exists()
        .await
        .inspect(|_| {
            logging!(info, Type::Setup, "成功移除旧启动快捷方式");
        })
        .inspect_err(|err| {
            logging!(error, Type::Setup, "移除旧启动快捷方式失败: {err}");
        });

    // 如果新快捷方式已存在，直接返回成功
    if new_shortcut_path.exists() {
        logging!(info, Type::Setup, "启动快捷方式已存在");
        return Ok(());
    }

    // 使用 PowerShell 创建快捷方式
    let powershell_command = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = '{}'; \
         $Shortcut.Save()",
        new_shortcut_path.to_string_lossy().replace("\\", "\\\\"),
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

    logging!(info, Type::Setup, "成功创建启动快捷方式");
    Ok(())
}

/// 删除快捷方式
#[cfg(target_os = "windows")]
pub async fn remove_shortcut() -> Result<()> {
    use crate::utils::dirs::PathBufExec as _;

    let startup_dir = get_startup_dir()?;
    let old_shortcut_path = startup_dir.join("Clash-Verge.lnk");
    let new_shortcut_path = startup_dir.join("Clash Verge.lnk");

    let mut removed_any = false;

    let _ = old_shortcut_path
        .remove_if_exists()
        .await
        .inspect(|_| {
            logging!(info, Type::Setup, "成功删除旧启动快捷方式");
            removed_any = true;
        })
        .inspect_err(|err| {
            logging!(error, Type::Setup, "删除旧启动快捷方式失败: {err}");
        });

    let _ = new_shortcut_path
        .remove_if_exists()
        .await
        .inspect(|_| {
            logging!(info, Type::Setup, "成功删除启动快捷方式");
            removed_any = true;
        })
        .inspect_err(|err| {
            logging!(error, Type::Setup, "删除启动快捷方式失败: {err}");
        });

    Ok(())
}

/// 检查快捷方式是否存在
#[cfg(target_os = "windows")]
pub fn is_shortcut_enabled() -> Result<bool> {
    let startup_dir = get_startup_dir()?;
    let new_shortcut_path = startup_dir.join("Clash Verge.lnk");

    Ok(new_shortcut_path.exists())
}
