use clash_verge_logging::{Type, logging};

/// TUN + fake-ip 模式下写入活动网络服务的系统 DNS 服务器。
///
/// 该值需要与 `enhance::tun` 中启用 TUN 时写入的 DNS 保持一致，
/// 以便 macOS 唤醒后能够用同一个值重新校正系统 DNS。
pub const TUN_SYSTEM_DNS_SERVER: &str = "114.114.114.114";

pub async fn set_public_dns(dns_server: String) {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt as _;
    let app_handle = handle::Handle::app_handle();

    logging!(info, Type::Config, "try to set system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get resource directory: {}", e);
            return;
        }
    };
    let script = resource_dir.join("set_dns.sh");
    if !script.exists() {
        logging!(error, Type::Config, "set_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script, dns_server])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                logging!(info, Type::Config, "set system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                logging!(error, Type::Config, "set system dns failed: {code}");
            }
        }
        Err(err) => {
            logging!(error, Type::Config, "set system dns failed: {err}");
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn restore_public_dns() {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt as _;
    let app_handle = handle::Handle::app_handle();
    logging!(info, Type::Config, "try to unset system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get resource directory: {}", e);
            return;
        }
    };
    let script = resource_dir.join("unset_dns.sh");
    if !script.exists() {
        logging!(error, Type::Config, "unset_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                logging!(info, Type::Config, "unset system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                logging!(error, Type::Config, "unset system dns failed: {code}");
            }
        }
        Err(err) => {
            logging!(error, Type::Config, "unset system dns failed: {err}");
        }
    }
}

/// macOS 睡眠唤醒后的系统 DNS 校正。
///
/// 背景（issue #7593）：在 TUN + `fake-ip` 模式且系统代理关闭时，Clash Verge
/// 会把活动网络服务的系统 DNS 指向自身以便被 TUN 拦截。Mac 睡眠再唤醒后，
/// macOS 可能重建/刷新网络服务并恢复其原始 DNS，而 Tao/Tauri 通用的
/// `RunEvent::Resumed` 在 macOS 上不会触发，导致 DNS 泄漏，直到重启应用。
///
/// 这里通过监听原生 `NSWorkspaceDidWakeNotification`，在唤醒后等待网络服务
/// 稳定并按条件重新写入系统 DNS。
#[cfg(target_os = "macos")]
mod wake {
    use super::{TUN_SYSTEM_DNS_SERVER, set_public_dns};
    use crate::{config::Config, core::handle::Handle, process::AsyncHandler};
    use clash_verge_logging::{Type, logging};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    /// 避免重复注册观察者。
    static OBSERVER_REGISTERED: AtomicBool = AtomicBool::new(false);
    /// 避免多次唤醒事件叠加出多条并发的校正任务。
    static RECONCILE_RUNNING: AtomicBool = AtomicBool::new(false);

    /// 唤醒后网络服务可能异步恢复，单次立即写入并不可靠，
    /// 因此按逐步拉长的间隔重试若干次。
    const WAKE_RETRY_DELAYS_MS: [u64; 4] = [2_000, 4_000, 8_000, 15_000];

    /// 在主线程注册 macOS 唤醒通知观察者。
    ///
    /// 必须在主线程调用（应用 setup 阶段）以安全访问 `NSWorkspace` 共享实例。
    pub fn register_wake_dns_reconciler() {
        use block2::RcBlock;
        use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
        use objc2_foundation::NSNotification;
        use std::ptr::NonNull;

        if OBSERVER_REGISTERED.swap(true, Ordering::SeqCst) {
            return;
        }

        // NSNotificationCenter 会自行拷贝该 block，因此本地的 RcBlock 可安全释放。
        let block = RcBlock::new(move |_notif: NonNull<NSNotification>| {
            on_system_did_wake();
        });

        // SAFETY: 在主线程访问共享的 NSWorkspace 通知中心并注册基于 block 的观察者。
        unsafe {
            let workspace = NSWorkspace::sharedWorkspace();
            let center = workspace.notificationCenter();
            let observer = center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceDidWakeNotification),
                None,
                None,
                &block,
            );
            // 观察者需在整个应用生命周期内保持有效，主动泄漏其引用。
            std::mem::forget(observer);
        }

        logging!(info, Type::System, "已注册 macOS 唤醒 DNS 校正观察者");
    }

    fn on_system_did_wake() {
        logging!(info, Type::System, "检测到 macOS 唤醒，准备校正系统 DNS");
        AsyncHandler::spawn(|| async {
            reconcile_system_dns_after_wake().await;
        });
    }

    /// 唤醒后带重试地重设系统 DNS；每次尝试前都会重新判断是否仍需接管。
    async fn reconcile_system_dns_after_wake() {
        // 若已有校正任务在运行，则跳过，避免并发重复写入。
        if RECONCILE_RUNNING.swap(true, Ordering::SeqCst) {
            logging!(info, Type::System, "唤醒 DNS 校正已在进行中，跳过本次触发");
            return;
        }

        for (idx, delay) in WAKE_RETRY_DELAYS_MS.iter().enumerate() {
            tokio::time::sleep(Duration::from_millis(*delay)).await;

            if !should_reapply_system_dns().await {
                logging!(
                    info,
                    Type::System,
                    "唤醒后无需重设系统 DNS（TUN 关闭 / 非 fake-ip / 应用退出中），停止校正"
                );
                break;
            }

            logging!(
                info,
                Type::System,
                "唤醒后重设系统 DNS（第 {}/{} 次尝试）",
                idx + 1,
                WAKE_RETRY_DELAYS_MS.len()
            );
            // set_dns.sh 已保证：当前 DNS 若已等于目标值则不覆盖原始 DNS 备份，
            // 因此这里的重复写入是安全的（见 issue #7593 与 scripts/set_dns.sh）。
            set_public_dns(TUN_SYSTEM_DNS_SERVER.to_string()).await;
        }

        RECONCILE_RUNNING.store(false, Ordering::SeqCst);
    }

    /// 是否仍需在唤醒后接管系统 DNS。
    ///
    /// 满足全部条件才重设：应用未在退出、TUN 模式已启用、且最终运行时
    /// 配置的 DNS 处于 `fake-ip` 增强模式。
    async fn should_reapply_system_dns() -> bool {
        if Handle::global().is_exiting() {
            return false;
        }

        let tun_enabled = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
        if !tun_enabled {
            return false;
        }

        runtime_uses_fake_ip().await
    }

    /// 判断最终运行时配置的 DNS `enhanced-mode` 是否为 `fake-ip`。
    async fn runtime_uses_fake_ip() -> bool {
        use serde_yaml_ng::Value;

        let runtime = Config::runtime().await.latest_arc();
        let Some(config) = runtime.config.as_ref() else {
            return false;
        };

        config
            .get(Value::from("dns"))
            .and_then(|v| v.as_mapping())
            .and_then(|dns| dns.get(Value::from("enhanced-mode")))
            .and_then(|v| v.as_str())
            .map(|mode| mode == "fake-ip")
            .unwrap_or(false)
    }
}

#[cfg(target_os = "macos")]
pub use wake::register_wake_dns_reconciler;
