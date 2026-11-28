use crate::{
    config::Config,
    core::{timer::Timer, tray::Tray},
    process::AsyncHandler,
};

use clash_verge_logging::{Type, logging};

use crate::utils::window_manager::WindowManager;
use anyhow::Result;
use parking_lot::Mutex;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use tauri::Listener as _;
use tokio::sync::mpsc;
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

struct WindowListener {
    handler_id: Option<tauri::EventId>,
    event: &'static str,
    label: &'static str,
}

impl WindowListener {
    fn setup(&mut self, on_event: impl Fn() + Send + 'static) {
        if let Some(window) = WindowManager::get_main_window() {
            if let Some(id) = self.handler_id.take() {
                window.unlisten(id);
                logging!(debug, Type::Lightweight, "覆盖旧的{}监听", self.label);
            }
            self.handler_id = Some(window.listen(self.event, move |_event| on_event()));
        }
    }

    fn cancel(&mut self) {
        if let Some(id) = self.handler_id.take() {
            if let Some(window) = WindowManager::get_main_window() {
                window.unlisten(id);
            }
            logging!(debug, Type::Lightweight, "取消了{}监听", self.label);
        }
    }
}

struct WindowListeners {
    close: WindowListener,
    focus: WindowListener,
}

static WINDOW_LISTENERS: Mutex<WindowListeners> = Mutex::new(WindowListeners {
    close: WindowListener {
        handler_id: None,
        event: "tauri://close-requested",
        label: "窗口关闭",
    },
    focus: WindowListener {
        handler_id: None,
        event: "tauri://focus",
        label: "窗口焦点",
    },
});

enum TimerCommand {
    Arm(u64),
    Disarm,
}

static TIMER_GENERATION: AtomicU64 = AtomicU64::new(0);

static TIMER_COMMANDS: LazyLock<mpsc::UnboundedSender<TimerCommand>> = LazyLock::new(|| {
    let (sender, receiver) = mpsc::unbounded_channel();
    AsyncHandler::spawn(move || run_light_weight_timer(receiver));
    sender
});

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
    let generation = TIMER_GENERATION.load(Ordering::Acquire);
    let verge_config = Config::verge().await;
    let is_enable_auto = verge_config.data_arc().enable_auto_light_weight_mode.unwrap_or(false);
    let is_silent_start = verge_config.data_arc().enable_silent_start.unwrap_or(false);
    if is_enable_auto && verge_config.latest_arc().enable_auto_light_weight_mode.unwrap_or(false) {
        enable_auto_light_weight_mode_at(generation).await;
    }
    if is_silent_start {
        entry_lightweight_mode().await;
    }
    Ok(())
}

pub async fn enable_auto_light_weight_mode() {
    enable_auto_light_weight_mode_at(TIMER_GENERATION.load(Ordering::Acquire)).await;
}

async fn enable_auto_light_weight_mode_at(generation: u64) {
    if let Err(e) = Timer::global().init().await {
        logging!(error, Type::Lightweight, "Failed to initialize timer: {e}");
        return;
    }
    logging!(info, Type::Lightweight, "开启自动轻量模式");
    setup_auto_light_weight_listeners(generation);
}

pub fn disable_auto_light_weight_mode() {
    logging!(info, Type::Lightweight, "关闭自动轻量模式");
    TIMER_GENERATION.fetch_add(1, Ordering::AcqRel);
    cancel_light_weight_timer();
    let mut listeners = WINDOW_LISTENERS.lock();
    listeners.close.cancel();
    listeners.focus.cancel();
}

pub async fn entry_lightweight_mode() -> bool {
    let entered = begin_lightweight_mode();
    if entered {
        cancel_light_weight_timer();
    }
    refresh_lightweight_tray_state().await;
    entered
}

fn begin_lightweight_mode() -> bool {
    if !try_transition(LightweightState::Normal, LightweightState::In) {
        logging!(debug, Type::Lightweight, "无需进入轻量模式，跳过调用");
        return false;
    }
    record_state_and_log(LightweightState::In);
    WindowManager::destroy_main_window();
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
    let generation = TIMER_GENERATION.load(Ordering::Acquire);
    if auto_light_weight_is_enabled().await {
        setup_auto_light_weight_listeners(generation);
    }
    cancel_light_weight_timer();
    record_state_and_log(LightweightState::Normal);
    refresh_lightweight_tray_state().await;
    true
}

#[cfg(target_os = "macos")]
pub async fn add_light_weight_timer() {
    let generation = TIMER_GENERATION.load(Ordering::Acquire);
    if auto_light_weight_is_enabled().await {
        let _ = TIMER_COMMANDS.send(TimerCommand::Arm(generation));
    }
}

async fn auto_light_weight_is_enabled() -> bool {
    let verge = Config::verge().await;
    // A disable applies before persistence. A rollback restores eligibility for future hides.
    verge.data_arc().enable_auto_light_weight_mode.unwrap_or(false)
        && verge.latest_arc().enable_auto_light_weight_mode.unwrap_or(false)
}

fn setup_auto_light_weight_listeners(generation: u64) {
    let mut listeners = WINDOW_LISTENERS.lock();
    if generation != TIMER_GENERATION.load(Ordering::Acquire) {
        return;
    }
    listeners.close.setup(move || {
        let _ = TIMER_COMMANDS.send(TimerCommand::Arm(generation));
        logging!(info, Type::Lightweight, "监听到关闭请求，开始轻量模式计时");
    });
    listeners.focus.setup(move || {
        if generation == TIMER_GENERATION.load(Ordering::Acquire) {
            cancel_light_weight_timer();
            logging!(debug, Type::Lightweight, "监听到窗口获得焦点，取消轻量模式计时");
        }
    });
}

async fn run_light_weight_timer(mut commands: mpsc::UnboundedReceiver<TimerCommand>) {
    while let Some(command) = commands.recv().await {
        let TimerCommand::Arm(generation) = command else {
            continue;
        };
        // Unlisten can be deferred while Tauri is delivering an event.
        if generation != TIMER_GENERATION.load(Ordering::Acquire) {
            continue;
        }

        let countdown = wait_for_light_weight_timeout();
        tokio::pin!(countdown);
        loop {
            tokio::select! {
                biased;
                command = commands.recv() => match command {
                    Some(TimerCommand::Arm(_)) => {}
                    Some(TimerCommand::Disarm) => break,
                    None => return,
                },
                () = &mut countdown => {
                    if generation == TIMER_GENERATION.load(Ordering::Acquire) {
                        logging!(info, Type::Timer, "Lightweight mode timer expired, entering lightweight mode");
                        begin_lightweight_mode();
                        AsyncHandler::spawn(refresh_lightweight_tray_state);
                    }
                    break;
                }
            }
        }
    }
}

async fn wait_for_light_weight_timeout() {
    let once_by_minutes = Config::verge().await.data_arc().auto_light_weight_minutes.unwrap_or(10);
    logging!(
        info,
        Type::Timer,
        "Lightweight mode timer set, entering lightweight mode in {} minutes",
        once_by_minutes
    );
    sleep(Duration::from_secs(once_by_minutes.saturating_mul(60))).await;
}

fn cancel_light_weight_timer() {
    let _ = TIMER_COMMANDS.send(TimerCommand::Disarm);
}
