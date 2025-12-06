use crate::{
    config::Config,
    core::{handle, timer::Timer, tray::Tray},
    process::AsyncHandler,
};

use clash_verge_logging::{Type, logging, logging_error};

use crate::utils::window_manager::WindowManager;
use anyhow::{Context as _, Result};
use delay_timer::prelude::TaskBuilder;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use tauri::Listener as _;

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
            1 => Self::In,
            2 => Self::Exiting,
            _ => Self::Normal,
        }
    }
}

impl LightweightState {
    const fn as_u8(self) -> u8 {
        self as u8
    }
}

static LIGHTWEIGHT_STATE: AtomicU8 = AtomicU8::new(LightweightState::Normal as u8);

static WINDOW_CLOSE_HANDLER_ID: AtomicU32 = AtomicU32::new(0);
static WEBVIEW_FOCUS_HANDLER_ID: AtomicU32 = AtomicU32::new(0);

#[inline]
fn get_state() -> LightweightState {
    LIGHTWEIGHT_STATE.load(Ordering::Acquire).into()
}

#[inline]
fn try_transition(from: LightweightState, to: LightweightState) -> bool {
    LIGHTWEIGHT_STATE
        .compare_exchange(from.as_u8(), to.as_u8(), Ordering::AcqRel, Ordering::Relaxed)
        .is_ok()
}

#[inline]
fn record_state_and_log(state: LightweightState) {
    LIGHTWEIGHT_STATE.store(state.as_u8(), Ordering::Release);
    match state {
        LightweightState::Normal => logging!(info, Type::Lightweight, "轻量模式已关闭"),
        LightweightState::In => logging!(info, Type::Lightweight, "轻量模式已开启"),
        LightweightState::Exiting => logging!(info, Type::Lightweight, "正在退出轻量模式"),
    }
}

#[inline]
pub fn is_in_lightweight_mode() -> bool {
    get_state() == LightweightState::In
}

async fn refresh_lightweight_tray_state() {
    if let Err(err) = Tray::global().update_menu().await {
        logging!(warn, Type::Lightweight, "更新托盘轻量模式状态失败: {err}");
    }
}

pub async fn auto_lightweight_boot() -> Result<()> {
    let verge_config = Config::verge().await;
    let is_enable_auto = verge_config.data_arc().enable_auto_light_weight_mode.unwrap_or(false);
    let is_silent_start = verge_config.data_arc().enable_silent_start.unwrap_or(false);
    if is_enable_auto {
        enable_auto_light_weight_mode().await;
    }
    if is_silent_start {
        entry_lightweight_mode().await;
    }
    Ok(())
}

pub async fn enable_auto_light_weight_mode() {
    if let Err(e) = Timer::global().init().await {
        logging!(error, Type::Lightweight, "Failed to initialize timer: {e}");
        return;
    }
    logging!(info, Type::Lightweight, "开启自动轻量模式");
    setup_window_close_listener();
    setup_webview_focus_listener();
}

pub fn disable_auto_light_weight_mode() {
    logging!(info, Type::Lightweight, "关闭自动轻量模式");
    let _ = cancel_light_weight_timer();
    cancel_window_close_listener();
    cancel_webview_focus_listener();
}

pub async fn entry_lightweight_mode() -> bool {
    if !try_transition(LightweightState::Normal, LightweightState::In) {
        logging!(debug, Type::Lightweight, "无需进入轻量模式，跳过调用");
        refresh_lightweight_tray_state().await;
        return false;
    }
    record_state_and_log(LightweightState::In);
    WindowManager::destroy_main_window();
    let _ = cancel_light_weight_timer();
    refresh_lightweight_tray_state().await;
    true
}

pub async fn exit_lightweight_mode() -> bool {
    if !try_transition(LightweightState::In, LightweightState::Exiting) {
        logging!(
            debug,
            Type::Lightweight,
            "轻量模式不在退出条件（可能已退出或正在退出），跳过调用"
        );
        refresh_lightweight_tray_state().await;
        return false;
    }
    record_state_and_log(LightweightState::Exiting);
    WindowManager::show_main_window().await;
    let _ = cancel_light_weight_timer();
    record_state_and_log(LightweightState::Normal);
    refresh_lightweight_tray_state().await;
    true
}

#[cfg(target_os = "macos")]
pub async fn add_light_weight_timer() {
    logging_error!(Type::Lightweight, setup_light_weight_timer().await);
}

fn setup_window_close_listener() {
    if let Some(window) = handle::Handle::get_window() {
        let handler_id = window.listen("tauri://close-requested", move |_event| {
            std::mem::drop(AsyncHandler::spawn(|| async {
                if let Err(e) = setup_light_weight_timer().await {
                    logging!(
                        warn,
                        Type::Lightweight,
                        "Warning: Failed to setup light weight timer: {e}"
                    );
                }
            }));
            logging!(info, Type::Lightweight, "监听到关闭请求，开始轻量模式计时");
        });
        WINDOW_CLOSE_HANDLER_ID.store(handler_id, Ordering::Release);
    }
}

fn cancel_window_close_listener() {
    if let Some(window) = handle::Handle::get_window() {
        let id = WINDOW_CLOSE_HANDLER_ID.swap(0, Ordering::AcqRel);
        if id != 0 {
            window.unlisten(id);
            logging!(debug, Type::Lightweight, "取消了窗口关闭监听");
        }
    }
}

fn setup_webview_focus_listener() {
    if let Some(window) = handle::Handle::get_window() {
        let handler_id = window.listen("tauri://focus", move |_event| {
            logging_error!(Type::Lightweight, cancel_light_weight_timer());
            logging!(debug, Type::Lightweight, "监听到窗口获得焦点，取消轻量模式计时");
        });
        WEBVIEW_FOCUS_HANDLER_ID.store(handler_id, Ordering::Release);
    }
}

fn cancel_webview_focus_listener() {
    if let Some(window) = handle::Handle::get_window() {
        let id = WEBVIEW_FOCUS_HANDLER_ID.swap(0, Ordering::AcqRel);
        if id != 0 {
            window.unlisten(id);
            logging!(debug, Type::Lightweight, "取消了窗口焦点监听");
        }
    }
}

async fn setup_light_weight_timer() -> Result<()> {
    if let Err(e) = Timer::global().init().await {
        return Err(e).context("failed to initialize timer");
    }

    let once_by_minutes = Config::verge().await.data_arc().auto_light_weight_minutes.unwrap_or(10);

    {
        let timer_map = Timer::global().timer_map.read();
        if timer_map.contains_key(LIGHT_WEIGHT_TASK_UID) {
            logging!(debug, Type::Timer, "轻量模式计时器已存在，跳过创建");
            return Ok(());
        }
    }

    let task_id = {
        Timer::global()
            .timer_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    };

    let task = TaskBuilder::default()
        .set_task_id(task_id)
        .set_maximum_parallel_runnable_num(1)
        .set_frequency_once_by_minutes(once_by_minutes)
        .spawn_async_routine(move || async move {
            logging!(info, Type::Timer, "计时器到期，开始进入轻量模式");
            entry_lightweight_mode().await;
        })
        .context("failed to create timer task")?;

    {
        let delay_timer = Timer::global().delay_timer.write();
        delay_timer.add_task(task).context("failed to add timer task")?;
    }

    {
        let mut timer_map = Timer::global().timer_map.write();
        let timer_task = crate::core::timer::TimerTask {
            task_id,
            interval_minutes: once_by_minutes,
            last_run: chrono::Local::now().timestamp(),
        };
        timer_map.insert(LIGHT_WEIGHT_TASK_UID.into(), timer_task);
    }

    logging!(
        info,
        Type::Timer,
        "计时器已设置，{} 分钟后将自动进入轻量模式",
        once_by_minutes
    );

    Ok(())
}

fn cancel_light_weight_timer() -> Result<()> {
    let value = Timer::global().timer_map.write().remove(LIGHT_WEIGHT_TASK_UID);
    if let Some(task) = value {
        Timer::global()
            .delay_timer
            .write()
            .remove_task(task.task_id)
            .context("failed to remove timer task")?;
        logging!(debug, Type::Timer, "计时器已取消");
    }

    Ok(())
}
