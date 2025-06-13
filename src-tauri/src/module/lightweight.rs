use crate::{
    config::Config,
    core::{handle, timer::Timer},
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
use std::sync::Mutex;
use tauri::{Listener, Manager};

const LIGHT_WEIGHT_TASK_UID: &str = "light_weight_task";

fn with_lightweight_status<F, R>(f: F) -> R
where
    F: FnOnce(&mut LightWeightState) -> R,
{
    let app_handle = handle::Handle::global().app_handle().unwrap();
    let state = app_handle.state::<Mutex<LightWeightState>>();
    let mut guard = state.lock().unwrap();
    f(&mut guard)
}

pub fn run_once_auto_lightweight() {
    LightWeightState::default().run_once_time(|| {
        let is_silent_start = Config::verge().data().enable_silent_start.unwrap_or(false);
        let enable_auto = Config::verge()
            .data()
            .enable_auto_light_weight_mode
            .unwrap_or(false);
        if enable_auto && is_silent_start {
            logging!(
                info,
                Type::Lightweight,
                true,
                "Add timer listener when creating window in silent start mode"
            );
            set_lightweight_mode(true);
            enable_auto_light_weight_mode();
        }
    });
}

pub fn auto_lightweight_mode_init() {
    if let Some(app_handle) = handle::Handle::global().app_handle() {
        // 通过 app_handle.state 保证同步
        let _ = app_handle.state::<Mutex<LightWeightState>>();
        let is_silent_start = { Config::verge().data().enable_silent_start }.unwrap_or(false);
        let enable_auto = { Config::verge().data().enable_auto_light_weight_mode }.unwrap_or(false);
        if enable_auto && !is_silent_start {
            logging!(
                info,
                Type::Lightweight,
                true,
                "Add timer listener when creating window normally"
            );
            set_lightweight_mode(true);
            enable_auto_light_weight_mode();
        }
    }
}

// 检查是否处于轻量模式
pub fn is_in_lightweight_mode() -> bool {
    with_lightweight_status(|state| state.is_lightweight)
}

// 设置轻量模式状态
fn set_lightweight_mode(value: bool) {
    with_lightweight_status(|state| {
        state.set_lightweight_mode(value);
    });
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
    if let Some(window) = handle::Handle::global().get_window() {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
        if let Some(webview) = window.get_webview_window("main") {
            let _ = webview.destroy();
        }
        #[cfg(target_os = "macos")]
        AppHandleManager::global().set_activation_policy_accessory();
        logging!(info, Type::Lightweight, true, "轻量模式已开启");
    }
    set_lightweight_mode(true);
    let _ = cancel_light_weight_timer();
}

// 添加从轻量模式恢复的函数
pub fn exit_lightweight_mode() {
    // 确保当前确实处于轻量模式才执行退出操作
    if !is_in_lightweight_mode() {
        logging!(info, Type::Lightweight, true, "当前不在轻量模式，无需退出");
        return;
    }

    set_lightweight_mode(false);
    logging!(info, Type::Lightweight, true, "正在退出轻量模式");

    // 重置UI就绪状态
    crate::utils::resolve::reset_ui_ready();
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

    let mut timer_map = Timer::global().timer_map.write();
    let delay_timer = Timer::global().delay_timer.write();
    let mut timer_count = Timer::global().timer_count.lock();

    let task_id = *timer_count;
    *timer_count += 1;

    let once_by_minutes = Config::verge()
        .latest()
        .auto_light_weight_minutes
        .unwrap_or(10);

    let task = TaskBuilder::default()
        .set_task_id(task_id)
        .set_maximum_parallel_runnable_num(1)
        .set_frequency_once_by_minutes(once_by_minutes)
        .spawn_async_routine(move || async move {
            logging!(info, Type::Timer, true, "计时器到期，开始进入轻量模式");
            entry_lightweight_mode();
        })
        .context("failed to create timer task")?;

    delay_timer
        .add_task(task)
        .context("failed to add timer task")?;

    let timer_task = crate::core::timer::TimerTask {
        task_id,
        interval_minutes: once_by_minutes,
        last_run: chrono::Local::now().timestamp(),
    };

    timer_map.insert(LIGHT_WEIGHT_TASK_UID.to_string(), timer_task);

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
