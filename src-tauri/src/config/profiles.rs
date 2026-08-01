use super::{
    PrfOption,
    prfitem::{PrfItem, PrfSelected},
};
use crate::{
    core::{handle, tray::Tray},
    utils::{
        dirs::{self, PathBufExec as _},
        help,
    },
};
use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path},
    sync::{
        LazyLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tauri_plugin_mihomo::models::{Proxies, ProxyType};
use tokio::{fs, task::JoinHandle};

/// Regex to check profile file names, eg.
/// R12345678.yaml (remote)
/// L12345678.yaml (local)
/// m12345678.yaml (merge)
/// s12345678.js (script)
/// r12345678.yaml (rules)
/// p12345678.yaml (proxies)
/// g12345678.yaml (groups)
#[allow(clippy::unwrap_used)]
static REGEX_PROFILE_FILE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^(?:[RLmrpg][a-zA-Z0-9]+\.yaml|s[a-zA-Z0-9]+\.js)$").unwrap());

// activate selected nodes task handle
static ACTIVATE_SELECTED_TASK: LazyLock<Mutex<Option<JoinHandle<()>>>> = LazyLock::new(|| Mutex::new(None));
static ACTIVATE_SELECTED_GENERATION: AtomicU64 = AtomicU64::new(0);

// The plugin already limits the request/response phase to 5 seconds. This outer timeout also covers
// lock acquisition, connection-pool waiting, and local-socket connection establishment.
const MIHOMO_OPERATION_TIMEOUT: Duration = Duration::from_secs(10);
const SELECTED_NODES_RECHECK_DELAY: Duration = Duration::from_secs(1);
/// How long a restore keeps trying to put back selections the core has not loaded yet.
///
/// A provider-backed group is present but empty until its provider finishes loading, which on a
/// cold start is exactly when restoring runs. Bounded rather than indefinite because a record
/// naming a node the profile genuinely no longer has looks identical from here, and would
/// otherwise be retried for the life of the process.
const SELECTED_NODES_SETTLE_DEADLINE: Duration = Duration::from_secs(30);
/// How often a restore looks again while waiting for those groups.
const SELECTED_NODES_SETTLE_INTERVAL: Duration = Duration::from_secs(1);
/// How long a start waits for the selections that *can* be put back before carrying on.
///
/// Covers a healthy core answering one query and a handful of selects. Past that the start
/// proceeds: the remaining groups need the core to finish loading, which is not something a
/// start can usefully wait for.
const SELECTED_NODES_FIRST_PASS_BUDGET: Duration = Duration::from_secs(3);

/// Define the `profiles.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IProfiles {
    /// same as PrfConfig.current
    pub current: Option<String>,

    /// profile list
    pub items: Option<Vec<PrfItem>>,
}

pub struct IProfilePreview<'a> {
    pub uid: &'a String,
    pub name: &'a String,
    pub is_current: bool,
}

/// 清理结果
#[derive(Debug, Clone)]
pub struct CleanupResult {
    pub total_files: usize,
    pub deleted_files: usize,
    pub failed_deletions: usize,
}

macro_rules! patch {
    ($lv: expr, $rv: expr, $key: tt) => {
        if ($rv.$key).is_some() {
            $lv.$key = $rv.$key.to_owned();
        }
    };
}

impl IProfiles {
    // Helper to find and remove an item by uid from the items vec, returning its file name (if any).
    fn take_item_file_by_uid(items: &mut Vec<PrfItem>, target_uid: Option<&str>) -> Option<String> {
        let index = items.iter().position(|item| item.uid.as_deref() == target_uid)?;
        items.remove(index).file
    }

    pub async fn new() -> Self {
        let path = match dirs::profiles_path() {
            Ok(p) => p,
            Err(err) => {
                logging!(error, Type::Config, "{err}");
                return Self::default();
            }
        };

        match help::read_yaml::<Self>(&path).await {
            Ok(mut profiles) => {
                let items = profiles.items.get_or_insert_with(Vec::new);
                for item in items.iter_mut() {
                    if item.uid.is_none() {
                        item.uid = Some(help::get_uid("d").into());
                    }
                }
                profiles
            }
            Err(err) => {
                logging!(error, Type::Config, "{err}");
                Self::default()
            }
        }
    }

    pub async fn save_file(&self) -> Result<()> {
        help::save_yaml(&dirs::profiles_path()?, self, Some("# Profiles Config for Clash Verge")).await
    }

    /// 只修改current，valid和chain
    pub fn patch_config(&mut self, patch: &Self) {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        if let Some(current) = &patch.current
            && let Some(items) = self.items.as_ref()
        {
            let some_uid = Some(current);
            if items.iter().any(|e| e.uid.as_ref() == some_uid) {
                self.current = some_uid.cloned();
            }
        }
    }

    pub const fn get_current(&self) -> Option<&String> {
        self.current.as_ref()
    }

    /// get items ref
    pub const fn get_items(&self) -> Option<&Vec<PrfItem>> {
        self.items.as_ref()
    }

    /// find the item by the uid
    pub fn get_item(&self, uid: impl AsRef<str>) -> Result<&PrfItem> {
        let uid_str = uid.as_ref();

        if let Some(items) = self.items.as_ref() {
            for each in items.iter() {
                if let Some(uid_val) = &each.uid
                    && uid_val.as_str() == uid_str
                {
                    return Ok(each);
                }
            }
        }

        bail!("failed to get the profile item \"uid:{}\"", uid_str);
    }

    /// append new item
    /// if the file_data is some
    /// then should save the data to file
    pub async fn append_item(&mut self, item: &mut PrfItem) -> Result<()> {
        let uid = &item.uid;
        if uid.is_none() {
            bail!("the uid should not be null");
        }

        // save the file data
        // move the field value after save
        if let Some(file_data) = item.file_data.take() {
            if item.file.is_none() {
                bail!("the file should not be null");
            }

            let file = item
                .file
                .clone()
                .ok_or_else(|| anyhow::anyhow!("file field is required when file_data is provided"))?;
            let path = dirs::app_profiles_dir()?.join(file.as_str());

            fs::write(&path, file_data.as_bytes())
                .await
                .with_context(|| format!("failed to write to file \"{file}\""))?;
        }

        if self.current.is_none() && (item.itype == Some("remote".into()) || item.itype == Some("local".into())) {
            self.current = uid.to_owned();
        }

        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        if let Some(items) = self.items.as_mut() {
            items.push(item.to_owned());
        }

        Ok(())
    }

    /// reorder items
    pub async fn reorder(&mut self, active_id: &String, over_id: &String) -> Result<()> {
        let mut items = self.items.take().unwrap_or_default();
        let mut old_index = None;
        let mut new_index = None;

        for (i, _) in items.iter().enumerate() {
            if items[i].uid.as_ref() == Some(active_id) {
                old_index = Some(i);
            }
            if items[i].uid.as_ref() == Some(over_id) {
                new_index = Some(i);
            }
        }

        let (old_idx, new_idx) = match (old_index, new_index) {
            (Some(old), Some(new)) => (old, new),
            _ => return Ok(()),
        };
        let item = items.remove(old_idx);
        items.insert(new_idx, item);
        self.items = Some(items);
        self.save_file().await
    }

    /// update the item value
    pub async fn patch_item(&mut self, uid: &String, item: &PrfItem) -> Result<()> {
        if let Some(file) = &item.file {
            Self::validate_profile_file(file)?;
        }

        let mut items = self.items.take().unwrap_or_default();

        for each in items.iter_mut() {
            if each.uid.as_ref() == Some(uid) {
                patch!(each, item, itype);
                patch!(each, item, name);
                patch!(each, item, desc);
                patch!(each, item, file);
                patch!(each, item, url);
                patch!(each, item, selected);
                patch!(each, item, extra);
                patch!(each, item, updated);
                patch!(each, item, option);

                self.items = Some(items);
                return self.save_file().await;
            }
        }

        self.items = Some(items);
        bail!("failed to find the profile item \"uid:{uid}\"")
    }

    fn validate_profile_file(file: &str) -> Result<()> {
        let mut components = Path::new(file).components();
        if file.is_empty()
            || file.contains('/')
            || file.contains('\\')
            || !matches!(
                (components.next(), components.next()),
                (Some(Component::Normal(_)), None)
            )
        {
            bail!("profile file must be a single filename");
        }

        Ok(())
    }

    /// be used to update the remote item
    /// only patch `updated` `extra` `file_data`
    pub async fn update_item(&mut self, uid: &String, item: &mut PrfItem) -> Result<()> {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        // find the item
        let _ = self.get_item(uid)?;

        if let Some(items) = self.items.as_mut() {
            let some_uid = Some(uid.clone());

            for each in items.iter_mut() {
                if each.uid == some_uid {
                    each.extra = item.extra;
                    each.updated = item.updated;
                    each.home = item.home.to_owned();
                    each.option = PrfOption::merge(each.option.as_ref(), item.option.as_ref());
                    // save the file data
                    // move the field value after save
                    if let Some(file_data) = item.file_data.take() {
                        let file = each.file.take();
                        let file =
                            file.unwrap_or_else(|| item.file.take().unwrap_or_else(|| format!("{}.yaml", uid).into()));

                        // the file must exists
                        each.file = Some(file.clone());

                        let path = dirs::app_profiles_dir()?.join(file.as_str());

                        fs::write(&path, file_data.as_bytes())
                            .await
                            .with_context(|| format!("failed to write to file \"{file}\""))?;
                    }

                    break;
                }
            }
        }

        self.save_file().await
    }

    /// delete item
    /// if delete the current then return true
    pub async fn delete_item(&mut self, uid: &String) -> Result<bool> {
        let current = self.current.as_ref().unwrap_or(uid);
        let current = current.clone();
        let delete_uids = {
            let item = self.get_item(uid)?;
            let option = item.option.as_ref();
            option.map_or(Vec::new(), |op| {
                [
                    op.merge.clone(),
                    op.script.clone(),
                    op.rules.clone(),
                    op.proxies.clone(),
                    op.groups.clone(),
                ]
                .into_iter()
                .collect::<Vec<_>>()
            })
        };
        let mut items = self.items.take().unwrap_or_default();

        // remove the main item (if exists) and delete its file
        if let Some(file) = Self::take_item_file_by_uid(&mut items, Some(uid.as_str())) {
            let _ = dirs::app_profiles_dir()?.join(file.as_str()).remove_if_exists().await;
        }

        for delete_uid in delete_uids {
            if let Some(file) = Self::take_item_file_by_uid(&mut items, delete_uid.as_deref()) {
                let _ = dirs::app_profiles_dir()?.join(file.as_str()).remove_if_exists().await;
            }
        }

        // delete the original uid
        if current == *uid {
            self.current = None;
            for item in items.iter() {
                if item.itype == Some("remote".into()) || item.itype == Some("local".into()) {
                    self.current = item.uid.clone();
                    break;
                }
            }
        }

        self.items = Some(items);
        self.save_file().await?;
        Ok(current == *uid)
    }

    /// 获取current指向的订阅内容
    pub async fn current_mapping(&self) -> Result<Mapping> {
        match (self.current.as_ref(), self.items.as_ref()) {
            (Some(current), Some(items)) => {
                if let Some(item) = items.iter().find(|e| e.uid.as_ref() == Some(current)) {
                    let file_path = match item.file.as_ref() {
                        Some(file) => dirs::app_profiles_dir()?.join(file.as_str()),
                        None => bail!("failed to get the file field"),
                    };
                    return help::read_mapping(&file_path).await;
                }
                bail!("failed to find the current profile \"uid:{current}\"");
            }
            _ => Ok(Mapping::new()),
        }
    }

    /// 判断profile是否是current指向的
    pub fn is_current_profile_index(&self, index: &String) -> bool {
        self.current.as_ref() == Some(index)
    }

    /// 获取所有的profiles(uid，名称, 是否为 current)
    pub fn profiles_preview(&self) -> Option<Vec<IProfilePreview<'_>>> {
        self.items.as_ref().map(|items| {
            items
                .iter()
                .filter_map(|e| {
                    if let (Some(uid), Some(name)) = (e.uid.as_ref(), e.name.as_ref()) {
                        let is_current = self.is_current_profile_index(uid);
                        let preview = IProfilePreview { uid, name, is_current };
                        Some(preview)
                    } else {
                        None
                    }
                })
                .collect()
        })
    }

    /// 通过 uid 获取名称
    pub fn get_name_by_uid(&self, uid: &String) -> Option<&String> {
        if let Some(items) = &self.items {
            for item in items {
                if item.uid.as_ref() == Some(uid) {
                    return item.name.as_ref();
                }
            }
        }
        None
    }

    /// 以 app 中的 profile 列表为准，删除不再需要的文件
    pub async fn cleanup_orphaned_files(&self) -> Result<()> {
        let profiles_dir = dirs::app_profiles_dir()?;

        if !profiles_dir.exists() {
            return Ok(());
        }

        // 获取所有 active profile 的文件名集合
        let active_files = self.get_all_active_files();

        // 添加全局扩展配置文件到保护列表
        let protected_files = self.get_protected_global_files();

        // 扫描 profiles 目录下的所有文件
        let mut total_files = 0;
        let mut deleted_files = 0;
        let mut failed_deletions = 0;

        let mut dir_entries = tokio::fs::read_dir(&profiles_dir).await?;
        while let Some(entry) = dir_entries.next_entry().await? {
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            total_files += 1;

            if let Some(file_name) = path.file_name().and_then(|n| n.to_str())
                && Self::is_profile_file(file_name)
            {
                // 检查是否为全局扩展文件
                if protected_files.contains(file_name) {
                    logging!(debug, Type::Config, "保护全局扩展配置文件: {file_name}");
                    continue;
                }

                // 检查是否为活跃文件
                if !active_files.contains(file_name) {
                    match path.to_path_buf().remove_if_exists().await {
                        Ok(_) => {
                            deleted_files += 1;
                            logging!(debug, Type::Config, "已清理冗余文件: {file_name}");
                        }
                        Err(e) => {
                            failed_deletions += 1;
                            logging!(warn, Type::Config, "Warning: 清理文件失败: {file_name} - {e}");
                        }
                    }
                }
            }
        }

        let result = CleanupResult {
            total_files,
            deleted_files,
            failed_deletions,
        };

        logging!(
            info,
            Type::Config,
            "Profile 文件清理完成: 总文件数={}, 删除文件数={}, 失败数={}",
            result.total_files,
            result.deleted_files,
            result.failed_deletions
        );

        Ok(())
    }

    /// 不删除全局扩展配置
    fn get_protected_global_files(&self) -> HashSet<String> {
        let mut protected_files = HashSet::new();

        protected_files.insert("Merge.yaml".into());
        protected_files.insert("Script.js".into());

        protected_files
    }

    /// 获取所有 active profile 关联的文件名
    fn get_all_active_files(&self) -> HashSet<&str> {
        let mut active_files: HashSet<&str> = HashSet::new();

        if let Some(items) = &self.items {
            for item in items {
                // 收集所有类型 profile 的文件
                if let Some(file) = &item.file {
                    active_files.insert(file);
                }

                // 对于主 profile 类型（remote/local），还需要收集其关联的扩展文件
                if let Some(itype) = &item.itype
                    && (itype == "remote" || itype == "local")
                    && let Some(option) = &item.option
                {
                    // 收集关联的扩展文件
                    if let Some(merge_uid) = &option.merge
                        && let Ok(merge_item) = self.get_item(merge_uid)
                        && let Some(file) = &merge_item.file
                    {
                        active_files.insert(file);
                    }

                    if let Some(script_uid) = &option.script
                        && let Ok(script_item) = self.get_item(script_uid)
                        && let Some(file) = &script_item.file
                    {
                        active_files.insert(file);
                    }

                    if let Some(rules_uid) = &option.rules
                        && let Ok(rules_item) = self.get_item(rules_uid)
                        && let Some(file) = &rules_item.file
                    {
                        active_files.insert(file);
                    }

                    if let Some(proxies_uid) = &option.proxies
                        && let Ok(proxies_item) = self.get_item(proxies_uid)
                        && let Some(file) = &proxies_item.file
                    {
                        active_files.insert(file);
                    }

                    if let Some(groups_uid) = &option.groups
                        && let Ok(groups_item) = self.get_item(groups_uid)
                        && let Some(file) = &groups_item.file
                    {
                        active_files.insert(file);
                    }
                }
            }
        }

        active_files
    }

    /// 检查文件名是否符合 profile 文件的命名规则
    fn is_profile_file(filename: &str) -> bool {
        REGEX_PROFILE_FILE.is_match(filename)
    }
}

// 特殊的Send-safe helper函数，完全避免跨await持有guard
use crate::config::Config;

pub async fn profiles_append_item_with_filedata_safe(item: &PrfItem, file_data: Option<String>) -> Result<()> {
    let item = &mut PrfItem::from(item, file_data).await?;
    profiles_append_item_safe(item).await
}

pub async fn profiles_append_item_safe(item: &mut PrfItem) -> Result<()> {
    Config::profiles()
        .await
        .with_data_modify(|mut profiles| async move {
            profiles.append_item(item).await?;
            Ok((profiles, ()))
        })
        .await
}

pub async fn profiles_patch_item_safe(index: &String, item: &PrfItem) -> Result<()> {
    Config::profiles()
        .await
        .with_data_modify(|mut profiles| async move {
            profiles.patch_item(index, item).await?;
            Ok((profiles, ()))
        })
        .await
}

pub async fn profiles_delete_item_safe(index: &String) -> Result<bool> {
    Config::profiles()
        .await
        .with_data_modify(|mut profiles| async move {
            let deleted = profiles.delete_item(index).await?;
            Ok((profiles, deleted))
        })
        .await
}

pub async fn profiles_reorder_safe(active_id: &String, over_id: &String) -> Result<()> {
    Config::profiles()
        .await
        .with_data_modify(|mut profiles| async move {
            profiles.reorder(active_id, over_id).await?;
            Ok((profiles, ()))
        })
        .await
}

pub async fn profiles_save_file_safe() -> Result<()> {
    Config::profiles()
        .await
        .with_data_modify(|profiles| async move {
            profiles.save_file().await?;
            Ok((profiles, ()))
        })
        .await
}

pub async fn profiles_draft_update_item_safe(index: &String, item: &mut PrfItem) -> Result<()> {
    Config::profiles()
        .await
        .with_data_modify(|mut profiles| async move {
            profiles.update_item(index, item).await?;
            Ok((profiles, ()))
        })
        .await
}

#[derive(Debug, PartialEq, Eq)]
struct SelectedNodesPlan {
    selected: Vec<PrfSelected>,
    activations: Vec<(String, String)>,
    repaired_count: usize,
}

fn node_is_available(available_nodes: &[std::string::String], node: &str) -> bool {
    available_nodes.iter().any(|available| available == node)
}

fn selected_nodes_need_confirmation(selected: &[PrfSelected], proxies: &Proxies) -> bool {
    selected.iter().any(|selected_item| {
        let (Some(group_name), Some(node)) = (&selected_item.name, &selected_item.now) else {
            return false;
        };
        let Some(group) = proxies.proxies.get(group_name.as_str()) else {
            return true;
        };
        let Some(available_nodes) = group.all.as_deref().filter(|nodes| !nodes.is_empty()) else {
            return true;
        };
        !node_is_available(available_nodes, node)
    })
}

fn reconcile_selected_nodes(
    selected: &[PrfSelected],
    previous: Option<&Proxies>,
    proxies: &Proxies,
) -> SelectedNodesPlan {
    let mut plan = SelectedNodesPlan {
        selected: Vec::with_capacity(selected.len()),
        activations: Vec::new(),
        repaired_count: 0,
    };
    let mut seen_groups = HashSet::new();
    let mut unique_selected = selected
        .iter()
        .rev()
        .filter(|item| item.name.as_ref().is_some_and(|name| seen_groups.insert(name.clone())))
        .collect::<Vec<_>>();
    unique_selected.reverse();
    plan.repaired_count += selected.len() - unique_selected.len();

    for selected_item in unique_selected {
        let (Some(group_name), Some(node)) = (&selected_item.name, &selected_item.now) else {
            plan.repaired_count += 1;
            continue;
        };
        let Some(group) = proxies.proxies.get(group_name.as_str()) else {
            if previous.is_some_and(|snapshot| !snapshot.proxies.contains_key(group_name.as_str())) {
                plan.repaired_count += 1;
            } else {
                plan.selected.push(selected_item.clone());
            }
            continue;
        };
        let Some(available_nodes) = group.all.as_deref().filter(|nodes| !nodes.is_empty()) else {
            // Provider-backed groups can be temporarily incomplete immediately after a reload.
            plan.selected.push(selected_item.clone());
            continue;
        };
        // Smart cores report type "Smart", which deserializes as ProxyType::Unknown until the
        // mihomo plugin adds a dedicated variant. Manual fixed nodes still need re-activation.
        let is_selectable_group = matches!(
            &group.proxy_type,
            ProxyType::Selector | ProxyType::URLTest | ProxyType::Fallback | ProxyType::LoadBalance
        ) || group.proxy_type.as_str() == "Smart";
        if !is_selectable_group {
            let preferred_node = group
                .now
                .as_deref()
                .filter(|current| node_is_available(available_nodes, current))
                .or_else(|| node_is_available(available_nodes, node).then_some(node.as_str()));
            if let Some(preferred_node) = preferred_node {
                if preferred_node != node.as_str() {
                    plan.repaired_count += 1;
                }
                plan.selected.push(PrfSelected {
                    name: Some(group_name.clone()),
                    now: Some(preferred_node.into()),
                });
            } else {
                plan.repaired_count += 1;
            }
            continue;
        }

        if node_is_available(available_nodes, node) {
            plan.selected.push(selected_item.clone());
            if group.now.as_deref() != Some(node.as_str()) {
                plan.activations.push((group_name.clone(), node.clone()));
            }
            continue;
        }

        let missing_was_confirmed = previous
            .and_then(|snapshot| snapshot.proxies.get(group_name.as_str()))
            .and_then(|group| group.all.as_deref())
            .filter(|nodes| !nodes.is_empty())
            .is_some_and(|nodes| !node_is_available(nodes, node));
        if !missing_was_confirmed {
            plan.selected.push(selected_item.clone());
            continue;
        }

        plan.repaired_count += 1;
        if let Some(current_node) = group
            .now
            .as_deref()
            .filter(|current| node_is_available(available_nodes, current))
        {
            plan.selected.push(PrfSelected {
                name: Some(group_name.clone()),
                now: Some(current_node.into()),
            });
        }
    }

    plan
}

/// Abandon any activation still in flight.
///
/// An activation reads the profile, then polls the core until its groups are readable, then puts
/// its selections. A choice the user makes inside that window is newer than what the activation
/// captured, so letting it finish would push the core back to the older node — and the profile,
/// already holding the newer one, would then disagree with the core. Bumping the generation is
/// how an activation is told it has been overtaken.
///
/// Called *after* the profile is written, which is the only placement that needs to exist: an
/// activation that read the older profile is cancelled by this, and one starting afterwards reads
/// the newer one and needs no cancelling.
pub fn supersede_selected_activation() {
    ACTIVATE_SELECTED_GENERATION.fetch_add(1, Ordering::AcqRel);
}

fn is_activation_current(generation: u64) -> bool {
    ACTIVATE_SELECTED_GENERATION.load(Ordering::Acquire) == generation
}

async fn fetch_proxies_with_timeout() -> Result<Proxies> {
    tokio::time::timeout(MIHOMO_OPERATION_TIMEOUT, async {
        loop {
            match handle::Handle::mihomo().get_proxies().await {
                Ok(proxies) => return proxies,
                Err(err) => {
                    logging!(debug, Type::Config, "mihomo proxies are not ready yet: {err}");
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }
    })
    .await
    .context("timed out while waiting for mihomo proxies")
}

async fn select_node_with_timeout(group_name: &String, node: &String) -> Result<()> {
    tokio::time::timeout(MIHOMO_OPERATION_TIMEOUT, async {
        handle::Handle::mihomo().select_node_for_group(group_name, node).await
    })
    .await
    .with_context(|| format!("timed out while selecting node [{node}] for group [{group_name}]"))?
    .with_context(|| format!("failed to select node [{node}] for group [{group_name}]"))
}

fn remaining_activations(
    activations: &[(String, String)],
    completed: &HashMap<String, String>,
) -> Vec<(String, String)> {
    activations
        .iter()
        .filter(|(group_name, node)| completed.get(group_name) != Some(node))
        .cloned()
        .collect()
}

async fn apply_activations(
    activations: &[(String, String)],
    completed: &mut HashMap<String, String>,
    generation: u64,
) -> Option<usize> {
    let mut activated_count = 0;
    for (group_name, node) in remaining_activations(activations, completed) {
        if !is_activation_current(generation) {
            return None;
        }
        match select_node_with_timeout(&group_name, &node).await {
            Ok(()) => {
                if !is_activation_current(generation) {
                    return None;
                }
                logging!(
                    info,
                    Type::Config,
                    "Selected node for proxy: {group_name}, node: {node}"
                );
                completed.insert(group_name, node);
                activated_count += 1;
            }
            Err(err) => logging!(error, Type::Config, "{err:#}"),
        }
        if !is_activation_current(generation) {
            return None;
        }
    }
    Some(activated_count)
}

async fn update_tray_after_activation(generation: u64) {
    if !is_activation_current(generation) {
        return;
    }
    if let Err(err) = Tray::global().update_tooltip().await {
        logging!(
            warn,
            Type::Config,
            "failed to update tray tooltip after profile switch: {err:#}"
        );
    }

    if !is_activation_current(generation) {
        return;
    }
    if let Err(err) = Tray::global().update_menu().await {
        logging!(
            warn,
            Type::Config,
            "failed to update tray menu after profile switch: {err:#}"
        );
    }
}

/// Record which node a group is on, in the current profile.
///
/// The counterpart of the frontend's `useRecordSelection`, for the selections the backend makes
/// on the user's behalf — the tray is the one that does. What the profile holds is what
/// [`activate_selected_nodes`] re-applies when a core starts, so a selection it never learned
/// about is one the next start silently undoes.
pub async fn record_selected_node(group_name: &str, node: &str) -> Result<()> {
    let group_name = String::from(group_name);
    let node = String::from(node);
    let recorded = Config::profiles()
        .await
        .with_data_modify(move |mut profiles| async move {
            let Some(current) = profiles.current.clone() else {
                return Ok((profiles, false));
            };
            let Some(item) = profiles
                .items
                .as_mut()
                .and_then(|items| items.iter_mut().find(|item| item.uid.as_ref() == Some(&current)))
            else {
                return Ok((profiles, false));
            };

            let mut selected = item.selected.clone().unwrap_or_default();
            match selected
                .iter_mut()
                .find(|entry| entry.name.as_ref() == Some(&group_name))
            {
                Some(entry) => {
                    if entry.now.as_ref() == Some(&node) {
                        return Ok((profiles, false));
                    }
                    entry.now = Some(node);
                }
                None => selected.push(PrfSelected {
                    name: Some(group_name),
                    now: Some(node),
                }),
            }
            item.selected = Some(selected);
            profiles.save_file().await?;
            Ok((profiles, true))
        })
        .await?;

    if recorded {
        // Newer than anything an activation still in flight captured.
        supersede_selected_activation();
        handle::Handle::refresh_profiles();
    }
    Ok(())
}

/// Drop a group's selection from the current profile.
///
/// Used when unfixed a URLTest/Smart group: if the profile still holds the node, the next core
/// start re-applies it via [`activate_selected_nodes`] and the group is fixed again.
pub async fn clear_selected_node(group_name: &str) -> Result<()> {
    let group_name = String::from(group_name);
    let cleared = Config::profiles()
        .await
        .with_data_modify(move |mut profiles| async move {
            let Some(current) = profiles.current.clone() else {
                return Ok((profiles, false));
            };
            let Some(item) = profiles
                .items
                .as_mut()
                .and_then(|items| items.iter_mut().find(|item| item.uid.as_ref() == Some(&current)))
            else {
                return Ok((profiles, false));
            };

            let Some(selected) = item.selected.as_mut() else {
                return Ok((profiles, false));
            };
            let before = selected.len();
            selected.retain(|entry| entry.name.as_ref() != Some(&group_name));
            if selected.len() == before {
                return Ok((profiles, false));
            }
            if selected.is_empty() {
                item.selected = None;
            }
            profiles.save_file().await?;
            Ok((profiles, true))
        })
        .await?;

    if cleared {
        supersede_selected_activation();
        handle::Handle::refresh_profiles();
    }
    Ok(())
}

async fn persist_reconciled_selected(
    profile_uid: &String,
    original_selected: &[PrfSelected],
    selected: Vec<PrfSelected>,
    generation: u64,
) -> Result<()> {
    if !is_activation_current(generation) {
        return Ok(());
    }

    let profiles = Config::profiles().await;
    let profile_uid = profile_uid.clone();
    let original_selected = original_selected.to_vec();
    let updated = profiles
        .with_data_modify(move |mut profiles| async move {
            if !is_activation_current(generation) || profiles.current.as_ref() != Some(&profile_uid) {
                return Ok((profiles, false));
            }

            let profile = profiles
                .items
                .as_mut()
                .and_then(|items| items.iter_mut().find(|item| item.uid.as_ref() == Some(&profile_uid)))
                .with_context(|| format!("failed to find the profile item \"uid:{profile_uid}\""))?;
            if profile.selected.as_deref().unwrap_or(&[]) != original_selected.as_slice() {
                return Ok((profiles, false));
            }

            profile.selected = (!selected.is_empty()).then_some(selected);
            profiles.save_file().await?;
            Ok((profiles, true))
        })
        .await?;

    if updated {
        handle::Handle::refresh_profiles();
    }
    Ok(())
}

/// The recorded selections the core is not currently on.
///
/// Deliberately "is the core on it" rather than "did we send a select": a group whose provider
/// has not loaded is present but empty, a `select` can fail while the core is still settling, and
/// a group that was already correct never produces an activation at all. Only the running state
/// tells those apart.
fn unsettled_selections(selected: &[PrfSelected], proxies: &Proxies) -> Vec<String> {
    selected
        .iter()
        .filter_map(|item| {
            let (Some(group_name), Some(node)) = (&item.name, &item.now) else {
                return None;
            };
            match proxies.proxies.get(group_name.as_str()) {
                Some(group) if group.now.as_deref() == Some(node.as_str()) => None,
                _ => Some(group_name.clone()),
            }
        })
        .collect()
}

/// Keep putting back the selections the core could not be moved to yet.
///
/// The single re-check a profile switch needs is enough there, because a switch happens once the
/// configuration is loaded. A core start is the opposite case: the groups a restore is trying to
/// put back may not exist yet. Without this the restore reported success having applied nothing,
/// and the group stayed on the first entry of its `proxies:` list — the outcome restoring exists
/// to prevent.
///
/// Only ever reached with [`SelectionRepair::KeepRecords`]: a profile switch is entitled to
/// conclude that a group it cannot see is gone, so it has nothing to wait for.
async fn settle_pending_selections(selected: &[PrfSelected], completed: &mut HashMap<String, String>, generation: u64) {
    let deadline = Instant::now() + SELECTED_NODES_SETTLE_DEADLINE;
    loop {
        tokio::time::sleep(SELECTED_NODES_SETTLE_INTERVAL).await;
        if !is_activation_current(generation) {
            return;
        }
        let Ok(snapshot) = fetch_proxies_with_timeout().await else {
            // Unreachable core: the deadline still applies, so this cannot spin forever.
            if Instant::now() >= deadline {
                return;
            }
            continue;
        };
        if !is_activation_current(generation) {
            return;
        }

        let pending = unsettled_selections(selected, &snapshot);
        if pending.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            logging!(
                warn,
                Type::Config,
                "gave up putting back {} selected node(s) the core never loaded: {}",
                pending.len(),
                pending.iter().map(String::as_str).collect::<Vec<_>>().join(", ")
            );
            return;
        }

        let plan = reconcile_selected_nodes(selected, None, &snapshot);
        if apply_activations(&plan.activations, completed, generation)
            .await
            .is_none()
        {
            return;
        }
        if is_activation_current(generation) {
            handle::Handle::refresh_clash();
        }
    }
}

/// Fires once the selections that could be applied have been.
///
/// Dropping it without firing releases the waiter too: every way the worker can end early is a
/// way of saying "nothing more is coming", and a start that waits forever for one of them would
/// be a worse failure than the one this exists to prevent.
struct FirstPassSignal(Option<tokio::sync::oneshot::Sender<()>>);

impl FirstPassSignal {
    fn notify(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.send(());
        }
    }
}

async fn activate_selected_nodes_worker(
    profile_uid: String,
    selected: Vec<PrfSelected>,
    generation: u64,
    repair: SelectionRepair,
    mut first_pass_done: FirstPassSignal,
) -> Result<()> {
    let first_snapshot = fetch_proxies_with_timeout().await?;
    if !is_activation_current(generation) {
        return Ok(());
    }

    let needs_confirmation = selected_nodes_need_confirmation(&selected, &first_snapshot);
    let immediate_plan = reconcile_selected_nodes(&selected, None, &first_snapshot);
    logging!(
        debug,
        Type::Config,
        "immediate selected nodes activation plan: {immediate_plan:?}"
    );

    let mut completed_activations = HashMap::new();
    if apply_activations(&immediate_plan.activations, &mut completed_activations, generation)
        .await
        .is_none()
    {
        return Ok(());
    }

    if is_activation_current(generation) {
        handle::Handle::refresh_clash();
    }

    let plan = if needs_confirmation {
        tokio::time::sleep(SELECTED_NODES_RECHECK_DELAY).await;
        if !is_activation_current(generation) {
            return Ok(());
        }
        let second_snapshot = fetch_proxies_with_timeout().await?;
        if !is_activation_current(generation) {
            return Ok(());
        }
        let confirmed_plan = reconcile_selected_nodes(&selected, Some(&first_snapshot), &second_snapshot);
        logging!(
            debug,
            Type::Config,
            "confirmed selected nodes activation plan: {confirmed_plan:?}"
        );
        let Some(confirmed_activated_count) =
            apply_activations(&confirmed_plan.activations, &mut completed_activations, generation).await
        else {
            return Ok(());
        };
        if confirmed_activated_count > 0 && is_activation_current(generation) {
            handle::Handle::refresh_clash();
        }
        confirmed_plan
    } else {
        immediate_plan
    };
    if !is_activation_current(generation) {
        return Ok(());
    }

    if repair == SelectionRepair::KeepRecords {
        // Everything the core could be moved to has been. Whoever is waiting to point traffic
        // here may go; what is left needs the core to finish loading and cannot be waited on.
        first_pass_done.notify();
        settle_pending_selections(&selected, &mut completed_activations, generation).await;
        return Ok(());
    }

    if plan.repaired_count > 0 && is_activation_current(generation) {
        logging!(
            info,
            Type::Config,
            "repairing {} invalid selected node record(s) for profile {profile_uid}",
            plan.repaired_count
        );
        persist_reconciled_selected(&profile_uid, &selected, plan.selected, generation).await?;
    }

    Ok(())
}

/// Whether an activation may also prune the records it cannot match.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SelectionRepair {
    /// Drop records whose group or node the core does not have. Only safe once the configuration
    /// they belong to is known to be fully loaded, which is true right after a profile switch.
    Prune,
    /// Apply what can be applied and leave the records alone.
    ///
    /// What a core start needs. A provider-backed group can be empty or absent for seconds after
    /// the core comes up, and a record pruned on that evidence is gone from `profiles.yaml` for
    /// good — the provider finishing later cannot bring it back.
    KeepRecords,
}

pub fn activate_selected_nodes() -> Result<()> {
    // The first-pass signal is for callers that wait; a profile switch does not, and dropping
    // the receiver simply makes the send a no-op.
    drop(activate_selected_nodes_with(SelectionRepair::Prune));
    Ok(())
}

/// Put the profile's selections back before anything is pointed at the core.
///
/// Awaited, unlike a profile switch's activation, because the caller enables the system proxy as
/// soon as this returns: a proxy pointed at a core still sitting on the first entry of every
/// group is the outcome restoring exists to prevent. Bounded so that a core which will not answer
/// delays a start rather than blocking it — the selections keep being retried either way, and
/// being proxied through the wrong node beats not being proxied at all.
///
/// TUN is deliberately not covered, because it cannot be: it is configured in the core's own
/// file, so it is carrying traffic from the moment the process starts, before anything here could
/// run. What puts a TUN user on the right node from the first packet is the core's own
/// `cache.db`, which is why the service keeps an owner's runtime generation across restarts.
pub async fn restore_selected_nodes() {
    let first_pass = activate_selected_nodes_with(SelectionRepair::KeepRecords);
    if tokio::time::timeout(SELECTED_NODES_FIRST_PASS_BUDGET, first_pass)
        .await
        .is_err()
    {
        logging!(
            warn,
            Type::Config,
            "starting without having put the selected nodes back yet; still trying"
        );
    }
}

fn activate_selected_nodes_with(repair: SelectionRepair) -> tokio::sync::oneshot::Receiver<()> {
    logging!(info, Type::Config, "starting activating selected nodes");
    let mut active_task = ACTIVATE_SELECTED_TASK.lock();
    let generation = ACTIVATE_SELECTED_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    let previous_task = active_task.take();
    let (first_pass_sender, first_pass_done) = tokio::sync::oneshot::channel();

    let handle = tokio::spawn(async move {
        // Held for the whole task so that every exit — superseded, no profile, an error — drops
        // it and releases anyone waiting. Only the worker fires it deliberately.
        let first_pass = FirstPassSignal(Some(first_pass_sender));
        if let Some(previous_task) = previous_task {
            let _ = previous_task.await;
        }
        if !is_activation_current(generation) {
            return;
        }

        let result = async {
            // Committed, not the draft. A profile switch stages its target before validating
            // it, and a switch that then fails discards that draft — but an activation which had
            // already read it would go on to apply the rejected profile's selections to the one
            // still running. The switch that succeeds commits before it activates, so this is the
            // same value there.
            let profiles = Config::profiles().await.data_arc();
            let current = profiles.get_current().context("no current profile running")?.clone();
            let selected = profiles
                .get_item(&current)
                .context("failed to get current profile")?
                .selected
                .clone()
                .unwrap_or_default();

            if selected.is_empty() {
                if is_activation_current(generation) {
                    handle::Handle::refresh_clash();
                }
                return Ok(());
            }
            activate_selected_nodes_worker(current, selected, generation, repair, first_pass).await
        }
        .await;

        if is_activation_current(generation) {
            if let Err(err) = result {
                logging!(error, Type::Config, "failed to activate selected nodes: {err:#}");
                // The profile itself is already active even if node restoration failed.
                handle::Handle::refresh_clash();
            }
            update_tray_after_activation(generation).await;
            logging!(info, Type::Config, "activating selected nodes done!");
        }
    });
    *active_task = Some(handle);
    drop(active_task);
    first_pass_done
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_mihomo::models::Proxy;

    fn selected(group: &str, node: &str) -> PrfSelected {
        PrfSelected {
            name: Some(group.into()),
            now: Some(node.into()),
        }
    }

    fn proxies(groups: Vec<(&str, &[&str], Option<&str>)>) -> Proxies {
        Proxies {
            proxies: groups
                .into_iter()
                .map(|(name, all, now)| {
                    (
                        name.to_owned(),
                        Proxy {
                            name: name.to_owned(),
                            all: Some(all.iter().map(|node| (*node).to_owned()).collect()),
                            now: now.map(str::to_owned),
                            proxy_type: ProxyType::Selector,
                            ..Proxy::default()
                        },
                    )
                })
                .collect::<HashMap<_, _>>(),
        }
    }

    #[test]
    fn a_group_the_core_has_not_loaded_is_still_unsettled() {
        // The regression this pins. A provider-backed group is present but empty until its
        // provider loads, which on a cold start is exactly when restoring runs. Reconciling
        // produces no activation for it, so a restore that stopped after one re-check reported
        // success having left the group on the first entry of its `proxies:` list.
        let saved = vec![selected("provider-group", "saved")];
        let unloaded = proxies(vec![("provider-group", &[], None)]);

        assert!(
            reconcile_selected_nodes(&saved, Some(&unloaded), &unloaded)
                .activations
                .is_empty(),
            "nothing can be activated while the group is empty"
        );
        assert_eq!(
            unsettled_selections(&saved, &unloaded),
            vec![String::from("provider-group")],
            "so the restore must keep looking rather than call it done"
        );
    }

    #[test]
    fn a_group_the_core_is_already_on_is_settled() {
        let saved = vec![selected("Proxy", "Node A")];
        let loaded = proxies(vec![("Proxy", &["Node A", "Node B"], Some("Node A"))]);

        assert!(
            unsettled_selections(&saved, &loaded).is_empty(),
            "a group already on its node needs nothing, even though it produces no activation"
        );
    }

    #[test]
    fn a_group_on_the_wrong_node_is_unsettled() {
        // Covers a `select` that failed transiently: the group is loaded, the node exists, and
        // the core is simply not on it. Retrying is the only thing that fixes that.
        let saved = vec![selected("Proxy", "Node A")];
        let wrong = proxies(vec![("Proxy", &["Node A", "Node B"], Some("Node B"))]);

        assert_eq!(unsettled_selections(&saved, &wrong), vec![String::from("Proxy")]);
    }

    #[test]
    fn a_record_without_a_group_or_node_is_not_waited_on() {
        // A malformed record cannot be satisfied by waiting, and holding the settle loop open
        // for it would delay giving up on everything else.
        let malformed = vec![
            PrfSelected {
                name: Some("Proxy".into()),
                now: None,
            },
            PrfSelected {
                name: None,
                now: Some("Node A".into()),
            },
        ];

        assert!(unsettled_selections(&malformed, &proxies(vec![])).is_empty());
    }

    #[test]
    fn a_group_missing_from_both_snapshots_is_dropped_from_the_records() {
        // This is the pruning a profile switch wants and a core start must not do: the record is
        // gone from the plan, and `persist_reconciled_selected` writes the plan back. Pinned here
        // because it is why `SelectionRepair` exists — the predicate is right, the question is
        // only who is entitled to act on it.
        let saved = vec![selected("provider-group", "saved")];
        let empty = proxies(vec![]);

        let plan = reconcile_selected_nodes(&saved, Some(&empty), &empty);

        assert!(
            plan.selected.is_empty(),
            "a group absent from both looks invalid, so the record is dropped"
        );
        assert_eq!(plan.repaired_count, 1, "and dropping it counts as a repair");
    }

    #[test]
    fn a_group_missing_from_only_the_second_snapshot_is_kept() {
        // Absent once is not evidence: only a group that was already absent when the first
        // snapshot was taken is treated as gone.
        let saved = vec![selected("provider-group", "saved")];
        let had_it = proxies(vec![("provider-group", &["saved"], Some("saved"))]);
        let lost_it = proxies(vec![]);

        let plan = reconcile_selected_nodes(&saved, Some(&had_it), &lost_it);

        assert_eq!(plan.selected, saved);
        assert_eq!(plan.repaired_count, 0);
    }

    #[test]
    fn superseding_an_activation_makes_the_one_in_flight_stand_down() {
        // What a selection made during a start relies on: the restore that is still polling the
        // core has to notice it has been overtaken, or it will push the older node back.
        let generation = ACTIVATE_SELECTED_GENERATION.load(Ordering::Acquire) + 1;
        ACTIVATE_SELECTED_GENERATION.store(generation, Ordering::Release);
        assert!(is_activation_current(generation));

        supersede_selected_activation();

        assert!(
            !is_activation_current(generation),
            "an activation that has been overtaken must stop before it puts anything"
        );
    }

    #[test]
    fn keeps_valid_selection_and_activates_when_needed() {
        let saved = vec![selected("group", "saved")];
        let plan = reconcile_selected_nodes(
            &saved,
            None,
            &proxies(vec![("group", &["current", "saved"], Some("current"))]),
        );

        assert_eq!(plan.selected, saved);
        assert_eq!(plan.activations, vec![("group".into(), "saved".into())]);
        assert_eq!(plan.repaired_count, 0);
    }

    #[test]
    fn replaces_missing_node_with_valid_current_node() {
        let snapshot = proxies(vec![("group", &["current"], Some("current"))]);
        let plan = reconcile_selected_nodes(&[selected("group", "renamed-node")], Some(&snapshot), &snapshot);

        assert_eq!(plan.selected, vec![selected("group", "current")]);
        assert!(plan.activations.is_empty());
        assert_eq!(plan.repaired_count, 1);
    }

    #[test]
    fn validates_membership_in_group_not_global_existence() {
        let snapshot = proxies(vec![
            ("group", &["current"], Some("current")),
            ("other-node", &[], None),
        ]);
        let plan = reconcile_selected_nodes(&[selected("group", "other-node")], Some(&snapshot), &snapshot);

        assert_eq!(plan.selected, vec![selected("group", "current")]);
        assert!(plan.activations.is_empty());
        assert_eq!(plan.repaired_count, 1);
    }

    #[test]
    fn does_not_activate_non_selectable_groups() {
        let snapshot = Proxies {
            proxies: HashMap::from([(
                "group".to_owned(),
                Proxy {
                    name: "group".to_owned(),
                    all: Some(vec!["current".to_owned(), "saved".to_owned()]),
                    now: Some("current".to_owned()),
                    proxy_type: ProxyType::Direct,
                    ..Proxy::default()
                },
            )]),
        };

        let plan = reconcile_selected_nodes(&[selected("group", "saved")], None, &snapshot);

        assert_eq!(plan.selected, vec![selected("group", "current")]);
        assert!(plan.activations.is_empty());
        assert_eq!(plan.repaired_count, 1);
    }

    #[test]
    fn removes_selection_when_group_or_fallback_is_invalid() {
        let snapshot = proxies(vec![("group", &["valid"], Some("invalid-current"))]);
        let plan = reconcile_selected_nodes(
            &[
                selected("missing-group", "node"),
                selected("group", "missing-node"),
                PrfSelected::default(),
            ],
            Some(&snapshot),
            &snapshot,
        );

        assert!(plan.selected.is_empty());
        assert!(plan.activations.is_empty());
        assert_eq!(plan.repaired_count, 3);
    }

    #[test]
    fn preserves_selection_until_missing_node_is_confirmed() {
        let saved = vec![selected("group", "saved")];
        let incomplete = proxies(vec![("group", &[], None)]);
        let complete = proxies(vec![("group", &["current"], Some("current"))]);

        let incomplete_plan = reconcile_selected_nodes(&saved, None, &incomplete);
        let one_snapshot_plan = reconcile_selected_nodes(&saved, None, &complete);

        assert_eq!(incomplete_plan.selected, saved);
        assert_eq!(incomplete_plan.repaired_count, 0);
        assert_eq!(one_snapshot_plan.selected, saved);
        assert_eq!(one_snapshot_plan.repaired_count, 0);
    }

    #[test]
    fn recovers_when_group_appears_in_second_snapshot() {
        let saved = vec![selected("group", "saved")];
        let incomplete = Proxies::default();
        let complete = proxies(vec![("group", &["current", "saved"], Some("current"))]);

        let plan = reconcile_selected_nodes(&saved, Some(&incomplete), &complete);

        assert_eq!(plan.selected, saved);
        assert_eq!(plan.activations, vec![("group".into(), "saved".into())]);
        assert_eq!(plan.repaired_count, 0);
    }

    #[test]
    fn keeps_last_selection_for_duplicate_group_entries() {
        let saved = vec![selected("group", "old"), selected("group", "new")];
        let snapshot = proxies(vec![("group", &["old", "new"], Some("old"))]);

        let plan = reconcile_selected_nodes(&saved, None, &snapshot);

        assert_eq!(plan.selected, vec![selected("group", "new")]);
        assert_eq!(plan.activations, vec![("group".into(), "new".into())]);
        assert_eq!(plan.repaired_count, 1);
    }

    #[test]
    fn activates_valid_nodes_before_confirming_invalid_records() {
        let saved = vec![selected("valid-group", "saved"), selected("stale-group", "missing")];
        let first_snapshot = proxies(vec![
            ("valid-group", &["current", "saved"], Some("current")),
            ("stale-group", &["fallback"], Some("fallback")),
        ]);

        assert!(selected_nodes_need_confirmation(&saved, &first_snapshot));
        let immediate_plan = reconcile_selected_nodes(&saved, None, &first_snapshot);

        assert_eq!(immediate_plan.selected, saved);
        assert_eq!(immediate_plan.activations, vec![("valid-group".into(), "saved".into())]);
        assert_eq!(immediate_plan.repaired_count, 0);
    }

    #[test]
    fn skips_only_activations_that_already_succeeded() {
        let activations = vec![
            ("first-group".into(), "saved".into()),
            ("second-group".into(), "new".into()),
            ("first-group".into(), "replacement".into()),
        ];
        let completed = HashMap::from([("first-group".into(), "saved".into())]);

        assert_eq!(
            remaining_activations(&activations, &completed),
            vec![
                ("second-group".into(), "new".into()),
                ("first-group".into(), "replacement".into()),
            ]
        );
    }
}
