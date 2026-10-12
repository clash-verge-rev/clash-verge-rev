//! Runtime assembly for the embedded TunnelMesh client.

use super::{
    config::{TunnelMeshConfig, TunnelMeshTunnelConfig},
    forward::{ForwardAuth, ForwardConfig, ForwardHandle, HttpProxyForward, Socks5Forward},
    manager::{TunnelMeshRuntime, TunnelMeshRuntimeFactory},
    pool::{TunnelMeshSessionConnector, TunnelMeshSessionPool},
    session::{SessionError, TunnelMeshSession},
    transport::TunnelMeshTransport,
};
use anyhow::{Context as _, Result, bail};
use async_trait::async_trait;
use std::{net::SocketAddr, sync::Arc};
use tokio_util::sync::CancellationToken;

pub struct EmbeddedRuntimeFactory;

struct WebSocketConnector {
    server_url: String,
    token: String,
}

#[async_trait]
impl TunnelMeshSessionConnector for WebSocketConnector {
    async fn connect(
        &self,
        _agent_id: &str,
        cancel: &CancellationToken,
    ) -> Result<Arc<TunnelMeshSession>, SessionError> {
        let transport = tokio::select! {
            result = TunnelMeshTransport::connect(&self.server_url, &self.token) => result?,
            _ = cancel.cancelled() => return Err(SessionError::Cancelled),
        };
        let transport: Arc<dyn super::transport::FrameTransport> = Arc::new(transport);
        let session = Arc::new(TunnelMeshSession::new(transport));
        session.start();
        Ok(session)
    }
}

struct EmbeddedRuntime {
    handles: Vec<ForwardHandle>,
    pool: TunnelMeshSessionPool,
}

#[async_trait]
impl TunnelMeshRuntime for EmbeddedRuntime {
    async fn stop(mut self: Box<Self>) -> Result<()> {
        while let Some(handle) = self.handles.pop() {
            handle.shutdown().await?;
        }
        self.pool.close().await;
        Ok(())
    }
}

#[async_trait]
impl TunnelMeshRuntimeFactory for EmbeddedRuntimeFactory {
    async fn start(&self, config: &TunnelMeshConfig) -> Result<Box<dyn TunnelMeshRuntime>> {
        config.validate()?;
        let connector = Arc::new(WebSocketConnector {
            server_url: config.client.server_url.clone(),
            token: config.client.token.clone(),
        });
        let pool = TunnelMeshSessionPool::new(connector);
        let mut handles = Vec::new();

        for tunnel in &config.client.tunnels {
            let protocol = tunnel.protocol.trim().to_ascii_lowercase();
            let result = match protocol.as_str() {
                "socks5" => start_socks5(tunnel, pool.clone()).await,
                "http-proxy" => start_http_proxy(tunnel, pool.clone()).await,
                _ => continue,
            };
            match result {
                Ok(handle) => handles.push(handle),
                Err(error) => {
                    for handle in handles {
                        let _ = handle.shutdown().await;
                    }
                    return Err(error);
                }
            }
        }
        Ok(Box::new(EmbeddedRuntime { handles, pool }))
    }
}

async fn start_socks5(tunnel: &TunnelMeshTunnelConfig, pool: TunnelMeshSessionPool) -> Result<ForwardHandle> {
    let listen = parse_listen(&tunnel.listen_addr)?;
    let auth = match tunnel.auth_mode.trim() {
        "none" | "" => ForwardAuth::None,
        "password" => ForwardAuth::Password {
            username: required_env("TUNNELMESH_SOCKS5_USERNAME")?,
            password: required_env("TUNNELMESH_SOCKS5_PASSWORD")?,
        },
        other => bail!("unsupported TunnelMesh SOCKS5 auth mode {other:?}"),
    };
    Socks5Forward::new(
        ForwardConfig {
            listen,
            agent_id: tunnel.agent_id.clone(),
            allow_remote: tunnel.allow_remote,
            auth,
        },
        pool,
    )?
    .bind()
    .await
}

async fn start_http_proxy(tunnel: &TunnelMeshTunnelConfig, pool: TunnelMeshSessionPool) -> Result<ForwardHandle> {
    let listen = parse_listen(&tunnel.listen_addr)?;
    let auth = match tunnel.auth_mode.trim() {
        "none" | "" => ForwardAuth::None,
        "basic" => ForwardAuth::Basic {
            username: required_env("TUNNELMESH_HTTP_PROXY_USERNAME")?,
            password: required_env("TUNNELMESH_HTTP_PROXY_PASSWORD")?,
        },
        other => bail!("unsupported TunnelMesh HTTP proxy auth mode {other:?}"),
    };
    HttpProxyForward::new(
        ForwardConfig {
            listen,
            agent_id: tunnel.agent_id.clone(),
            allow_remote: tunnel.allow_remote,
            auth,
        },
        pool,
    )?
    .bind()
    .await
}

fn parse_listen(raw: &str) -> Result<SocketAddr> {
    raw.parse()
        .with_context(|| format!("TunnelMesh listener must be a numeric host:port address: {raw}"))
}

fn required_env(name: &str) -> Result<String> {
    let value = std::env::var(name).unwrap_or_default();
    if value.is_empty() {
        bail!("TunnelMesh authentication requires {name}");
    }
    Ok(value)
}
