//! Application-owned TunnelMesh lifecycle boundary.
//!
//! The manager intentionally depends on a small runtime factory trait.  The
//! protocol and forwarding implementations can be plugged in later without
//! making configuration persistence depend on transport details.

use super::config::{TunnelMeshConfig, TunnelMeshConfigSnapshot};
use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelMeshRuntimeState {
    #[default]
    Stopped,
    Running,
    Failed,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct TunnelMeshStatusSnapshot {
    pub state: TunnelMeshRuntimeState,
    pub generation: u64,
    pub config: Option<TunnelMeshConfigSnapshot>,
    pub last_error: Option<String>,
}

#[async_trait]
pub trait TunnelMeshRuntime: Send + Sync {
    async fn stop(self: Box<Self>) -> Result<()>;
}

#[async_trait]
pub trait TunnelMeshRuntimeFactory: Send + Sync {
    async fn start(&self, config: &TunnelMeshConfig) -> Result<Box<dyn TunnelMeshRuntime>>;
}

#[cfg(test)]
struct NoopRuntime;

#[cfg(test)]
#[async_trait]
impl TunnelMeshRuntime for NoopRuntime {
    async fn stop(self: Box<Self>) -> Result<()> {
        Ok(())
    }
}

struct ActiveRuntime {
    runtime: Box<dyn TunnelMeshRuntime>,
    config: TunnelMeshConfig,
}

struct ManagerState {
    generation: u64,
    status: TunnelMeshRuntimeState,
    active: Option<ActiveRuntime>,
    last_error: Option<String>,
}

/// Coordinates one active TunnelMesh runtime generation.
#[derive(Clone)]
pub struct TunnelMeshManager {
    factory: Arc<dyn TunnelMeshRuntimeFactory>,
    state: Arc<Mutex<ManagerState>>,
}

impl Default for TunnelMeshManager {
    fn default() -> Self {
        Self::new(Arc::new(crate::tunnelmesh::runtime::EmbeddedRuntimeFactory))
    }
}

impl TunnelMeshManager {
    pub fn new(factory: Arc<dyn TunnelMeshRuntimeFactory>) -> Self {
        Self {
            factory,
            state: Arc::new(Mutex::new(ManagerState {
                generation: 0,
                status: TunnelMeshRuntimeState::Stopped,
                active: None,
                last_error: None,
            })),
        }
    }

    pub async fn status(&self) -> TunnelMeshStatusSnapshot {
        let state = self.state.lock().await;
        TunnelMeshStatusSnapshot {
            state: state.status,
            generation: state.generation,
            config: state.active.as_ref().map(|active| active.config.redacted_snapshot()),
            last_error: state.last_error.clone(),
        }
    }

    /// Start a candidate before retiring the old generation.
    pub async fn reload(&self, config: TunnelMeshConfig) -> Result<TunnelMeshStatusSnapshot> {
        if let Err(error) = config.validate() {
            let mut state = self.state.lock().await;
            state.status = if state.active.is_some() {
                TunnelMeshRuntimeState::Running
            } else {
                TunnelMeshRuntimeState::Failed
            };
            state.last_error = Some(error.to_string());
            drop(state);
            return Err(error);
        }

        // Starting outside the state lock allows a slow network handshake to
        // leave the currently running generation available to status readers.
        let candidate = match self.factory.start(&config).await {
            Ok(runtime) => runtime,
            Err(error) => {
                let mut state = self.state.lock().await;
                state.status = if state.active.is_some() {
                    TunnelMeshRuntimeState::Running
                } else {
                    TunnelMeshRuntimeState::Failed
                };
                state.last_error = Some(redact_error(error.to_string(), &config.client.token));
                drop(state);
                return Err(error);
            }
        };

        let old = {
            let mut state = self.state.lock().await;
            let old = state.active.take();
            state.generation = state.generation.saturating_add(1);
            state.active = Some(ActiveRuntime {
                runtime: candidate,
                config,
            });
            state.status = TunnelMeshRuntimeState::Running;
            state.last_error = None;
            old
        };

        if let Some(old) = old {
            // A failed stop must not make the newly started generation
            // disappear.  Preserve the running state and surface the error.
            let old_token = old.config.client.token.clone();
            if let Err(error) = old.runtime.stop().await {
                let mut state = self.state.lock().await;
                state.last_error = Some(redact_error(
                    format!("previous TunnelMesh runtime stop failed: {error}"),
                    &old_token,
                ));
            }
        }
        Ok(self.status().await)
    }

    pub async fn stop(&self) -> Result<TunnelMeshStatusSnapshot> {
        let old = {
            let mut state = self.state.lock().await;
            state.active.take()
        };
        if let Some(old) = old {
            let token = old.config.client.token.clone();
            if let Err(error) = old.runtime.stop().await {
                let safe = redact_error(error.to_string(), &token);
                let mut state = self.state.lock().await;
                state.status = TunnelMeshRuntimeState::Failed;
                state.last_error = Some(safe.clone());
                drop(state);
                return Err(anyhow::anyhow!(safe));
            }
        }
        let mut state = self.state.lock().await;
        state.status = TunnelMeshRuntimeState::Stopped;
        state.last_error = None;
        Ok(TunnelMeshStatusSnapshot {
            state: state.status,
            generation: state.generation,
            config: None,
            last_error: None,
        })
    }
}

fn redact_error(mut error: String, token: &str) -> String {
    if !token.is_empty() {
        error = error.replace(token, "<redacted>");
    }
    error
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used, clippy::clone_on_ref_ptr)]
mod tests {
    use super::*;
    use crate::tunnelmesh::config::{TunnelMeshClientConfig, TunnelMeshTunnelConfig};
    use anyhow::anyhow;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn valid() -> TunnelMeshConfig {
        TunnelMeshConfig {
            client: TunnelMeshClientConfig {
                server_url: "wss://server.example/ws/client".into(),
                token: "secret-token".into(),
                tunnels: vec![TunnelMeshTunnelConfig {
                    name: "internal".into(),
                    protocol: "socks5".into(),
                    listen_addr: "127.0.0.1:18081".into(),
                    agent_id: "agent-a".into(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        }
    }

    struct FailingFactory {
        fail: AtomicBool,
    }

    #[async_trait]
    impl TunnelMeshRuntimeFactory for FailingFactory {
        async fn start(&self, _config: &TunnelMeshConfig) -> Result<Box<dyn TunnelMeshRuntime>> {
            if self.fail.load(Ordering::Relaxed) {
                Err(anyhow!("candidate failed secret-token"))
            } else {
                Ok(Box::new(NoopRuntime))
            }
        }
    }

    #[tokio::test]
    async fn failed_reload_preserves_previous_generation() {
        let factory = Arc::new(FailingFactory {
            fail: AtomicBool::new(false),
        });
        let manager = TunnelMeshManager::new(factory.clone());
        manager.reload(valid()).await.unwrap();
        factory.fail.store(true, Ordering::Relaxed);
        assert!(manager.reload(valid()).await.is_err());
        let status = manager.status().await;
        assert_eq!(status.state, TunnelMeshRuntimeState::Running);
        assert_eq!(status.generation, 1);
        assert!(status.config.is_some());
        assert!(!status.last_error.unwrap().contains("secret-token"));
    }
}
