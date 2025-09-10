use crate::{
    config::Config,
    core::{handle, timer::Timer, tray::Tray},
    log_err, logging,
    process::AsyncHandler,
    state::proxy::ProxyRequestCache,
    utils::logging::Type,
};

#[cfg(target_os = "macos")]
use crate::logging_error;

use crate::utils::window_manager::WindowManager;
use anyhow::{Context, Result};
use delay_timer::prelude::TaskBuilder;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use tauri::Listener;

const LIGHT_WEIGHT_TASK_UID: &str = "light_weight_task";

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LightweightState {
    Normal = 0,
    In = 1,
    Exiting = 2,
}

impl From<u8> for LightweightState {
    fn from(v: u8) -> Self {
        match v {
            1 => LightweightState::In,
            2 => LightweightState::Exiting,
            _ => LightweightState::Normal,
        }
    }
}

impl LightweightState {
    fn as_u8(self) -> u8 {
        self as u8
    }
}

static LIGHTWEIGHT_STATE: AtomicU8 = AtomicU8::new(LightweightState::Normal as u8);

static WINDOW_CLOSE_HANDLER: AtomicU32 = AtomicU32::new(0);
static WEBVIEW_FOCUS_HANDLER: AtomicU32 = AtomicU32::new(0);

fn set_state(new: LightweightState) {
    LIGHTWEIGHT_STATE.store(new.as_u8(), Ordering::Release);
    match new {
        LightweightState::Normal => {
            logging!(info, Type::Lightweight, true, "轻量模式已关闭");
        }
        LightweightState::In => {
            logging!(info, Type::Lightweight, true, "轻量模式已开启");
        }
        LightweightState::Exiting => {
            logging!(info, Type::Lightweight, true, "正在退出轻量模式");
        }
    }
}

fn get_state() -> LightweightState {
    LIGHTWEIGHT_STATE.load(Ordering::Acquire).into()
}

// 检查是否处于轻量模式
pub fn is_in_lightweight_mode() -> bool {
    get_state() == LightweightState::In
}

// 设置轻量模式状态（仅 Normal <-> In）
async fn set_lightweight_mode(value: bool) {
    let current = get_state();
    if value && current != LightweightState::In {
        set_state(LightweightState::In);
    } else if !value && current != LightweightState::Normal {
        set_state(LightweightState::Normal);
    }

    // 只有在状态可用时才触发托盘更新
    if let Err(e) = Tray::global().update_part().await {
        log::warn!("Failed to update tray: {e}");
    }
}

pub async fn run_once_auto_lightweight() {
    let verge_config = Config::verge().await;
    let enable_auto = verge_config
        .data_mut()
        .enable_auto_light_weight_mode
        .unwrap_or(false);
    let is_silent_start = verge_config
        .latest_ref()
        .enable_silent_start
        .unwrap_or(false);

    if !(enable_auto && is_silent_start) {
        logging!(
            info,
            Type::Lightweight,
            true,
            "不满足静默启动且自动进入轻量模式的条件，跳过自动进入轻量模式"
        );
        return;
    }

    logging!(
        info,
        Type::Lightweight,
        true,
        "在静默启动的情况下，创建窗口再添加自动进入轻量模式窗口监听器"
    );

    set_lightweight_mode(true).await;
    enable_auto_light_weight_mode().await;
}

pub async fn auto_lightweight_mode_init() -> Result<()> {
    let is_silent_start =
        { Config::verge().await.latest_ref().enable_silent_start }.unwrap_or(false);
    let enable_auto = {
        Config::verge()
            .await
            .latest_ref()
            .enable_auto_light_weight_mode
    }
    .unwrap_or(false);

    if enable_auto && !is_silent_start {
        logging!(
            info,
            Type::Lightweight,
            true,
            "非静默启动直接挂载自动进入轻量模式监听器！"
        );
        set_state(LightweightState::Normal);
        enable_auto_light_weight_mode().await;
    }

    Ok(())
}

pub async fn enable_auto_light_weight_mode() {
    if let Err(e) = Timer::global().init().await {
        logging!(error, Type::Lightweight, "Failed to initialize timer: {e}");
        return;
    }
    logging!(info, Type::Lightweight, true, "开启自动轻量模式");
    setup_window_close_listener();
    setup_webview_focus_listener();
}

pub fn disable_auto_light_weight_mode() {
    logging!(info, Type::Lightweight, true, "关闭自动轻量模式");
    let _ = cancel_light_weight_timer();
    cancel_window_close_listener();
    cancel_webview_focus_listener();
}

pub async fn entry_lightweight_mode() -> bool {
    // 尝试从 Normal -> In
    if LIGHTWEIGHT_STATE
        .compare_exchange(
            LightweightState::Normal as u8,
            LightweightState::In as u8,
            Ordering::Acquire,
            Ordering::Relaxed,
        )
        .is_err()
    {
        logging!(info, Type::Lightweight, true, "无需进入轻量模式，跳过调用");
        return false;
    }

    WindowManager::destroy_main_window();

    set_lightweight_mode(true).await;
    let _ = cancel_light_weight_timer();

    // 回到 In
    set_state(LightweightState::In);

    ProxyRequestCache::global().clean_default_keys();
    true
}

// 添加从轻量模式恢复的函数
pub async fn exit_lightweight_mode() -> bool {
    // 尝试从 In -> Exiting
    if LIGHTWEIGHT_STATE
        .compare_exchange(
            LightweightState::In as u8,
            LightweightState::Exiting as u8,
            Ordering::Acquire,
            Ordering::Relaxed,
        )
        .is_err()
    {
        logging!(
            info,
            Type::Lightweight,
            true,
            "轻量模式不在退出条件（可能已退出或正在退出），跳过调用"
        );
        return false;
    }

    WindowManager::show_main_window().await;

    set_lightweight_mode(false).await;
    let _ = cancel_light_weight_timer();

    // 回到 Normal
    set_state(LightweightState::Normal);

    logging!(info, Type::Lightweight, true, "轻量模式退出完成");
    true
}

#[cfg(target_os = "macos")]
pub async fn add_light_weight_timer() {
    logging_error!(Type::Lightweight, setup_light_weight_timer().await);
}

fn setup_window_close_listener() {
    if let Some(window) = handle::Handle::global().get_window() {
        let handler = window.listen("tauri://close-requested", move |_event| {
            std::mem::drop(AsyncHandler::spawn(|| async {
                if let Err(e) = setup_light_weight_timer().await {
                    log::warn!("Failed to setup light weight timer: {e}");
                }
            }));
            logging!(
                info,
                Type::Lightweight,
                true,
                "监听到关闭请求，开始轻量模式计时"
            );
        });

        WINDOW_CLOSE_HANDLER.store(handler, Ordering::Release);
    }
}

fn cancel_window_close_listener() {
    if let Some(window) = handle::Handle::global().get_window() {
        let handler = WINDOW_CLOSE_HANDLER.swap(0, Ordering::AcqRel);
        if handler != 0 {
            window.unlisten(handler);
            logging!(info, Type::Lightweight, true, "取消了窗口关闭监听");
        }
    }
}

fn setup_webview_focus_listener() {
    if let Some(window) = handle::Handle::global().get_window() {
        let handler = window.listen("tauri://focus", move |_event| {
            log_err!(cancel_light_weight_timer());
            logging!(
                info,
                Type::Lightweight,
                "监听到窗口获得焦点，取消轻量模式计时"
            );
        });

        WEBVIEW_FOCUS_HANDLER.store(handler, Ordering::Release);
    }
}

fn cancel_webview_focus_listener() {
    if let Some(window) = handle::Handle::global().get_window() {
        let handler = WEBVIEW_FOCUS_HANDLER.swap(0, Ordering::AcqRel);
        if handler != 0 {
            window.unlisten(handler);
            logging!(info, Type::Lightweight, true, "取消了窗口焦点监听");
        }
    }
}

async fn setup_light_weight_timer() -> Result<()> {
    Timer::global().init().await?;
    let once_by_minutes = Config::verge()
        .await
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
            entry_lightweight_mode().await;
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
