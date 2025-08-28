use once_cell::sync::OnceCell;
use parking_lot::RwLock;

use crate::{logging, utils::logging::Type};

// 添加全局UI准备就绪标志
static UI_READY: OnceCell<RwLock<bool>> = OnceCell::new();
// 获取UI就绪状态细节
static UI_READY_STATE: OnceCell<UiReadyState> = OnceCell::new();

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

pub(super) fn get_ui_ready() -> &'static RwLock<bool> {
    UI_READY.get_or_init(|| RwLock::new(false))
}

fn get_ui_ready_state() -> &'static UiReadyState {
    UI_READY_STATE.get_or_init(UiReadyState::default)
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
    let mut ready = get_ui_ready().write();
    *ready = true;
    logging!(info, Type::Window, true, "UI已标记为完全就绪");
}

// 重置UI就绪状态
pub fn reset_ui_ready() {
    {
        let mut ready = get_ui_ready().write();
        *ready = false;
    }
    {
        let state = get_ui_ready_state();
        let mut stage = state.stage.write();
        *stage = UiReadyStage::NotStarted;
    }
    logging!(info, Type::Window, true, "UI就绪状态已重置");
}
