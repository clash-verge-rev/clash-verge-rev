use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use tauri_plugin_mihomo::models::{
    DelayHistory, Proxies, Proxy, ProxyProvider, ProxyProviders, ProxyType, VehicleType,
};

pub struct ProxyViewInput {
    pub runtime_group_order: Vec<String>,
    pub group_scopes: BTreeMap<String, GroupScope>,
    pub proxies: Proxies,
    pub providers: Option<ProxyProviders>,
}

/// The providers a group draws from (Mihomo order) and its `exclude-type` entries.
pub struct GroupScope {
    pub providers: Vec<String>,
    pub exclude_types: Vec<String>,
}

pub struct ProxyViewBuilder;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyViewV1 {
    pub schema_version: u8,
    pub order_source: ProxyViewOrderSource,
    pub provider_state: ProxyViewProviderState,
    pub global: Option<ProxyGroupView>,
    pub direct: Option<String>,
    pub groups: Vec<ProxyGroupView>,
    pub records: BTreeMap<String, ProxyNodeView>,
    pub standalone: Vec<String>,
    pub providers: Vec<ProxyProviderView>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyViewOrderSource {
    Runtime,
    Fallback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyViewProviderState {
    Ready,
    Unavailable,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ProxyCapabilities {
    pub udp: bool,
    pub xudp: bool,
    pub tfo: bool,
    pub mptcp: bool,
    pub smux: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyGroupView {
    pub name: String,
    #[serde(rename = "type")]
    pub proxy_type: ProxyType,
    pub alive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub now: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_url: Option<String>,
    pub history: Vec<DelayHistory>,
    #[serde(flatten)]
    pub capabilities: ProxyCapabilities,
    pub members: Vec<ProxyMemberRef>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyNodeView {
    pub record_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub proxy_type: ProxyType,
    pub alive: bool,
    pub history: Vec<DelayHistory>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_url: Option<String>,
    #[serde(flatten)]
    pub capabilities: ProxyCapabilities,
    pub source: ProxyNodeSource,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProxyNodeSource {
    Core {
        #[serde(rename = "proxyName")]
        proxy_name: String,
    },
    Provider {
        #[serde(rename = "providerName")]
        provider_name: String,
        #[serde(rename = "proxyName")]
        proxy_name: String,
    },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProxyMemberRef {
    Group {
        name: String,
    },
    Node {
        name: String,
        #[serde(rename = "recordId")]
        record_id: String,
    },
    Unresolved {
        name: String,
        reason: ProxyMemberUnresolvedReason,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum ProxyMemberUnresolvedReason {
    #[serde(rename = "missing")]
    Missing,
    #[serde(rename = "ambiguous")]
    Ambiguous,
    #[serde(rename = "provider-unavailable")]
    ProviderUnavailable,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProviderView {
    pub name: String,
    pub vehicle_type: ProxyProviderVehicleType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_info: Option<ProxySubscriptionInfo>,
    pub proxy_record_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum ProxyProviderVehicleType {
    #[serde(rename = "HTTP")]
    Http,
    #[serde(rename = "File")]
    File,
    #[serde(rename = "Inline")]
    Inline,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ProxySubscriptionInfo {
    pub upload: i64,
    pub download: i64,
    pub total: i64,
    pub expire: i64,
}

/// Proxy name -> `(provider name, record id)` in provider order.
type ProviderCandidates = BTreeMap<String, Vec<(String, String)>>;

struct MemberResolver<'a> {
    group_names: BTreeSet<String>,
    group_scopes: &'a BTreeMap<String, GroupScope>,
    records: &'a BTreeMap<String, ProxyNodeView>,
    core_node_ids: &'a BTreeMap<String, String>,
    provider_candidates: &'a ProviderCandidates,
    provider_available: bool,
}

impl<'a> MemberResolver<'a> {
    /// Same-name records in the order Mihomo lists them in `group`: `use` order, after `exclude-type`.
    fn scoped_candidates(&self, group: &str, name: &str) -> Vec<&'a String> {
        let (Some(scope), Some(candidates)) = (self.group_scopes.get(group), self.provider_candidates.get(name)) else {
            return Vec::new();
        };
        scope
            .providers
            .iter()
            .flat_map(|provider| candidates.iter().filter(move |(owner, _)| owner == provider))
            .map(|(_, record_id)| record_id)
            .filter(|record_id| {
                !self.records.get(*record_id).is_some_and(|node| {
                    scope
                        .exclude_types
                        .iter()
                        .any(|excluded| excluded.eq_ignore_ascii_case(node.proxy_type.as_str()))
                })
            })
            .collect()
    }

    fn resolve(&self, name: String, scoped: Option<&String>) -> ProxyMemberRef {
        if self.group_names.contains(&name) {
            ProxyMemberRef::Group { name }
        } else if let Some(record_id) = self.core_node_ids.get(&name) {
            ProxyMemberRef::Node {
                name,
                record_id: record_id.clone(),
            }
        } else if !self.provider_available {
            ProxyMemberRef::Unresolved {
                name,
                reason: ProxyMemberUnresolvedReason::ProviderUnavailable,
            }
        } else {
            let candidates = self.provider_candidates.get(&name).map_or(&[][..], Vec::as_slice);
            match (scoped, candidates) {
                (Some(record_id), _) | (None, [(_, record_id)]) => ProxyMemberRef::Node {
                    name,
                    record_id: record_id.clone(),
                },
                (None, []) => ProxyMemberRef::Unresolved {
                    name,
                    reason: ProxyMemberUnresolvedReason::Missing,
                },
                (None, _) => ProxyMemberRef::Unresolved {
                    name,
                    reason: ProxyMemberUnresolvedReason::Ambiguous,
                },
            }
        }
    }
}

impl ProxyViewBuilder {
    pub fn build(input: ProxyViewInput) -> ProxyViewV1 {
        let ProxyViewInput {
            runtime_group_order,
            group_scopes,
            proxies,
            providers,
        } = input;
        let provider_state = if providers.is_some() {
            ProxyViewProviderState::Ready
        } else {
            ProxyViewProviderState::Unavailable
        };
        let (mut core_groups, core_nodes) = partition_core(proxies);
        let (mut records, core_node_ids) = build_core_records(core_nodes);
        let (providers, provider_candidates) = build_provider_records(providers, &mut records);
        let resolver = MemberResolver {
            group_names: core_groups.keys().cloned().collect(),
            group_scopes: &group_scopes,
            records: &records,
            core_node_ids: &core_node_ids,
            provider_candidates: &provider_candidates,
            provider_available: provider_state == ProxyViewProviderState::Ready,
        };

        let global = core_groups
            .remove("GLOBAL")
            .map(|proxy| build_group("GLOBAL".to_owned(), proxy, &resolver));
        let (groups, order_source) = build_ordered_groups(core_groups, runtime_group_order, &resolver);
        let direct = core_node_ids.get("DIRECT").cloned();
        let standalone = build_standalone(&core_node_ids);

        ProxyViewV1 {
            schema_version: 1,
            order_source,
            provider_state,
            global,
            direct,
            groups,
            records,
            standalone,
            providers,
        }
    }
}

fn partition_core(proxies: Proxies) -> (BTreeMap<String, Proxy>, BTreeMap<String, Proxy>) {
    let mut groups = BTreeMap::new();
    let mut nodes = BTreeMap::new();

    for (name, proxy) in proxies.proxies {
        if proxy.all.is_some() {
            groups.insert(name, proxy);
        } else {
            nodes.insert(name, proxy);
        }
    }

    (groups, nodes)
}

fn build_core_records(
    core_nodes: BTreeMap<String, Proxy>,
) -> (BTreeMap<String, ProxyNodeView>, BTreeMap<String, String>) {
    let mut records = BTreeMap::new();
    let mut ids = BTreeMap::new();

    for (index, (name, proxy)) in core_nodes.into_iter().enumerate() {
        let record_id = format!("c:{index}");
        ids.insert(name.clone(), record_id.clone());
        records.insert(
            record_id.clone(),
            build_node(
                record_id,
                name.clone(),
                proxy,
                ProxyNodeSource::Core { proxy_name: name },
            ),
        );
    }

    (records, ids)
}

fn build_provider_records(
    providers: Option<ProxyProviders>,
    records: &mut BTreeMap<String, ProxyNodeView>,
) -> (Vec<ProxyProviderView>, ProviderCandidates) {
    let providers = providers
        .map(|providers| providers.providers.into_iter().collect::<BTreeMap<_, _>>())
        .unwrap_or_default();
    let mut views = Vec::new();
    let mut candidates = BTreeMap::new();

    for (provider_name, provider) in providers {
        let ProxyProvider {
            vehicle_type,
            proxies,
            updated_at,
            subscription_info,
            ..
        } = provider;
        let vehicle_type = match vehicle_type {
            VehicleType::HTTP => ProxyProviderVehicleType::Http,
            VehicleType::File => ProxyProviderVehicleType::File,
            VehicleType::Inline => ProxyProviderVehicleType::Inline,
            _ => continue,
        };
        let provider_index = views.len();
        let mut proxy_record_ids = Vec::new();

        for (member_index, proxy) in proxies.into_iter().enumerate() {
            let record_id = format!("p:{provider_index}:{member_index}");
            let proxy_name = proxy.name.clone();
            let node_name = proxy.name.clone();
            candidates
                .entry(proxy_name.clone())
                .or_insert_with(Vec::new)
                .push((provider_name.clone(), record_id.clone()));
            records.insert(
                record_id.clone(),
                build_node(
                    record_id.clone(),
                    node_name,
                    proxy,
                    ProxyNodeSource::Provider {
                        provider_name: provider_name.clone(),
                        proxy_name,
                    },
                ),
            );
            proxy_record_ids.push(record_id);
        }

        views.push(ProxyProviderView {
            name: provider_name,
            vehicle_type,
            updated_at,
            subscription_info: subscription_info.map(|subscription_info| ProxySubscriptionInfo {
                upload: subscription_info.upload,
                download: subscription_info.download,
                total: subscription_info.total,
                expire: subscription_info.expire,
            }),
            proxy_record_ids,
        });
    }

    (views, candidates)
}

fn build_group(name: String, proxy: Proxy, resolver: &MemberResolver<'_>) -> ProxyGroupView {
    let Proxy {
        all,
        fixed,
        hidden,
        icon,
        now,
        test_url,
        alive,
        history,
        udp,
        xudp,
        tfo,
        mptcp,
        smux,
        proxy_type,
        ..
    } = proxy;
    // The n-th occurrence of a name in `all` is the n-th scoped candidate.
    let mut seen = BTreeMap::<String, (usize, Vec<&String>)>::new();
    let members = all
        .unwrap_or_default()
        .into_iter()
        .map(|member| {
            let (occurrence, scoped) = seen
                .entry(member.clone())
                .or_insert_with(|| (0, resolver.scoped_candidates(&name, &member)));
            let picked = scoped.get(*occurrence).or_else(|| scoped.first()).copied();
            *occurrence += 1;
            resolver.resolve(member, picked)
        })
        .collect();

    ProxyGroupView {
        name,
        proxy_type,
        alive,
        now,
        fixed,
        hidden,
        icon,
        test_url,
        history,
        capabilities: ProxyCapabilities {
            udp,
            xudp,
            tfo,
            mptcp,
            smux,
        },
        members,
    }
}

fn build_node(record_id: String, name: String, proxy: Proxy, source: ProxyNodeSource) -> ProxyNodeView {
    let Proxy {
        id,
        hidden,
        icon,
        test_url,
        alive,
        history,
        udp,
        xudp,
        tfo,
        mptcp,
        smux,
        proxy_type,
        ..
    } = proxy;

    ProxyNodeView {
        record_id,
        name,
        proxy_type,
        alive,
        history,
        id,
        hidden,
        icon,
        test_url,
        capabilities: ProxyCapabilities {
            udp,
            xudp,
            tfo,
            mptcp,
            smux,
        },
        source,
    }
}

fn build_ordered_groups(
    mut core_groups: BTreeMap<String, Proxy>,
    runtime_group_order: Vec<String>,
    resolver: &MemberResolver<'_>,
) -> (Vec<ProxyGroupView>, ProxyViewOrderSource) {
    let mut groups = Vec::with_capacity(core_groups.len());
    for name in runtime_group_order {
        if let Some(proxy) = core_groups.remove(&name) {
            groups.push(build_group(name, proxy, resolver));
        }
    }

    let order_source = if groups.is_empty() {
        ProxyViewOrderSource::Fallback
    } else {
        ProxyViewOrderSource::Runtime
    };
    groups.extend(
        core_groups
            .into_iter()
            .map(|(name, proxy)| build_group(name, proxy, resolver)),
    );
    (groups, order_source)
}

fn build_standalone(core_node_ids: &BTreeMap<String, String>) -> Vec<String> {
    let mut standalone = ["DIRECT", "REJECT"]
        .into_iter()
        .filter_map(|name| core_node_ids.get(name).cloned())
        .collect::<Vec<_>>();
    standalone.extend(
        core_node_ids
            .iter()
            .filter(|(name, _)| name.as_str() != "DIRECT" && name.as_str() != "REJECT")
            .map(|(_, record_id)| record_id.clone()),
    );
    standalone
}
