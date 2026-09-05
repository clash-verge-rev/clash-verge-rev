//! macOS 13 起由系统管理包内守护进程；服务协议仍由现有服务程序提供。

use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash as _, Hasher as _},
    path::PathBuf,
    sync::mpsc,
};

use anyhow::{Context as _, Result, bail};
use block2::RcBlock;
use objc2::{msg_send, rc::Retained, runtime::AnyClass};
use objc2_foundation::{NSBundle, NSError, NSObject, NSString};

use super::runstate::ServiceHealth;
use crate::utils::dirs;

// 独立于旧安装器的标签，避免旧卸载器留下的 launchctl disable 覆盖新注册。
const PLIST_NAME: &str = "io.github.clash-verge-rev.clash-verge-rev.daemon.plist";

#[link(name = "ServiceManagement", kind = "framework")]
unsafe extern "C" {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Status {
    NotRegistered,
    Enabled,
    RequiresApproval,
    NotFound,
}

pub(super) struct Daemon(Retained<NSObject>);

impl Daemon {
    /// 动态查找类，避免 macOS 11/12 加载不存在的 Objective-C 类符号。
    pub(super) fn current() -> Option<Self> {
        if cfg!(feature = "verge-dev") {
            return None;
        }
        let class = AnyClass::get(c"SMAppService")?;
        let plist = NSString::from_str(PLIST_NAME);
        // SAFETY: 类存在即支持 macOS 13 的方法，返回值是保留的 NSObject 子类。
        Some(Self(unsafe { msg_send![class, daemonServiceWithPlistName: &*plist] }))
    }

    pub(super) fn status(&self) -> Result<Status> {
        // SAFETY: self 只通过 SMAppService 工厂构造；status 的 ABI 是 NSInteger。
        let value: isize = unsafe { msg_send![&*self.0, status] };
        match value {
            0 => Ok(Status::NotRegistered),
            1 => Ok(Status::Enabled),
            2 => Ok(Status::RequiresApproval),
            3 => Ok(Status::NotFound),
            _ => bail!("未知的 macOS 服务注册状态：{value}"),
        }
    }

    pub(super) fn register(&self) -> Result<()> {
        // SAFETY: objc2 按 NSError** 约定接收并保留错误；系统负责验证代码签名。
        let result: Result<(), Retained<NSError>> = unsafe { msg_send![&*self.0, registerAndReturnError: _] };
        if let Err(error) = result {
            // SDK 中 kSMErrorLaunchDeniedByUser 为 11；签名等其他错误必须向用户报告。
            if error.code() != 11 || self.status()? != Status::RequiresApproval {
                bail!("注册 macOS 后台服务失败：{error}");
            }
        }
        std::fs::write(receipt_path()?, bundle_fingerprint()?).context("无法记录 macOS 服务注册版本")?;
        Ok(())
    }

    pub(super) fn unregister(&self) -> Result<()> {
        if self.status()? == Status::NotRegistered {
            return Ok(());
        }
        let (sender, receiver) = mpsc::channel();
        let completion = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: NSError 由框架在回调期间持有，只把错误文本传出回调。
            let error = unsafe { error.as_ref() }.map(ToString::to_string);
            let _ = sender.send(error);
        });
        // SAFETY: 方法会复制 block，回调在进程终止后执行；捕获的数据可跨线程传递。
        unsafe {
            let _: () = msg_send![&*self.0, unregisterWithCompletionHandler: &*completion];
        }
        // 在完成回调之前保留操作锁，避免超时后的重试与尚未结束的注销互相覆盖。
        if let Some(error) = receiver.recv().context("macOS 服务注销回调未完成")? {
            bail!("注销 macOS 后台服务失败：{error}");
        }
        Ok(())
    }

    pub(super) fn registration_health(&self) -> Result<Option<ServiceHealth>> {
        match self.status()? {
            Status::RequiresApproval => Ok(Some(ServiceHealth::ApprovalRequired)),
            Status::Enabled => {
                // 这里只判断是否需要重新注册；信任与权限验证全部交给系统签名检查。
                let receipt = match std::fs::read_to_string(receipt_path()?) {
                    Ok(receipt) => Some(receipt),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(error) => return Err(error).context("无法读取 macOS 服务注册版本"),
                };
                Ok((receipt.as_deref() != Some(bundle_fingerprint()?.as_str()))
                    .then_some(ServiceHealth::VersionMismatch))
            }
            Status::NotRegistered | Status::NotFound => Ok(None),
        }
    }
}

fn receipt_path() -> Result<PathBuf> {
    Ok(dirs::app_home_dir()?.join("macos-service-registration"))
}

fn bundle_fingerprint() -> Result<String> {
    let bundle = PathBuf::from(NSBundle::mainBundle().bundlePath().to_string());
    let mut hash = DefaultHasher::new();
    for relative in [
        "Contents/MacOS/clash-verge-service".to_owned(),
        format!("Contents/Library/LaunchDaemons/{PLIST_NAME}"),
    ] {
        std::fs::read(bundle.join(relative))
            .context("无法读取包内 macOS 服务文件")?
            .hash(&mut hash);
    }
    Ok(format!("{:016x}", hash.finish()))
}

pub(crate) fn registration_health() -> Result<Option<ServiceHealth>> {
    Daemon::current().map_or(Ok(None), |daemon| daemon.registration_health())
}

pub(crate) fn open_settings() -> Result<()> {
    let class = AnyClass::get(c"SMAppService").context("当前 macOS 不支持后台服务批准页面")?;
    // SAFETY: 类存在即支持此类方法；这里只打开系统页面，不修改用户批准状态。
    unsafe {
        let _: () = msg_send![class, openSystemSettingsLoginItems];
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::PLIST_NAME;

    #[test]
    fn native_job_does_not_inherit_legacy_uninstaller_disable_override() {
        assert_ne!(
            PLIST_NAME,
            format!("{}.plist", clash_verge_service_ipc::MACOS_SERVICE_ID)
        );
    }

    #[test]
    #[cfg(feature = "verge-dev")]
    fn development_channel_keeps_its_existing_installer() {
        assert!(super::Daemon::current().is_none());
    }
}
