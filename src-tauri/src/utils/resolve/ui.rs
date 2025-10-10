use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::Notify;

use crate::{logging, utils::logging::Type};

// 使用 AtomicBool 替代 RwLock<bool>，性能更好且无锁
static UI_READY: OnceCell<AtomicBool> = OnceCell::new();
// 获取UI就绪状态细节
static UI_READY_STATE: OnceCell<UiReadyState> = OnceCell::new();
// 添加通知机制，用于事件驱动的 UI 就绪检测
static UI_READY_NOTIFY: OnceCell<Arc<Notify>> = OnceCell::new();

// UI就绪阶段状态枚举
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UiReadyStage {
    NotStarted,
    Loading,
    DomReady,
    ResourcesLoaded,
    Ready,
}

// UI就绪详细状态
#[derive(Debug)]
struct UiReadyState {
    stage: RwLock<UiReadyStage>,
}

impl Default for UiReadyState {
    fn default() -> Self {
        Self {
            stage: RwLock::new(UiReadyStage::NotStarted),
        }
    }
}

pub(super) fn get_ui_ready() -> &'static AtomicBool {
    UI_READY.get_or_init(|| AtomicBool::new(false))
}

fn get_ui_ready_state() -> &'static UiReadyState {
    UI_READY_STATE.get_or_init(UiReadyState::default)
}

fn get_ui_ready_notify() -> &'static Arc<Notify> {
    UI_READY_NOTIFY.get_or_init(|| Arc::new(Notify::new()))
}

// 更新UI准备阶段
pub fn update_ui_ready_stage(stage: UiReadyStage) {
    let state = get_ui_ready_state();
    let mut stage_lock = state.stage.write();

    *stage_lock = stage;
    // 如果是最终阶段，标记UI完全就绪
    if stage == UiReadyStage::Ready {
        mark_ui_ready();
    }
}

// 标记UI已准备就绪
pub fn mark_ui_ready() {
    get_ui_ready().store(true, Ordering::Release);
    logging!(info, Type::Window, "UI已标记为完全就绪");

    // 通知所有等待的任务
    get_ui_ready_notify().notify_waiters();
}
