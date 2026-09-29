use crate::config::{ProfileRoute, RoutingPolicy, normalize_domain};
use anyhow::{Context as _, Result, bail};
use serde_yaml_ng::{Mapping, Value};
use std::collections::{HashMap, HashSet};

const BUILTIN: &[&str] = &["DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE"];
const TEST_URL: &str = "https://www.gstatic.com/generate_204";

fn key(value: &str) -> Value {
    Value::from(value)
}

fn sequence(config: &Mapping, field: &str) -> Result<Vec<Value>> {
    match config.get(field) {
        Some(Value::Sequence(values)) => Ok(values.clone()),
        Some(_) => bail!("{field} must be a list"),
        None => Ok(Vec::new()),
    }
}

fn providers(config: &Mapping) -> Result<Mapping> {
    match config.get("proxy-providers") {
        Some(Value::Mapping(values)) => Ok(values.clone()),
        Some(_) => bail!("proxy-providers must be a mapping"),
        None => Ok(Mapping::new()),
    }
}

fn names(values: &[Value], section: &str) -> Result<Vec<String>> {
    let mut found = HashSet::new();
    values
        .iter()
        .map(|value| {
            let name = value
                .as_mapping()
                .and_then(|map| map.get("name"))
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty() && !name.chars().any(|c| matches!(c, ',' | '\n' | '\r')))
                .with_context(|| format!("{section} entry has an invalid name"))?;
            if !found.insert(name.to_owned()) {
                bail!("{section} contains duplicate name {name:?}");
            }
            Ok(name.to_owned())
        })
        .collect()
}

fn put_string(map: &mut Mapping, field: &str, value: &str) {
    map.insert(key(field), key(value));
}

fn appended_names(map: &mut Mapping, field: &str, additions: &[String]) -> Result<()> {
    let entry = map.entry(key(field)).or_insert_with(|| Value::Sequence(Vec::new()));
    let values = entry
        .as_sequence_mut()
        .with_context(|| format!("{field} must be a list"))?;
    let mut existing: HashSet<String> = values.iter().filter_map(Value::as_str).map(str::to_owned).collect();
    for name in additions {
        if existing.insert(name.clone()) {
            values.push(key(name));
        }
    }
    Ok(())
}

fn materialize_include_all(
    groups: &mut [Value],
    nodes: &[Value],
    names: &[String],
    providers: &[String],
) -> Result<()> {
    for group in groups {
        let map = group.as_mapping_mut().context("proxy group must be a mapping")?;
        let all = map.remove("include-all").and_then(|v| v.as_bool()).unwrap_or(false);
        let all_nodes = map
            .remove("include-all-proxies")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let all_providers = map
            .remove("include-all-providers")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if all || all_nodes {
            let filter = map
                .get("filter")
                .and_then(Value::as_str)
                .map(regex::Regex::new)
                .transpose()?;
            let excluded = map
                .get("exclude-filter")
                .and_then(Value::as_str)
                .map(regex::Regex::new)
                .transpose()?;
            let excluded_type = map
                .get("exclude-type")
                .and_then(Value::as_str)
                .map(regex::Regex::new)
                .transpose()?;
            let selected = nodes
                .iter()
                .zip(names)
                .filter(|(node, name)| {
                    filter.as_ref().is_none_or(|pattern| pattern.is_match(name))
                        && excluded.as_ref().is_none_or(|pattern| !pattern.is_match(name))
                        && excluded_type.as_ref().is_none_or(|pattern| {
                            !node
                                .get("type")
                                .and_then(Value::as_str)
                                .is_some_and(|kind| pattern.is_match(kind))
                        })
                })
                .map(|(_, name)| name.clone())
                .collect::<Vec<_>>();
            appended_names(map, "proxies", &selected)?;
        }
        if all || all_providers {
            appended_names(map, "use", providers)?;
        }
    }
    Ok(())
}

fn rename_reference(value: &mut Value, known: &HashSet<String>, prefix: &str) -> Result<()> {
    let name = value.as_str().context("proxy reference must be a name")?;
    if BUILTIN.contains(&name) {
        return Ok(());
    }
    if !known.contains(name) {
        bail!("source refers to unknown proxy or group {name:?}");
    }
    *value = key(&format!("{prefix}{name}"));
    Ok(())
}

fn rename_refs(map: &mut Mapping, field: &str, known: &HashSet<String>, prefix: &str) -> Result<()> {
    if let Some(value) = map.get_mut(field) {
        match value {
            Value::Sequence(values) => {
                for value in values {
                    rename_reference(value, known, prefix)?;
                }
            }
            _ => rename_reference(value, known, prefix)?,
        }
    }
    Ok(())
}

fn rename_dialer_refs(value: &mut Value, known: &HashSet<String>, prefix: &str) -> Result<()> {
    match value {
        Value::Mapping(map) => {
            rename_refs(map, "dialer-proxy", known, prefix)?;
            for value in map.values_mut() {
                rename_dialer_refs(value, known, prefix)?;
            }
        }
        Value::Sequence(values) => {
            for value in values {
                rename_dialer_refs(value, known, prefix)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn rename_inline_dialer_refs(
    value: &mut Value,
    known: &HashSet<String>,
    inline: &HashSet<String>,
    prefix: &str,
    old_prefix: &str,
    old_suffix: &str,
) -> Result<()> {
    match value {
        Value::Mapping(map) => {
            if let Some(dialer) = map.get_mut("dialer-proxy") {
                let name = dialer.as_str().context("dialer-proxy must be a name")?;
                if !BUILTIN.contains(&name) {
                    let renamed = if known.contains(name) && inline.contains(name) {
                        bail!("inline provider dialer-proxy {name:?} is ambiguous");
                    } else if known.contains(name) {
                        format!("{prefix}{name}")
                    } else if inline.contains(name) {
                        format!("{prefix}{old_prefix}{name}{old_suffix}")
                    } else {
                        bail!("inline provider refers to unknown dialer-proxy {name:?}");
                    };
                    *dialer = key(&renamed);
                }
            }
            for child in map.values_mut() {
                rename_inline_dialer_refs(child, known, inline, prefix, old_prefix, old_suffix)?;
            }
        }
        Value::Sequence(values) => {
            for child in values {
                rename_inline_dialer_refs(child, known, inline, prefix, old_prefix, old_suffix)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn rename_group_filter(group: &mut Mapping, field: &str, prefix: &str) -> Result<()> {
    if let Some(value) = group.get_mut(field) {
        let pattern = value.as_str().with_context(|| format!("{field} must be text"))?;
        let mut flags_end = 0;
        while pattern[flags_end..].starts_with("(?") {
            let Some(end) = pattern[flags_end..].find(')') else {
                break;
            };
            let flags = &pattern[flags_end + 2..flags_end + end];
            if flags.is_empty() || !flags.bytes().all(|c| matches!(c, b'i' | b'm' | b's' | b'U' | b'-')) {
                break;
            }
            flags_end += end + 1;
        }
        let (flags, body) = pattern.split_at(flags_end);
        let mut escaped = false;
        let mut character_class = false;
        let mut depth = 0usize;
        let mut other_anchor = false;
        let mut top_alternative = false;
        for (index, byte) in body.bytes().enumerate() {
            if escaped {
                escaped = false;
                continue;
            }
            match byte {
                b'\\' => escaped = true,
                b'[' => character_class = true,
                b']' => character_class = false,
                b'(' if !character_class => depth += 1,
                b')' if !character_class => depth = depth.saturating_sub(1),
                b'|' if !character_class && depth == 0 => top_alternative = true,
                b'^' if !character_class && index != 0 => other_anchor = true,
                _ => {}
            }
        }
        if other_anchor || (body.starts_with('^') && top_alternative) {
            bail!("source group {field} has unsupported start anchors");
        }
        let escaped_prefix = regex::escape(prefix);
        let rewritten = if let Some(body) = body.strip_prefix('^') {
            format!("{flags}^{escaped_prefix}(?:{body})")
        } else {
            format!("{flags}^{escaped_prefix}.*(?:{body})")
        };
        *value = key(&rewritten);
    }
    Ok(())
}

fn uid_prefix(uid: &str) -> Result<String> {
    if uid.is_empty() || uid.len() > 128 || uid.chars().any(|c| matches!(c, '\n' | '\r')) {
        bail!("route profile UID is invalid");
    }
    let token = uid
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("CVR:{token}:"))
}

fn validate_port(port: u16, config: &Mapping, listeners: &[Value], used: &HashSet<u16>) -> Result<()> {
    if port == 0 || used.contains(&port) {
        bail!("route port {port} is invalid or duplicated");
    }
    for field in ["port", "socks-port", "mixed-port", "redir-port", "tproxy-port"] {
        if config.get(field).and_then(Value::as_u64) == Some(u64::from(port)) {
            bail!("route port {port} conflicts with {field}");
        }
    }
    for listener in listeners {
        if listener.get("port").and_then(Value::as_u64) == Some(u64::from(port)) {
            bail!("route port {port} conflicts with an existing listener");
        }
    }
    for address in [
        config.get("external-controller").and_then(Value::as_str),
        config.get("external-controller-tls").and_then(Value::as_str),
        config
            .get("dns")
            .and_then(|dns| dns.get("listen"))
            .and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    {
        if address.rsplit(':').next().and_then(|part| part.parse::<u16>().ok()) == Some(port) {
            bail!("route port {port} conflicts with an existing service");
        }
    }
    Ok(())
}

fn add_domain_rules(route: &ProfileRoute, target: &str, rules: &mut HashMap<(bool, String), String>) -> Result<()> {
    for (exact, raw) in route
        .domains
        .iter()
        .map(|domain| (false, domain))
        .chain(route.exact_domains.iter().map(|domain| (true, domain)))
    {
        let domain = normalize_domain(raw)?;
        if rules
            .insert((exact, domain.to_string()), target.to_owned())
            .is_some_and(|previous| previous != target)
        {
            bail!("domain {domain:?} is assigned to multiple profiles");
        }
    }
    Ok(())
}

pub fn apply_routes(mut config: Mapping, sources: &[(ProfileRoute, Mapping)]) -> Result<Mapping> {
    if sources.is_empty() || sources.iter().all(|(route, _)| !route.enabled) {
        return Ok(config);
    }
    let mut base_nodes = sequence(&config, "proxies")?;
    let mut base_groups = sequence(&config, "proxy-groups")?;
    let mut base_providers = providers(&config)?;
    let base_node_names = names(&base_nodes, "base proxies")?;
    let base_group_names = names(&base_groups, "base proxy-groups")?;
    let base_provider_names = base_providers
        .keys()
        .map(|key| key.as_str().context("provider name must be text").map(str::to_owned))
        .collect::<Result<Vec<_>>>()?;
    materialize_include_all(&mut base_groups, &base_nodes, &base_node_names, &base_provider_names)?;
    let mut occupied: HashSet<String> = base_node_names.into_iter().chain(base_group_names).collect();
    let mut listeners = sequence(&config, "listeners")?;
    let mut rules = sequence(&config, "rules")?;
    let mut used_profiles = HashSet::new();
    let mut used_ports = HashSet::new();
    let mut domain_rules = HashMap::<(bool, String), String>::new();

    for (route, source) in sources.iter().filter(|(route, _)| route.enabled) {
        let uid = route.profile.as_str();
        if !used_profiles.insert(uid.to_owned()) {
            bail!("duplicate enabled route for profile {uid:?}");
        }
        if route.domains.is_empty() && route.exact_domains.is_empty() && route.port.is_none() {
            bail!("enabled profile route needs a domain or port");
        }
        if (!route.domains.is_empty() || !route.exact_domains.is_empty())
            && config
                .get("mode")
                .and_then(Value::as_str)
                .is_some_and(|mode| mode != "rule")
        {
            bail!("domain routing requires rule mode");
        }
        if route.policy == RoutingPolicy::Fixed && route.node.as_deref().is_none_or(str::is_empty) {
            bail!("fixed policy requires a node name");
        }
        let prefix = uid_prefix(uid)?;
        let member_prefix = format!("{prefix}member:");
        let provider_prefix = format!("{prefix}provider:");
        let target = format!("{prefix}route");
        let mut source_nodes = sequence(source, "proxies")?;
        let mut source_groups = sequence(source, "proxy-groups")?;
        let source_providers = providers(source)?;
        let node_names = names(&source_nodes, "source proxies")?;
        let group_names = names(&source_groups, "source proxy-groups")?;
        let provider_names = source_providers
            .keys()
            .map(|key| key.as_str().context("provider name must be text").map(str::to_owned))
            .collect::<Result<Vec<_>>>()?;
        if node_names.is_empty() && provider_names.is_empty() {
            bail!("route source {uid:?} has no proxies or proxy providers");
        }
        let mut known = HashSet::new();
        for name in node_names.iter().chain(group_names.iter()) {
            if BUILTIN.contains(&name.as_str()) || !known.insert(name.clone()) {
                bail!("source has ambiguous proxy or group name {name:?}");
            }
            let full = format!("{member_prefix}{name}");
            if !occupied.insert(full.clone()) {
                bail!("generated proxy name conflicts with existing name {full:?}");
            }
        }
        if !occupied.insert(target.clone()) {
            bail!("generated route group conflicts with existing name {target:?}");
        }
        materialize_include_all(&mut source_groups, &source_nodes, &node_names, &provider_names)?;
        let terms = if matches!(route.policy, RoutingPolicy::Auto | RoutingPolicy::Fallback) {
            route
                .regions
                .iter()
                .map(|term| term.trim().to_ascii_lowercase())
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        if terms.iter().any(String::is_empty) {
            bail!("region keywords cannot be blank");
        }
        let matches_region =
            |name: &str| terms.is_empty() || terms.iter().any(|term| name.to_ascii_lowercase().contains(term));
        let selected_nodes = node_names
            .iter()
            .filter(|name| {
                matches_region(name)
                    && (route.policy != RoutingPolicy::Fixed || route.node.as_deref() == Some(name.as_str()))
            })
            .map(|name| format!("{member_prefix}{name}"))
            .collect::<Vec<_>>();
        if selected_nodes.is_empty() && provider_names.is_empty() {
            bail!("route policy matches no source nodes");
        }
        let mut top = Mapping::new();
        put_string(&mut top, "name", &target);
        put_string(
            &mut top,
            "type",
            match route.policy {
                RoutingPolicy::Manual | RoutingPolicy::Fixed => "select",
                RoutingPolicy::Auto => "url-test",
                RoutingPolicy::Fallback => "fallback",
            },
        );
        if !selected_nodes.is_empty() {
            top.insert(
                key("proxies"),
                Value::Sequence(selected_nodes.iter().map(|name| key(name)).collect()),
            );
        }
        if !provider_names.is_empty() {
            top.insert(
                key("use"),
                Value::Sequence(
                    provider_names
                        .iter()
                        .map(|name| key(&format!("{provider_prefix}{name}")))
                        .collect(),
                ),
            );
        }
        put_string(&mut top, "empty-fallback", "REJECT");
        if matches!(route.policy, RoutingPolicy::Auto | RoutingPolicy::Fallback) {
            put_string(&mut top, "url", TEST_URL);
            top.insert(key("interval"), Value::from(600));
            top.insert(key("lazy"), Value::from(true));
        }
        let mut provider_patterns = Vec::new();
        for (name, mut provider) in source_providers {
            let raw_name = name.as_str().context("provider name must be text")?;
            let map = provider.as_mapping_mut().context("proxy provider must be a mapping")?;
            match map.get("type").and_then(Value::as_str) {
                Some("http") => {
                    let encoded_name = raw_name
                        .as_bytes()
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>();
                    put_string(
                        map,
                        "path",
                        &format!(
                            "./proxy_providers/cvr/{}/{}.yaml",
                            &prefix[4..prefix.len() - 1],
                            encoded_name
                        ),
                    );
                }
                Some("file" | "inline") => {}
                _ => bail!("unsupported proxy provider type in {raw_name:?}"),
            }
            rename_refs(map, "proxy", &known, &member_prefix)?;
            let (old_prefix, old_suffix) = {
                let override_map = map
                    .entry(key("override"))
                    .or_insert_with(|| Value::Mapping(Mapping::new()))
                    .as_mapping_mut()
                    .context("provider override must be a mapping")?;
                rename_refs(override_map, "dialer-proxy", &known, &member_prefix)?;
                let old_prefix = match override_map.get("additional-prefix") {
                    Some(value) => value
                        .as_str()
                        .context("provider additional-prefix must be text")?
                        .to_owned(),
                    None => String::new(),
                };
                let old_suffix = match override_map.get("additional-suffix") {
                    Some(value) => value
                        .as_str()
                        .context("provider additional-suffix must be text")?
                        .to_owned(),
                    None => String::new(),
                };
                put_string(
                    override_map,
                    "additional-prefix",
                    &format!("{member_prefix}{old_prefix}"),
                );
                (old_prefix, old_suffix)
            };
            if map.get("type").and_then(Value::as_str) == Some("inline") {
                let payload = map.get_mut("payload").context("inline provider needs payload")?;
                let inline_names = names(
                    payload
                        .as_sequence()
                        .context("inline provider payload must be a list")?,
                    "inline provider proxies",
                )?
                .into_iter()
                .collect::<HashSet<_>>();
                if inline_names.is_empty() {
                    bail!("inline provider payload cannot be empty");
                }
                rename_inline_dialer_refs(payload, &known, &inline_names, &member_prefix, &old_prefix, &old_suffix)?;
            }
            if route.policy == RoutingPolicy::Fixed {
                provider_patterns.push(format!(
                    "^{}$",
                    regex::escape(&format!("{member_prefix}{}", route.node.as_deref().unwrap_or_default()))
                ));
            }
            let renamed = format!("{provider_prefix}{raw_name}");
            if base_providers.contains_key(renamed.as_str()) {
                bail!("generated provider name conflicts with existing name {renamed:?}");
            }
            base_providers.insert(key(&renamed), provider);
        }
        if route.policy == RoutingPolicy::Fixed {
            top.insert(key("filter"), key(&provider_patterns.join("|")));
        } else if !terms.is_empty() {
            top.insert(
                key("filter"),
                key(&format!(
                    "(?i)^{}.*(?:{})",
                    regex::escape(&member_prefix),
                    terms
                        .iter()
                        .map(|term| regex::escape(term))
                        .collect::<Vec<_>>()
                        .join("|")
                )),
            );
        }
        for node in &mut source_nodes {
            let map = node.as_mapping_mut().context("proxy must be a mapping")?;
            let name = map
                .get("name")
                .and_then(Value::as_str)
                .context("proxy name missing")?
                .to_owned();
            put_string(map, "name", &format!("{member_prefix}{name}"));
            rename_dialer_refs(node, &known, &member_prefix)?;
        }
        let direct_names: HashSet<String> = node_names.iter().cloned().collect();
        for group in &mut source_groups {
            let map = group.as_mapping_mut().context("proxy group must be a mapping")?;
            let name = map
                .get("name")
                .and_then(Value::as_str)
                .context("group name missing")?
                .to_owned();
            put_string(map, "name", &format!("{member_prefix}{name}"));
            rename_refs(map, "proxies", &known, &member_prefix)?;
            if let Some(fallback) = map.get_mut("empty-fallback") {
                rename_reference(fallback, &direct_names, &member_prefix)?;
            }
            if let Some(uses) = map.get_mut("use") {
                let uses = uses.as_sequence_mut().context("group use must be a list")?;
                for value in uses {
                    let provider = value.as_str().context("group provider reference must be text")?;
                    if !provider_names.iter().any(|name| name == provider) {
                        bail!("source group refers to unknown provider {provider:?}");
                    }
                    *value = key(&format!("{provider_prefix}{provider}"));
                }
            }
            rename_group_filter(map, "filter", &member_prefix)?;
            rename_group_filter(map, "exclude-filter", &member_prefix)?;
        }
        base_nodes.extend(source_nodes);
        base_groups.extend(source_groups);
        base_groups.push(Value::Mapping(top));
        add_domain_rules(route, &target, &mut domain_rules)?;
        if let Some(port) = route.port {
            validate_port(port, &config, &listeners, &used_ports)?;
            let listener_name = format!("{prefix}listener");
            if listeners
                .iter()
                .any(|listener| listener.get("name").and_then(Value::as_str) == Some(listener_name.as_str()))
            {
                bail!("generated listener name conflicts with an existing listener");
            }
            used_ports.insert(port);
            let mut listener = Mapping::new();
            put_string(&mut listener, "name", &listener_name);
            put_string(&mut listener, "type", "mixed");
            put_string(&mut listener, "listen", "127.0.0.1");
            listener.insert(key("port"), Value::from(port));
            put_string(&mut listener, "proxy", &target);
            listeners.push(Value::Mapping(listener));
        }
    }
    let mut additions = domain_rules.into_iter().collect::<Vec<_>>();
    additions.sort_by(|((exact_a, domain_a), _), ((exact_b, domain_b), _)| {
        domain_b
            .split('.')
            .count()
            .cmp(&domain_a.split('.').count())
            .then_with(|| exact_b.cmp(exact_a))
            .then_with(|| domain_a.cmp(domain_b))
    });
    let mut new_rules = additions
        .into_iter()
        .map(|((exact, domain), target)| {
            key(&format!(
                "{},{domain},{target}",
                if exact { "DOMAIN" } else { "DOMAIN-SUFFIX" }
            ))
        })
        .collect::<Vec<_>>();
    new_rules.append(&mut rules);
    config.insert(key("proxies"), Value::Sequence(base_nodes));
    config.insert(key("proxy-groups"), Value::Sequence(base_groups));
    config.insert(key("proxy-providers"), Value::Mapping(base_providers));
    if !new_rules.is_empty() {
        config.insert(key("rules"), Value::Sequence(new_rules));
    }
    if !listeners.is_empty() {
        config.insert(key("listeners"), Value::Sequence(listeners));
    }
    Ok(config)
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests use fixed YAML fixtures")]
mod tests {
    use super::*;

    fn yaml(source: &str) -> Mapping {
        serde_yaml_ng::from_str(source).expect("valid fixture")
    }

    fn route(uid: &str) -> ProfileRoute {
        ProfileRoute {
            profile: uid.into(),
            domains: vec![format!("{uid}.example").into()],
            ..ProfileRoute::default()
        }
    }

    #[test]
    fn identical_source_names_are_isolated_and_base_include_all_stays_at_its_original_scope() {
        let base = yaml(
            "mode: rule\nproxies:\n  - {name: Base, type: direct}\nproxy-groups:\n  - {name: Default, type: select, include-all: true, filter: '^Base$'}\n",
        );
        let source = yaml(
            "proxies:\n  - {name: Shared, type: direct}\nproxy-groups:\n  - {name: Choice, type: select, proxies: [Shared], empty-fallback: Shared}\n",
        );
        let result =
            apply_routes(base, &[(route("a"), source.clone()), (route("b"), source)]).expect("two profiles compose");
        let groups = result["proxy-groups"].as_sequence().expect("groups");
        let base_group = groups[0].as_mapping().expect("base group");
        assert_eq!(base_group["proxies"], yaml("items: [Base]")["items"]);
        assert_eq!(base_group.get("include-all"), None);
        let name_a = "CVR:61:member:Shared";
        let name_b = "CVR:62:member:Shared";
        assert_eq!(groups[1]["proxies"], yaml(&format!("items: [{name_a}]"))["items"]);
        assert_eq!(groups[1]["empty-fallback"], Value::from(name_a));
        assert_eq!(groups[3]["proxies"], yaml(&format!("items: [{name_b}]"))["items"]);
        assert_eq!(groups[3]["empty-fallback"], Value::from(name_b));
        assert_eq!(result["rules"][0], Value::from("DOMAIN-SUFFIX,a.example,CVR:61:route"));
        assert_eq!(result["rules"][1], Value::from("DOMAIN-SUFFIX,b.example,CVR:62:route"));
        let builtin_source = yaml(
            "proxies:\n  - {name: Node, type: direct}\nproxy-groups:\n  - {name: Choice, type: select, proxies: [Node], empty-fallback: REJECT}\n",
        );
        let builtin =
            apply_routes(yaml("mode: rule\n"), &[(route("a"), builtin_source)]).expect("built-in fallback composes");
        assert_eq!(builtin["proxy-groups"][0]["empty-fallback"], Value::from("REJECT"));
    }

    #[test]
    fn domain_specificity_and_loopback_port_target_the_source_group() {
        let base = yaml("mode: rule\nmixed-port: 7890\nrules: [MATCH,DIRECT]\n");
        let source = yaml("proxies:\n  - {name: A, type: direct}\n");
        let mut broad = route("a");
        broad.domains = vec!["example.com".into()];
        let mut specific = route("b");
        specific.domains = vec!["https://www.example.com/path".into()];
        specific.port = Some(9080);
        let result = apply_routes(base, &[(broad, source.clone()), (specific, source)]).expect("routes compose");
        assert_eq!(
            result["rules"][0],
            Value::from("DOMAIN-SUFFIX,www.example.com,CVR:62:route")
        );
        assert_eq!(
            result["rules"][1],
            Value::from("DOMAIN-SUFFIX,example.com,CVR:61:route")
        );
        assert_eq!(result["listeners"][0]["listen"], Value::from("127.0.0.1"));
        assert_eq!(result["listeners"][0]["port"], Value::from(9080));
        assert_eq!(result["listeners"][0]["proxy"], Value::from("CVR:62:route"));
    }

    #[test]
    fn provider_only_sources_get_separate_caches_and_scoped_group_references() {
        let source = yaml(
            "proxy-providers:\n  Shared:\n    type: http\n    url: https://example.com/nodes.yaml\n    path: ./providers/shared.yaml\nproxy-groups:\n  - {name: Choice, type: select, use: [Shared]}\n",
        );
        let result = apply_routes(
            yaml("mode: rule\n"),
            &[(route("a"), source.clone()), (route("b"), source)],
        )
        .expect("provider sources compose");
        assert_ne!(
            result["proxy-providers"]["CVR:61:provider:Shared"]["path"],
            result["proxy-providers"]["CVR:62:provider:Shared"]["path"]
        );
        assert_eq!(
            result["proxy-groups"][0]["use"],
            yaml("items: ['CVR:61:provider:Shared']")["items"]
        );
        assert_eq!(
            result["proxy-groups"][2]["use"],
            yaml("items: ['CVR:62:provider:Shared']")["items"]
        );
        assert_eq!(
            result["proxy-providers"]["CVR:61:provider:Shared"]["override"]["additional-prefix"],
            Value::from("CVR:61:member:")
        );
    }

    #[test]
    fn fixed_provider_filter_matches_original_name_with_existing_overrides() {
        let source = yaml(
            "proxy-providers:\n  Remote:\n    type: http\n    url: https://example.com/nodes.yaml\n    override: {additional-prefix: '[old] ', additional-suffix: '!' }\n",
        );
        let mut item = route("a");
        item.policy = RoutingPolicy::Fixed;
        item.node = Some("[old] Node!".into());
        let result = apply_routes(yaml("mode: rule\n"), &[(item, source)]).expect("fixed provider composes");
        assert_eq!(
            result["proxy-groups"][0]["filter"],
            Value::from("^CVR:61:member:\\[old\\] Node!$")
        );
    }

    #[test]
    fn inline_dialer_reference_uses_displayed_provider_node_name() {
        let source = yaml(
            "proxy-providers:\n  Inline:\n    type: inline\n    override: {additional-prefix: '[old] ', additional-suffix: '!'}\n    payload:\n      - {name: First, type: socks5, server: 127.0.0.1, port: 1080}\n      - {name: Second, type: socks5, server: 127.0.0.1, port: 1081, dialer-proxy: First}\n",
        );
        let result = apply_routes(yaml("mode: rule\n"), &[(route("a"), source)]).expect("inline provider composes");
        assert_eq!(
            result["proxy-providers"]["CVR:61:provider:Inline"]["payload"][1]["dialer-proxy"],
            Value::from("CVR:61:member:[old] First!")
        );
    }

    #[test]
    fn source_group_filter_keeps_inline_flags_and_rejects_ambiguous_anchors() {
        let source = yaml(
            "proxies:\n  - {name: Hong Kong, type: direct}\nproxy-groups:\n  - {name: Region, type: select, include-all: true, filter: '(?i)^hong'}\n",
        );
        let result =
            apply_routes(yaml("mode: rule\n"), &[(route("a"), source)]).expect("anchored source filter composes");
        assert_eq!(
            result["proxy-groups"][0]["filter"],
            Value::from("(?i)^CVR:61:member:(?:hong)")
        );
        let ambiguous = yaml(
            "proxies:\n  - {name: A, type: direct}\nproxy-groups:\n  - {name: Region, type: select, filter: '^A|^B'}\n",
        );
        assert!(apply_routes(yaml("mode: rule\n"), &[(route("a"), ambiguous)]).is_err());
    }

    #[test]
    fn region_filter_cannot_match_uid_prefix() {
        let source = yaml(
            "proxy-providers:\n  Inline:\n    type: inline\n    payload: [{name: Japan, type: socks5, server: 127.0.0.1, port: 1080}]\n",
        );
        let mut item = route("a");
        item.regions = vec!["61".into()];
        item.policy = RoutingPolicy::Auto;
        let result = apply_routes(yaml("mode: rule\n"), &[(item, source)]).expect("region filter composes");
        let pattern = result["proxy-groups"][0]["filter"].as_str().expect("filter");
        assert!(
            !regex::Regex::new(pattern)
                .expect("valid filter")
                .is_match("CVR:61:member:Japan")
        );
    }

    #[test]
    fn local_and_inline_provider_sources_preserve_local_file_paths() {
        let source = yaml(
            "proxy-providers:\n  File: {type: file, path: ./providers/local.yaml}\n  Inline:\n    type: inline\n    payload: [{name: Node, type: direct}]\n",
        );
        let result = apply_routes(yaml("mode: rule\n"), &[(route("a"), source)]).expect("local providers compose");
        assert_eq!(
            result["proxy-providers"]["CVR:61:provider:File"]["path"],
            Value::from("./providers/local.yaml")
        );
        assert_eq!(
            result["proxy-providers"]["CVR:61:provider:Inline"]["override"]["additional-prefix"],
            Value::from("CVR:61:member:")
        );
        assert_eq!(
            result["proxy-groups"][0]["use"],
            yaml("items: ['CVR:61:provider:File', 'CVR:61:provider:Inline']")["items"]
        );
    }

    #[test]
    fn conflicting_domains_fail_and_disabled_routes_leave_input_unchanged() {
        let base = yaml("mode: rule\n");
        let source = yaml("proxies:\n  - {name: A, type: direct}\n");
        let mut second = route("b");
        second.domains = vec!["a.example".into()];
        assert!(apply_routes(base.clone(), &[(route("a"), source.clone()), (second, source.clone())]).is_err());
        let mut disabled = route("a");
        disabled.enabled = false;
        assert_eq!(
            apply_routes(base.clone(), &[(disabled, source)]).expect("disabled route"),
            base
        );
    }

    #[test]
    fn fixed_auto_and_fallback_policies_keep_source_members() {
        let source = yaml("proxies:\n  - {name: Hong Kong A, type: direct}\n  - {name: Japan B, type: direct}\n");
        for (policy, expected_type) in [
            (RoutingPolicy::Fixed, "select"),
            (RoutingPolicy::Auto, "url-test"),
            (RoutingPolicy::Fallback, "fallback"),
        ] {
            let mut item = route("a");
            item.policy = policy;
            item.regions = vec!["Hong Kong".into()];
            if policy == RoutingPolicy::Fixed {
                item.node = Some("Hong Kong A".into());
            }
            let result = apply_routes(yaml("mode: rule\n"), &[(item, source.clone())]).expect("policy composes");
            let top = &result["proxy-groups"][0];
            assert_eq!(top["type"], Value::from(expected_type));
            assert_eq!(top["proxies"], yaml("items: ['CVR:61:member:Hong Kong A']")["items"]);
        }
    }

    #[test]
    fn hidden_region_keywords_do_not_limit_manual_or_fixed_policies() {
        let source = yaml("proxies:\n  - {name: A, type: direct}\n  - {name: B, type: direct}\n");
        let mut manual = route("a");
        manual.regions = vec!["unmatched".into()];
        let mut fixed = route("b");
        fixed.policy = RoutingPolicy::Fixed;
        fixed.node = Some("B".into());
        fixed.regions = vec!["unmatched".into()];
        let result = apply_routes(yaml("mode: rule\n"), &[(manual, source.clone()), (fixed, source)])
            .expect("hidden filters do not apply");
        assert_eq!(
            result["proxy-groups"][0]["proxies"],
            yaml("items: ['CVR:61:member:A', 'CVR:61:member:B']")["items"]
        );
        assert_eq!(
            result["proxy-groups"][1]["proxies"],
            yaml("items: ['CVR:62:member:B']")["items"]
        );
    }

    #[test]
    fn source_member_named_route_does_not_collide_with_generated_group() {
        let source = yaml("proxies:\n  - {name: route, type: direct}\n");
        let result =
            apply_routes(yaml("mode: rule\n"), &[(route("a"), source)]).expect("source node name remains valid");
        assert_eq!(result["proxies"][0]["name"], Value::from("CVR:61:member:route"));
        assert_eq!(result["proxy-groups"][0]["name"], Value::from("CVR:61:route"));
        assert_eq!(
            result["proxy-groups"][0]["proxies"][0],
            Value::from("CVR:61:member:route")
        );
        let source = yaml(
            "proxies:\n  - {name: A, type: direct}\nproxy-groups:\n  - {name: route, type: select, proxies: [A]}\n",
        );
        let result =
            apply_routes(yaml("mode: rule\n"), &[(route("a"), source)]).expect("source group name remains valid");
        assert_eq!(result["proxy-groups"][0]["name"], Value::from("CVR:61:member:route"));
        assert_eq!(result["proxy-groups"][1]["name"], Value::from("CVR:61:route"));
    }

    #[test]
    fn generated_config_passes_mihomo_validation_when_binary_is_supplied() {
        let Ok(binary) = std::env::var("MIHOMO_BIN") else {
            return;
        };
        let source = yaml(
            "proxies:\n  - {name: Node A, type: socks5, server: 127.0.0.1, port: 1080}\n  - {name: Node B, type: socks5, server: 127.0.0.1, port: 1081}\nproxy-providers:\n  Inline:\n    type: inline\n    payload: [{name: Node C, type: socks5, server: 127.0.0.1, port: 1082}]\n",
        );
        let mut manual = route("a");
        manual.port = Some(19080);
        let mut fixed = route("b");
        fixed.policy = RoutingPolicy::Fixed;
        fixed.node = Some("Node A".into());
        let mut auto = route("c");
        auto.policy = RoutingPolicy::Auto;
        let mut fallback = route("d");
        fallback.policy = RoutingPolicy::Fallback;
        let result = apply_routes(
            yaml("mode: rule\nrules: ['MATCH,DIRECT']\n"),
            &[
                (manual, source.clone()),
                (fixed, source.clone()),
                (auto, source.clone()),
                (fallback, source),
            ],
        )
        .expect("all policies compose");
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("cvr-routing-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&directory).expect("create fixture directory");
        let config_path = directory.join("config.yaml");
        std::fs::write(
            &config_path,
            serde_yaml_ng::to_string(&result).expect("serialize config"),
        )
        .expect("write fixture config");
        let output = std::process::Command::new(binary)
            .arg("-t")
            .arg("-d")
            .arg(&directory)
            .arg("-f")
            .arg(&config_path)
            .output()
            .expect("run Mihomo config test");
        std::fs::remove_dir_all(&directory).expect("remove fixture directory");
        assert!(
            output.status.success(),
            "Mihomo rejected generated config (stdout: {}, stderr: {})",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
