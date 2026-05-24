use crate::{
    config::Config,
    core::{timer::Timer, tray::Tray},
    process::AsyncHandler,
};

use clash_verge_logging::{Type, logging};

use crate::utils::window_manager::WindowManager;
use anyhow::Result;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use tauri::Listener as _;
use tokio::sync::oneshot;
use tokio::time::{Duration, sleep};

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

static CANCEL_TX: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

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
    cancel_light_weight_timer();
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
    cancel_light_weight_timer();
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
    let enable_auto_light_weight_mode = Config::verge()
        .await
        .data_arc()
        .enable_auto_light_weight_mode
        .unwrap_or(false);
    if enable_auto_light_weight_mode {
        setup_window_close_listener();
        setup_webview_focus_listener();
    }
    cancel_light_weight_timer();
    record_state_and_log(LightweightState::Normal);
    refresh_lightweight_tray_state().await;
    true
}

#[cfg(target_os = "macos")]
pub async fn add_light_weight_timer() {
    setup_light_weight_timer().await;
}

fn setup_window_close_listener() {
    if let Some(window) = WindowManager::get_main_window() {
        let previous_handler_id = WINDOW_CLOSE_HANDLER_ID.swap(0, Ordering::AcqRel);
        if previous_handler_id != 0 {
            window.unlisten(previous_handler_id);
            logging!(debug, Type::Lightweight, "覆盖旧的窗口关闭监听");
        }
        let handler_id = window.listen("tauri://close-requested", move |_event| {
            std::mem::drop(AsyncHandler::spawn(|| async {
                setup_light_weight_timer().await;
            }));
            logging!(info, Type::Lightweight, "监听到关闭请求，开始轻量模式计时");
        });
        WINDOW_CLOSE_HANDLER_ID.store(handler_id, Ordering::Release);
    }
}

fn cancel_window_close_listener() {
    let id = WINDOW_CLOSE_HANDLER_ID.swap(0, Ordering::AcqRel);
    if id != 0 {
        if let Some(window) = WindowManager::get_main_window() {
            window.unlisten(id);
        }
        logging!(debug, Type::Lightweight, "取消了窗口关闭监听");
    }
}

fn setup_webview_focus_listener() {
    if let Some(window) = WindowManager::get_main_window() {
        let previous_handler_id = WEBVIEW_FOCUS_HANDLER_ID.swap(0, Ordering::AcqRel);
        if previous_handler_id != 0 {
            window.unlisten(previous_handler_id);
            logging!(debug, Type::Lightweight, "覆盖旧的窗口焦点监听");
        }
        let handler_id = window.listen("tauri://focus", move |_event| {
            cancel_light_weight_timer();
            logging!(debug, Type::Lightweight, "监听到窗口获得焦点，取消轻量模式计时");
        });
        WEBVIEW_FOCUS_HANDLER_ID.store(handler_id, Ordering::Release);
    }
}

fn cancel_webview_focus_listener() {
    let id = WEBVIEW_FOCUS_HANDLER_ID.swap(0, Ordering::AcqRel);
    if id != 0 {
        if let Some(window) = WindowManager::get_main_window() {
            window.unlisten(id);
        }
        logging!(debug, Type::Lightweight, "取消了窗口焦点监听");
    }
}

async fn setup_light_weight_timer() {
    let once_by_minutes = Config::verge().await.data_arc().auto_light_weight_minutes.unwrap_or(10);

    let mut cancel_tx_guard = CANCEL_TX.lock();
    if cancel_tx_guard.is_some() {
        logging!(
            debug,
            Type::Timer,
            "Lightweight mode timer already exists, skipping setup"
        );
        return;
    }

    let (tx, rx) = oneshot::channel::<()>();
    *cancel_tx_guard = Some(tx);
    drop(cancel_tx_guard);

    AsyncHandler::spawn(move || async move {
        tokio::select! {
            _ = sleep(Duration::from_secs(once_by_minutes.saturating_mul(60))) => {
                logging!(info, Type::Timer, "Lightweight mode timer expired, entering lightweight mode");
                {
                    let mut guard = CANCEL_TX.lock();
                    *guard = None;
                }
                entry_lightweight_mode().await;
            }
            _ = rx => {
                logging!(debug, Type::Timer, "Received cancel signal, stopping lightweight mode timer");
            }
        }
    });

    logging!(
        info,
        Type::Timer,
        "Lightweight mode timer set, entering lightweight mode in {} minutes",
        once_by_minutes
    );
}

fn cancel_light_weight_timer() {
    let mut cancel_tx_guard = CANCEL_TX.lock();
    if let Some(tx) = cancel_tx_guard.take() {
        let _ = tx.send(());
        logging!(debug, Type::Timer, "Timer cancelled");
    }
}
