use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU8, Ordering},
};
use tokio::sync::Notify;

use clash_verge_logging::{Type, logging};

// 获取 UI 是否准备就绪的全局状态
static UI_READY: AtomicBool = AtomicBool::new(false);
// 获取UI就绪状态细节
static UI_READY_STATE: AtomicU8 = AtomicU8::new(0);
// 添加通知机制，用于事件驱动的 UI 就绪检测
static UI_READY_NOTIFY: OnceCell<Arc<Notify>> = OnceCell::new();

// UI就绪阶段状态枚举
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum UiReadyStage {
    NotStarted = 0,
    Loading,
    DomReady,
    ResourcesLoaded,
    Ready,
}

pub fn get_ui_ready() -> &'static AtomicBool {
    &UI_READY
}

fn get_ui_ready_state() -> &'static AtomicU8 {
    &UI_READY_STATE
}

fn get_ui_ready_notify() -> &'static Arc<Notify> {
    UI_READY_NOTIFY.get_or_init(|| Arc::new(Notify::new()))
}

// 更新UI准备阶段
pub fn update_ui_ready_stage(stage: UiReadyStage) {
    get_ui_ready_state().store(stage as u8, Ordering::Release);
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
