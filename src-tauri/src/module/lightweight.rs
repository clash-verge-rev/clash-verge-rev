use crate::{
    config::Config,
    core::{handle, timer::Timer, tray::Tray},
    log_err, logging,
    state::lightweight::LightWeightState,
    utils::logging::Type,
};

#[cfg(target_os = "macos")]
use crate::logging_error;
#[cfg(target_os = "macos")]
use crate::AppHandleManager;

use anyhow::{Context, Result};
use delay_timer::prelude::TaskBuilder;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Listener, Manager};

const LIGHT_WEIGHT_TASK_UID: &str = "light_weight_task";

// 添加退出轻量模式的锁，防止并发调用
static EXITING_LIGHTWEIGHT: AtomicBool = AtomicBool::new(false);

fn with_lightweight_status<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut LightWeightState) -> R,
{
    if let Some(app_handle) = handle::Handle::global().app_handle() {
        // Try to get state, but don't panic if it's not managed yet
        if let Some(state) = app_handle.try_state::<Mutex<LightWeightState>>() {
            let mut guard = state.lock();
            Some(f(&mut guard))
        } else {
            // State not managed yet, return None
            None
        }
    } else {
        // App handle not available yet
        None
    }
}

pub fn run_once_auto_lightweight() {
    LightWeightState::default().run_once_time(|| {
        let is_silent_start = Config::verge()
            .latest_ref()
            .enable_silent_start
            .unwrap_or(false);
        let enable_auto = Config::verge()
            .data_mut()
            .enable_auto_light_weight_mode
            .unwrap_or(false);
        if enable_auto && is_silent_start {
            logging!(
                info,
                Type::Lightweight,
                true,
                "在静默启动的情况下，创建窗口再添加自动进入轻量模式窗口监听器"
            );
            set_lightweight_mode(false);
            enable_auto_light_weight_mode();

            // 触发托盘更新
            if let Err(e) = Tray::global().update_part() {
                log::warn!("Failed to update tray: {e}");
            }
        }
    });
}

pub fn auto_lightweight_mode_init() {
    if let Some(app_handle) = handle::Handle::global().app_handle() {
        // Check if state is available before accessing it
        if app_handle.try_state::<Mutex<LightWeightState>>().is_none() {
            logging!(
                warn,
                Type::Lightweight,
                true,
                "LightWeightState 尚未初始化，跳过自动轻量模式初始化"
            );
            return;
        }

        let is_silent_start = { Config::verge().latest_ref().enable_silent_start }.unwrap_or(false);
        let enable_auto =
            { Config::verge().latest_ref().enable_auto_light_weight_mode }.unwrap_or(false);

        if enable_auto && !is_silent_start {
            logging!(
                info,
                Type::Lightweight,
                true,
                "非静默启动直接挂载自动进入轻量模式监听器！"
            );
            set_lightweight_mode(true);
            enable_auto_light_weight_mode();

            // 确保托盘状态更新
            if let Err(e) = Tray::global().update_part() {
                log::warn!("Failed to update tray: {e}");
            }
        }
    }
}

// 检查是否处于轻量模式
pub fn is_in_lightweight_mode() -> bool {
    with_lightweight_status(|state| state.is_lightweight).unwrap_or(false)
}

// 设置轻量模式状态
pub fn set_lightweight_mode(value: bool) {
    if with_lightweight_status(|state| {
        state.set_lightweight_mode(value);
    })
    .is_some()
    {
        // 只有在状态可用时才触发托盘更新
        if let Err(e) = Tray::global().update_part() {
            log::warn!("Failed to update tray: {e}");
        }
    }
}

pub fn enable_auto_light_weight_mode() {
    Timer::global().init().unwrap();
    logging!(info, Type::Lightweight, true, "开启自动轻量模式");
    setup_window_close_listener();
    setup_webview_focus_listener();
}

pub fn disable_auto_light_weight_mode() {
    logging!(info, Type::Lightweight, true, "关闭自动轻量模式");
    let _ = cancel_light_weight_timer();
    cancel_window_close_listener();
}

pub fn entry_lightweight_mode() {
    use crate::utils::window_manager::WindowManager;

    let result = WindowManager::hide_main_window();
    logging!(
        info,
        Type::Lightweight,
        true,
        "轻量模式隐藏窗口结果: {:?}",
        result
    );

    if let Some(window) = handle::Handle::global().get_window() {
        if let Some(webview) = window.get_webview_window("main") {
            let _ = webview.destroy();
        }
        #[cfg(target_os = "macos")]
        AppHandleManager::global().set_activation_policy_accessory();
    }
    set_lightweight_mode(true);
    let _ = cancel_light_weight_timer();

    // 更新托盘显示
    let _tray = crate::core::tray::Tray::global();
}

// 添加从轻量模式恢复的函数
pub fn exit_lightweight_mode() {
    // 使用原子操作检查是否已经在退出过程中，防止并发调用
    if EXITING_LIGHTWEIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        logging!(
            info,
            Type::Lightweight,
            true,
            "轻量模式退出操作已在进行中，跳过重复调用"
        );
        return;
    }

    // 使用defer确保无论如何都会重置标志
    let _guard = scopeguard::guard((), |_| {
        EXITING_LIGHTWEIGHT.store(false, Ordering::SeqCst);
    });

    // 确保当前确实处于轻量模式才执行退出操作
    if !is_in_lightweight_mode() {
        logging!(info, Type::Lightweight, true, "当前不在轻量模式，无需退出");
        return;
    }

    set_lightweight_mode(false);

    // macOS激活策略
    #[cfg(target_os = "macos")]
    AppHandleManager::global().set_activation_policy_regular();

    // 重置UI就绪状态
    crate::utils::resolve::reset_ui_ready();

    // 更新托盘显示
    let _tray = crate::core::tray::Tray::global();
}

#[cfg(target_os = "macos")]
pub fn add_light_weight_timer() {
    logging_error!(Type::Lightweight, setup_light_weight_timer());
}

fn setup_window_close_listener() -> u32 {
    if let Some(window) = handle::Handle::global().get_window() {
        let handler = window.listen("tauri://close-requested", move |_event| {
            let _ = setup_light_weight_timer();
            logging!(
                info,
                Type::Lightweight,
                true,
                "监听到关闭请求，开始轻量模式计时"
            );
        });
        return handler;
    }
    0
}

fn setup_webview_focus_listener() -> u32 {
    if let Some(window) = handle::Handle::global().get_window() {
        let handler = window.listen("tauri://focus", move |_event| {
            log_err!(cancel_light_weight_timer());
            logging!(
                info,
                Type::Lightweight,
                "监听到窗口获得焦点，取消轻量模式计时"
            );
        });
        return handler;
    }
    0
}

fn cancel_window_close_listener() {
    if let Some(window) = handle::Handle::global().get_window() {
        window.unlisten(setup_window_close_listener());
        logging!(info, Type::Lightweight, true, "取消了窗口关闭监听");
    }
}

fn setup_light_weight_timer() -> Result<()> {
    Timer::global().init()?;
    let once_by_minutes = Config::verge()
        .latest_ref()
        .auto_light_weight_minutes
        .unwrap_or(10);

    // 获取task_id
    let task_id = {
        Timer::global()
            .timer_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    };

    // 创建任务
    let task = TaskBuilder::default()
        .set_task_id(task_id)
        .set_maximum_parallel_runnable_num(1)
        .set_frequency_once_by_minutes(once_by_minutes)
        .spawn_async_routine(move || async move {
            logging!(info, Type::Timer, true, "计时器到期，开始进入轻量模式");
            entry_lightweight_mode();
        })
        .context("failed to create timer task")?;

    // 添加任务到定时器
    {
        let delay_timer = Timer::global().delay_timer.write();
        delay_timer
            .add_task(task)
            .context("failed to add timer task")?;
    }

    // 更新任务映射
    {
        let mut timer_map = Timer::global().timer_map.write();
        let timer_task = crate::core::timer::TimerTask {
            task_id,
            interval_minutes: once_by_minutes,
            last_run: chrono::Local::now().timestamp(),
        };
        timer_map.insert(LIGHT_WEIGHT_TASK_UID.to_string(), timer_task);
    }

    logging!(
        info,
        Type::Timer,
        true,
        "计时器已设置，{} 分钟后将自动进入轻量模式",
        once_by_minutes
    );

    Ok(())
}

fn cancel_light_weight_timer() -> Result<()> {
    let mut timer_map = Timer::global().timer_map.write();
    let delay_timer = Timer::global().delay_timer.write();

    if let Some(task) = timer_map.remove(LIGHT_WEIGHT_TASK_UID) {
        delay_timer
            .remove_task(task.task_id)
            .context("failed to remove timer task")?;
        logging!(info, Type::Timer, true, "计时器已取消");
    }

    Ok(())
}
