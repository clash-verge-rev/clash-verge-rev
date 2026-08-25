use async_trait::async_trait;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fmt;
use tauri_plugin_mihomo::{
    Mihomo,
    models::{Connection, ConnectionType, Connections, Network, Proxy},
};
use tokio::sync::Mutex;

static REDIAL_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatefulProxyRedialRequest {
    pub group_name: String,
    pub expected_current_proxy: String,
    pub target_proxy: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatefulProxyRedialReport {
    pub group_name: String,
    pub previous_proxy: String,
    pub target_proxy: String,
    pub closed_underlay_connections: usize,
}

/// Restores a selector after a failed validation. If the failed route never
/// established an underlay there is nothing to close; otherwise the normal
/// exact-identity redial path is used. Ambiguous underlays always fail closed.
async fn restore_with<C: StatefulProxyController>(
    controller: &C,
    request: &StatefulProxyRedialRequest,
) -> Result<StatefulProxyRedialReport, StatefulProxyRedialError> {
    let group = controller
        .group(&request.group_name)
        .await
        .map_err(|error| controller_error("read selector", error))?;
    if group.now.as_deref() != Some(request.expected_current_proxy.as_str()) {
        return Err(StatefulProxyRedialError::GroupStateMismatch {
            expected: request.expected_current_proxy.clone(),
            actual: group.now,
        });
    }
    if !group
        .all
        .as_deref()
        .unwrap_or_default()
        .iter()
        .any(|proxy| proxy == &request.target_proxy)
    {
        return Err(StatefulProxyRedialError::TargetNotInGroup(request.target_proxy.clone()));
    }

    let connections = controller
        .connections()
        .await
        .map_err(|error| controller_error("read connections", error))?;
    let matches = matching_underlays(
        connections.connections.as_deref().unwrap_or_default(),
        &request.group_name,
        &request.expected_current_proxy,
    );
    match matches.len() {
        0 => {
            controller
                .select(&request.group_name, &request.target_proxy)
                .await
                .map_err(|error| controller_error("restore selector", error))?;
            let selected = controller
                .group(&request.group_name)
                .await
                .map_err(|error| controller_error("verify restored selector", error))?;
            if selected.now.as_deref() != Some(request.target_proxy.as_str()) {
                return Err(StatefulProxyRedialError::SelectionNotApplied {
                    expected: request.target_proxy.clone(),
                    actual: selected.now,
                });
            }
            Ok(StatefulProxyRedialReport {
                group_name: request.group_name.clone(),
                previous_proxy: request.expected_current_proxy.clone(),
                target_proxy: request.target_proxy.clone(),
                closed_underlay_connections: 0,
            })
        }
        1 => redial_with(controller, request).await,
        count => Err(StatefulProxyRedialError::UnderlayNotUnique {
            phase: MatchPhase::BeforeSelection,
            count,
        }),
    }
}

pub async fn restore_stateful_proxy_underlay(
    controller: &Mihomo,
    request: &StatefulProxyRedialRequest,
) -> Result<StatefulProxyRedialReport, StatefulProxyRedialError> {
    let _guard = REDIAL_LOCK.lock().await;
    restore_with(controller, request).await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MatchPhase {
    BeforeSelection,
    BeforeClose,
}

impl fmt::Display for MatchPhase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BeforeSelection => f.write_str("before selector change"),
            Self::BeforeClose => f.write_str("before closing the underlay"),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum StatefulProxyRedialError {
    InvalidRequest(&'static str),
    Controller { operation: &'static str, detail: String },
    GroupStateMismatch { expected: String, actual: Option<String> },
    TargetNotInGroup(String),
    UnderlayNotUnique { phase: MatchPhase, count: usize },
    UnderlayChanged,
    SelectionNotApplied { expected: String, actual: Option<String> },
    CloseNotConfirmed,
    RollbackFailed { operation: &'static str, detail: String },
}

impl StatefulProxyRedialError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "STATEFUL_REDIAL_INVALID_REQUEST",
            Self::Controller { .. } => "STATEFUL_REDIAL_CONTROLLER_FAILED",
            Self::GroupStateMismatch { .. } => "STATEFUL_REDIAL_GROUP_STATE_MISMATCH",
            Self::TargetNotInGroup(_) => "STATEFUL_REDIAL_TARGET_NOT_IN_GROUP",
            Self::UnderlayNotUnique { .. } => "STATEFUL_REDIAL_UNDERLAY_NOT_UNIQUE",
            Self::UnderlayChanged => "STATEFUL_REDIAL_UNDERLAY_CHANGED",
            Self::SelectionNotApplied { .. } => "STATEFUL_REDIAL_SELECTION_NOT_APPLIED",
            Self::CloseNotConfirmed => "STATEFUL_REDIAL_CLOSE_NOT_CONFIRMED",
            Self::RollbackFailed { .. } => "STATEFUL_REDIAL_ROLLBACK_FAILED",
        }
    }
}

impl fmt::Display for StatefulProxyRedialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(detail) => f.write_str(detail),
            Self::Controller { operation, detail } => write!(f, "{operation} failed: {detail}"),
            Self::GroupStateMismatch { expected, actual } => write!(
                f,
                "selector state changed before redial: expected {expected:?}, got {actual:?}"
            ),
            Self::TargetNotInGroup(target) => write!(f, "target proxy {target:?} is not a member of the selector"),
            Self::UnderlayNotUnique { phase, count } => write!(
                f,
                "expected exactly one matching Inner UDP underlay {phase}, found {count}"
            ),
            Self::UnderlayChanged => f.write_str("matching underlay changed while the selector was being updated"),
            Self::SelectionNotApplied { expected, actual } => write!(
                f,
                "selector update was not applied: expected {expected:?}, got {actual:?}"
            ),
            Self::CloseNotConfirmed => {
                f.write_str("the selected underlay still exists after close returned successfully")
            }
            Self::RollbackFailed { operation, detail } => {
                write!(f, "{operation} failed and the selector rollback also failed: {detail}")
            }
        }
    }
}

impl std::error::Error for StatefulProxyRedialError {}

fn matching_underlays<'a>(connections: &'a [Connection], group_name: &str, current_proxy: &str) -> Vec<&'a Connection> {
    connections
        .iter()
        .filter(|connection| {
            connection.metadata.connection_type.as_str() == ConnectionType::INNER.as_str()
                && connection.metadata.network.as_str() == Network::UDP.as_str()
                && connection.chains.iter().any(|chain| chain == group_name)
                && connection.chains.iter().any(|chain| chain == current_proxy)
        })
        .collect()
}

fn unique_underlay_id(
    connections: &[Connection],
    group_name: &str,
    current_proxy: &str,
    phase: MatchPhase,
) -> Result<String, StatefulProxyRedialError> {
    let matches = matching_underlays(connections, group_name, current_proxy);
    if matches.len() != 1 {
        return Err(StatefulProxyRedialError::UnderlayNotUnique {
            phase,
            count: matches.len(),
        });
    }
    Ok(matches[0].id.clone())
}

#[async_trait]
trait StatefulProxyController: Send + Sync {
    async fn group(&self, group_name: &str) -> anyhow::Result<Proxy>;
    async fn connections(&self) -> anyhow::Result<Connections>;
    async fn select(&self, group_name: &str, proxy_name: &str) -> anyhow::Result<()>;
    async fn close(&self, connection_id: &str) -> anyhow::Result<()>;
}

#[async_trait]
impl StatefulProxyController for Mihomo {
    async fn group(&self, group_name: &str) -> anyhow::Result<Proxy> {
        self.get_group_by_name(group_name).await.map_err(Into::into)
    }

    async fn connections(&self) -> anyhow::Result<Connections> {
        self.get_connections().await.map_err(Into::into)
    }

    async fn select(&self, group_name: &str, proxy_name: &str) -> anyhow::Result<()> {
        self.select_node_for_group(group_name, proxy_name)
            .await
            .map_err(Into::into)
    }

    async fn close(&self, connection_id: &str) -> anyhow::Result<()> {
        self.close_connection(connection_id).await.map_err(Into::into)
    }
}

fn controller_error(operation: &'static str, error: impl fmt::Display) -> StatefulProxyRedialError {
    StatefulProxyRedialError::Controller {
        operation,
        detail: error.to_string(),
    }
}

async fn rollback_selector<C: StatefulProxyController>(
    controller: &C,
    request: &StatefulProxyRedialRequest,
    operation: &'static str,
    source: impl fmt::Display,
) -> StatefulProxyRedialError {
    match controller
        .select(&request.group_name, &request.expected_current_proxy)
        .await
    {
        Ok(()) => controller_error(operation, source),
        Err(rollback) => StatefulProxyRedialError::RollbackFailed {
            operation,
            detail: format!("{source}; rollback error: {rollback}"),
        },
    }
}

async fn redial_with<C: StatefulProxyController>(
    controller: &C,
    request: &StatefulProxyRedialRequest,
) -> Result<StatefulProxyRedialReport, StatefulProxyRedialError> {
    if request.group_name.trim().is_empty() {
        return Err(StatefulProxyRedialError::InvalidRequest("groupName must not be empty"));
    }
    if request.expected_current_proxy.trim().is_empty() || request.target_proxy.trim().is_empty() {
        return Err(StatefulProxyRedialError::InvalidRequest(
            "expectedCurrentProxy and targetProxy must not be empty",
        ));
    }
    if request.expected_current_proxy == request.target_proxy {
        return Err(StatefulProxyRedialError::InvalidRequest(
            "targetProxy must differ from expectedCurrentProxy",
        ));
    }

    let group = controller
        .group(&request.group_name)
        .await
        .map_err(|error| controller_error("read selector", error))?;
    if group.now.as_deref() != Some(request.expected_current_proxy.as_str()) {
        return Err(StatefulProxyRedialError::GroupStateMismatch {
            expected: request.expected_current_proxy.clone(),
            actual: group.now,
        });
    }
    if !group
        .all
        .as_deref()
        .unwrap_or_default()
        .iter()
        .any(|proxy| proxy == &request.target_proxy)
    {
        return Err(StatefulProxyRedialError::TargetNotInGroup(request.target_proxy.clone()));
    }

    let before = controller
        .connections()
        .await
        .map_err(|error| controller_error("read connections", error))?;
    let before_id = unique_underlay_id(
        before.connections.as_deref().unwrap_or_default(),
        &request.group_name,
        &request.expected_current_proxy,
        MatchPhase::BeforeSelection,
    )?;

    controller
        .select(&request.group_name, &request.target_proxy)
        .await
        .map_err(|error| controller_error("update selector", error))?;

    let selected = match controller.group(&request.group_name).await {
        Ok(group) => group,
        Err(error) => {
            return Err(rollback_selector(controller, request, "verify selector", error).await);
        }
    };
    if selected.now.as_deref() != Some(request.target_proxy.as_str()) {
        let error = StatefulProxyRedialError::SelectionNotApplied {
            expected: request.target_proxy.clone(),
            actual: selected.now,
        };
        return Err(rollback_selector(controller, request, "verify selector", error).await);
    }

    let after_selection = match controller.connections().await {
        Ok(connections) => connections,
        Err(error) => {
            return Err(rollback_selector(controller, request, "re-read connections", error).await);
        }
    };
    let after_id = match unique_underlay_id(
        after_selection.connections.as_deref().unwrap_or_default(),
        &request.group_name,
        &request.expected_current_proxy,
        MatchPhase::BeforeClose,
    ) {
        Ok(id) => id,
        Err(error) => return Err(rollback_selector(controller, request, "identify underlay", error).await),
    };
    if before_id != after_id {
        return Err(rollback_selector(
            controller,
            request,
            "verify underlay identity",
            StatefulProxyRedialError::UnderlayChanged,
        )
        .await);
    }

    if let Err(error) = controller.close(&before_id).await {
        return Err(rollback_selector(controller, request, "close underlay", error).await);
    }

    let after_close = controller
        .connections()
        .await
        .map_err(|error| controller_error("confirm underlay close", error))?;
    if after_close
        .connections
        .as_deref()
        .unwrap_or_default()
        .iter()
        .any(|connection| connection.id == before_id)
    {
        return Err(StatefulProxyRedialError::CloseNotConfirmed);
    }

    Ok(StatefulProxyRedialReport {
        group_name: request.group_name.clone(),
        previous_proxy: request.expected_current_proxy.clone(),
        target_proxy: request.target_proxy.clone(),
        closed_underlay_connections: 1,
    })
}

pub async fn redial_stateful_proxy_underlay(
    controller: &Mihomo,
    request: &StatefulProxyRedialRequest,
) -> Result<StatefulProxyRedialReport, StatefulProxyRedialError> {
    let _guard = REDIAL_LOCK.lock().await;
    redial_with(controller, request).await
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex as StdMutex},
    };

    fn connection(id: &str, connection_type: &str, network: &str, chains: &[&str]) -> Connection {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "metadata": { "type": connection_type, "network": network },
            "chains": chains
        }))
        .expect("valid connection fixture")
    }

    #[derive(Clone)]
    struct MockController {
        current: Arc<StdMutex<String>>,
        members: Arc<Vec<String>>,
        connection_snapshots: Arc<StdMutex<VecDeque<Vec<Connection>>>>,
        selections: Arc<StdMutex<Vec<String>>>,
        closes: Arc<StdMutex<Vec<String>>>,
        close_fails: bool,
    }

    impl MockController {
        fn new(snapshots: Vec<Vec<Connection>>) -> Self {
            Self {
                current: Arc::new(StdMutex::new("DIRECT".to_owned())),
                members: Arc::new(vec!["DIRECT".to_owned(), "Proxy A".to_owned()]),
                connection_snapshots: Arc::new(StdMutex::new(snapshots.into())),
                selections: Arc::default(),
                closes: Arc::default(),
                close_fails: false,
            }
        }

        fn selections(&self) -> Vec<String> {
            self.selections.lock().expect("selections lock").clone()
        }

        fn closes(&self) -> Vec<String> {
            self.closes.lock().expect("closes lock").clone()
        }
    }

    #[async_trait]
    impl StatefulProxyController for MockController {
        async fn group(&self, group_name: &str) -> anyhow::Result<Proxy> {
            Ok(Proxy {
                name: group_name.to_owned(),
                now: Some(self.current.lock().expect("current lock").clone()),
                all: Some(self.members.as_ref().clone()),
                ..Proxy::default()
            })
        }

        async fn connections(&self) -> anyhow::Result<Connections> {
            let connections = self
                .connection_snapshots
                .lock()
                .expect("snapshots lock")
                .pop_front()
                .unwrap_or_default();
            Ok(Connections {
                connections: Some(connections),
                ..Connections::default()
            })
        }

        async fn select(&self, _group_name: &str, proxy_name: &str) -> anyhow::Result<()> {
            self.selections
                .lock()
                .expect("selections lock")
                .push(proxy_name.to_owned());
            *self.current.lock().expect("current lock") = proxy_name.to_owned();
            Ok(())
        }

        async fn close(&self, connection_id: &str) -> anyhow::Result<()> {
            self.closes.lock().expect("closes lock").push(connection_id.to_owned());
            if self.close_fails {
                anyhow::bail!("injected close failure");
            }
            Ok(())
        }
    }

    fn request() -> StatefulProxyRedialRequest {
        StatefulProxyRedialRequest {
            group_name: "WG-UPSTREAM".to_owned(),
            expected_current_proxy: "DIRECT".to_owned(),
            target_proxy: "Proxy A".to_owned(),
        }
    }

    #[test]
    fn matches_only_the_inner_udp_underlay_for_the_named_group_and_upstream() {
        let connections = vec![
            connection("wanted", "Inner", "udp", &["DIRECT", "WG-UPSTREAM"]),
            connection("outer", "HTTP", "tcp", &["WG-EXIT"]),
            connection("other-group", "Inner", "udp", &["DIRECT", "OTHER"]),
            connection("other-upstream", "Inner", "udp", &["Proxy A", "WG-UPSTREAM"]),
        ];

        let matches = matching_underlays(&connections, "WG-UPSTREAM", "DIRECT");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, "wanted");
    }

    #[test]
    fn refuses_ambiguous_underlays() {
        let connections = vec![
            connection("first", "Inner", "udp", &["DIRECT", "WG-UPSTREAM"]),
            connection("second", "Inner", "udp", &["DIRECT", "WG-UPSTREAM"]),
        ];

        let error = unique_underlay_id(&connections, "WG-UPSTREAM", "DIRECT", MatchPhase::BeforeSelection)
            .expect_err("ambiguous matches must fail closed");
        assert_eq!(
            error,
            StatefulProxyRedialError::UnderlayNotUnique {
                phase: MatchPhase::BeforeSelection,
                count: 2
            }
        );
    }

    #[tokio::test]
    async fn selects_then_closes_only_the_stable_unique_underlay() {
        let underlay = || connection("underlay", "Inner", "udp", &["DIRECT", "WG-UPSTREAM"]);
        let controller = MockController::new(vec![vec![underlay()], vec![underlay()], vec![]]);

        let report = redial_with(&controller, &request()).await.expect("redial succeeds");

        assert_eq!(report.closed_underlay_connections, 1);
        assert_eq!(controller.selections(), ["Proxy A"]);
        assert_eq!(controller.closes(), ["underlay"]);
    }

    #[tokio::test]
    async fn rolls_selector_back_if_the_underlay_changes_during_selection() {
        let controller = MockController::new(vec![
            vec![connection(
                "underlay-before",
                "Inner",
                "udp",
                &["DIRECT", "WG-UPSTREAM"],
            )],
            vec![connection("underlay-after", "Inner", "udp", &["DIRECT", "WG-UPSTREAM"])],
        ]);

        let error = redial_with(&controller, &request())
            .await
            .expect_err("racing underlay must fail closed");

        assert!(matches!(
            error,
            StatefulProxyRedialError::Controller {
                operation: "verify underlay identity",
                ..
            }
        ));
        assert_eq!(controller.selections(), ["Proxy A", "DIRECT"]);
        assert!(controller.closes().is_empty());
    }

    #[tokio::test]
    async fn rolls_selector_back_if_closing_the_underlay_fails() {
        let underlay = || connection("underlay", "Inner", "udp", &["DIRECT", "WG-UPSTREAM"]);
        let mut controller = MockController::new(vec![vec![underlay()], vec![underlay()]]);
        controller.close_fails = true;

        let error = redial_with(&controller, &request())
            .await
            .expect_err("close failure must be reported");

        assert!(matches!(
            error,
            StatefulProxyRedialError::Controller {
                operation: "close underlay",
                ..
            }
        ));
        assert_eq!(controller.selections(), ["Proxy A", "DIRECT"]);
        assert_eq!(controller.closes(), ["underlay"]);
    }

    #[tokio::test]
    async fn restores_an_idle_failed_route_without_closing_anything() {
        let controller = MockController::new(vec![vec![]]);
        *controller.current.lock().expect("current lock") = "Proxy A".to_owned();
        let request = StatefulProxyRedialRequest {
            group_name: "WG-UPSTREAM".to_owned(),
            expected_current_proxy: "Proxy A".to_owned(),
            target_proxy: "DIRECT".to_owned(),
        };

        let report = restore_with(&controller, &request)
            .await
            .expect("idle restore succeeds");

        assert_eq!(report.closed_underlay_connections, 0);
        assert_eq!(controller.selections(), ["DIRECT"]);
        assert!(controller.closes().is_empty());
    }

    #[tokio::test]
    async fn refuses_to_restore_an_ambiguous_failed_route() {
        let backup_underlay = || connection("backup-underlay", "Inner", "udp", &["Proxy A", "WG-UPSTREAM"]);
        let controller = MockController::new(vec![vec![backup_underlay(), backup_underlay()]]);
        *controller.current.lock().expect("current lock") = "Proxy A".to_owned();
        let request = StatefulProxyRedialRequest {
            group_name: "WG-UPSTREAM".to_owned(),
            expected_current_proxy: "Proxy A".to_owned(),
            target_proxy: "DIRECT".to_owned(),
        };

        let error = restore_with(&controller, &request)
            .await
            .expect_err("ambiguous restore must fail closed");

        assert!(matches!(
            error,
            StatefulProxyRedialError::UnderlayNotUnique { count: 2, .. }
        ));
        assert!(controller.selections().is_empty());
        assert!(controller.closes().is_empty());
    }
}
