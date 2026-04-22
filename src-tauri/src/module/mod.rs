pub mod auto_backup;
pub mod lightweight;
// 0.2 commit 仅把 netmon 纳入 crate 树（fingerprint / service / pusher 单测可跑）；
// 真正的生命周期接线（`netmon::start()`、shutdown 钩子、lifecycle CoreReady 等）归 0.2h commit。
#[allow(dead_code)]
pub(crate) mod netmon;
