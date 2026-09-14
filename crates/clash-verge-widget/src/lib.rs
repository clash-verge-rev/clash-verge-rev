use serde::{Deserialize, Serialize};
use std::future::Future;

#[cfg(target_os = "macos")]
mod server;
#[cfg(target_os = "macos")]
pub use server::{reload, start};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Rule,
    Global,
    Direct,
}

impl Mode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Rule => "rule",
            Self::Global => "global",
            Self::Direct => "direct",
        }
    }
}

#[derive(Clone, Copy)]
pub enum Action {
    Mode(Mode),
    Tun(bool),
    Proxy(bool),
}

#[derive(Default, Serialize)]
pub struct Status {
    pub mode: Option<Mode>,
    pub tun: Option<bool>,
    pub proxy: Option<bool>,
    pub error: Option<String>,
    pub language: String,
}

impl Status {
    pub fn confirms(&self, action: Action) -> bool {
        match action {
            Action::Mode(value) => self.mode == Some(value),
            Action::Tun(value) => self.tun == Some(value),
            Action::Proxy(value) => self.proxy == Some(value),
        }
    }
}

pub trait Backend: Send + Sync + 'static {
    fn snapshot(&self) -> impl Future<Output = Status> + Send;
    fn language(&self) -> impl Future<Output = String> + Send;
    fn apply(&self, action: Action) -> impl Future<Output = Result<(), String>> + Send;
}
