//! Session pooling for the local TunnelMesh forwarders.
//!
//! The pool deliberately keeps connection establishment behind a trait.  This
//! lets the lifecycle manager own WebSocket authentication/reconnect policy
//! while proxy listeners only ask for a stream for a particular agent.

use super::session::{SessionError, StreamRequest, TunnelMeshSession, TunnelMeshStream};
use async_trait::async_trait;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

/// Creates a ready session for an agent. Implementations should not retain
/// credentials beyond the connection handshake.
#[async_trait]
pub trait TunnelMeshSessionConnector: Send + Sync {
    async fn connect(&self, agent_id: &str, cancel: &CancellationToken)
    -> Result<Arc<TunnelMeshSession>, SessionError>;
}

/// A bounded, per-agent session pool.
#[derive(Clone)]
pub struct TunnelMeshSessionPool {
    connector: Arc<dyn TunnelMeshSessionConnector>,
    sessions: Arc<RwLock<HashMap<String, Vec<Arc<TunnelMeshSession>>>>>,
    max_sessions_per_agent: usize,
    reconnect_base: Duration,
    reconnect_max: Duration,
}

impl TunnelMeshSessionPool {
    #[must_use]
    pub fn new(connector: Arc<dyn TunnelMeshSessionConnector>) -> Self {
        Self {
            connector,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            max_sessions_per_agent: 2,
            reconnect_base: Duration::from_millis(100),
            reconnect_max: Duration::from_secs(5),
        }
    }

    #[must_use]
    pub fn with_limits(mut self, max_sessions_per_agent: usize) -> Self {
        self.max_sessions_per_agent = max_sessions_per_agent.max(1);
        self
    }

    #[must_use]
    pub fn with_reconnect_backoff(mut self, base: Duration, maximum: Duration) -> Self {
        self.reconnect_base = base.max(Duration::from_millis(1));
        self.reconnect_max = maximum.max(self.reconnect_base);
        self
    }

    /// Opens a stream through a healthy session, reconnecting with bounded
    /// exponential backoff when all existing sessions are unavailable.
    pub async fn open_stream(
        &self,
        agent_id: &str,
        request: StreamRequest,
        cancel: &CancellationToken,
    ) -> Result<TunnelMeshStream, SessionError> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(SessionError::OpenRejected);
        }
        let mut delay = self.reconnect_base;
        let mut last_error = SessionError::Closed;
        for attempt in 0..=3 {
            if cancel.is_cancelled() {
                return Err(SessionError::Cancelled);
            }
            let sessions = self.sessions.read().await;
            let candidates = sessions.get(agent_id).cloned().unwrap_or_default();
            drop(sessions);
            for session in candidates {
                if let Ok(stream) = session.open_stream(request.clone(), cancel).await {
                    return Ok(stream);
                }
            }

            let session = match self.connector.connect(agent_id, cancel).await {
                Ok(session) => session,
                Err(error) => {
                    last_error = error;
                    if attempt == 3 {
                        break;
                    }
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {},
                        _ = cancel.cancelled() => return Err(SessionError::Cancelled),
                    }
                    delay = (delay * 2).min(self.reconnect_max);
                    continue;
                }
            };
            session.start();
            let stream = session.open_stream(request.clone(), cancel).await;
            if stream.is_ok() {
                let mut sessions = self.sessions.write().await;
                let entries = sessions.entry(agent_id.to_owned()).or_default();
                if entries.len() < self.max_sessions_per_agent {
                    entries.push(Arc::clone(&session));
                }
                drop(sessions);
            }
            match stream {
                Ok(stream) => return Ok(stream),
                Err(error) => {
                    let _ = session.close().await;
                    last_error = error;
                }
            }
        }
        Err(last_error)
    }

    /// Cancels and removes every pooled session.
    pub async fn close(&self) {
        let sessions = std::mem::take(&mut *self.sessions.write().await);
        for (_, entries) in sessions {
            for session in entries {
                let _ = session.close().await;
            }
        }
    }
}
