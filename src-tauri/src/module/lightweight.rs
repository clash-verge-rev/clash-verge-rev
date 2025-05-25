use crate::{
    config::Config,
    core::{handle, timer::Timer},
    log_err, logging, logging_error,
    utils::logging::Type,
    AppHandleManager,
};

use anyhow::{Context, Result};
use delay_timer::prelude::TaskBuilder;
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{Listener, Manager};

const LIGHT_WEIGHT_TASK_UID: &str = "light_weight_task";

// 轻量模式状态标志
static IS_LIGHTWEIGHT_MODE: OnceCell<Arc<RwLock<bool>>> = OnceCell::new();

// 添加一个锁来防止并发退出轻量模式
static EXIT_LOCK: OnceCell<Mutex<(bool, Instant)>> = OnceCell::new();

fn get_lightweight_mode() -> &'static Arc<RwLock<bool>> {
    IS_LIGHTWEIGHT_MODE.get_or_init(|| Arc::new(RwLock::new(false)))
}

fn get_exit_lock() -> &'static Mutex<(bool, Instant)> {
    EXIT_LOCK.get_or_init(|| Mutex::new((false, Instant::now())))
}

// 检查是否处于轻量模式
pub fn is_in_lightweight_mode() -> bool {
    *get_lightweight_mode().read()
}

// 设置轻量模式状态
fn set_lightweight_mode(value: bool) {
    let mut mode = get_lightweight_mode().write();
    *mode = value;
    logging!(info, Type::Lightweight, true, "轻量模式状态: {}", value);
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
    // 标记已进入轻量模式
    set_lightweight_mode(true);
    let _ = cancel_light_weight_timer();
}

// 添加从轻量模式恢复的函数
pub fn exit_lightweight_mode() {
    // 获取锁，检查是否已经有退出操作在进行中
    let mut exit_lock = get_exit_lock().lock();
    let (is_exiting, last_exit_time) = *exit_lock;
    let now = Instant::now();

    // 如果已经有一个退出操作在进行，并且距离上次退出时间不超过2秒，跳过本次退出
    if is_exiting && now.duration_since(last_exit_time) < Duration::from_secs(2) {
        logging!(
            warn,
            Type::Lightweight,
            true,
            "已有退出轻量模式操作正在进行中，跳过本次请求"
        );
        return;
    }

    *exit_lock = (true, now);

    // 确保当前确实处于轻量模式才执行退出操作
    if !is_in_lightweight_mode() {
        logging!(info, Type::Lightweight, true, "当前不在轻量模式，无需退出");
        exit_lock.0 = false;
        return;
    }

    // 标记退出轻量模式
    set_lightweight_mode(false);
    logging!(info, Type::Lightweight, true, "正在退出轻量模式");

    // 重置UI就绪状态
    crate::utils::resolve::reset_ui_ready();

    // 释放锁
    exit_lock.0 = false;
}

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
