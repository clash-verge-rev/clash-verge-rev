use super::{PrfOption, prfitem::PrfItem};
use crate::utils::{
    dirs::{self, PathBufExec as _},
    help,
};
use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging};
use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::{collections::HashSet, sync::Arc};
use tokio::fs;

/// Define the `profiles.yaml` schema
#[derive(Default, Debug, Clone, Serialize)]
pub struct IProfiles {
    /// same as PrfConfig.current
    pub current: Option<String>,

    /// profile list
    #[serde(default, deserialize_with = "deserialize_items")]
    pub items: Option<IndexMap<String, PrfItem>>,
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
    pub deleted_files: Vec<String>,
    pub failed_deletions: Vec<String>,
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
    fn take_item_by_uid(&mut self, target_uid: Option<&String>) -> Option<PrfItem> {
        self.items.as_mut()?.shift_remove(target_uid?)
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
                let items = profiles.items.get_or_insert_with(IndexMap::new);
                let mut needs_save = false;

                for item in items.values_mut() {
                    if item.uid.is_none() {
                        item.uid = Some(help::get_uid("d").into());
                        needs_save = true;
                    }
                }

                // Auto-save after migration to persist the new IndexMap format
                if needs_save {
                    logging!(info, Type::Config, "Auto-saving profiles after migration");
                    if let Err(err) = profiles.save_file().await {
                        logging!(
                            warn,
                            Type::Config,
                            "Failed to auto-save migrated profiles: {}",
                            err
                        );
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
        help::save_yaml(
            &dirs::profiles_path()?,
            self,
            Some("# Profiles Config for Clash Verge"),
        )
        .await
    }

    /// 只修改current，valid和chain
    pub fn patch_config(&mut self, patch: &Self) {
        if self.items.is_none() {
            self.items = Some(IndexMap::new());
        }

        if let Some(current) = &patch.current
            && let Some(items) = self.items.as_ref()
        {
            let some_uid = Some(current);
            if items.iter().any(|e| e.1.uid.as_ref() == some_uid) {
                self.current = some_uid.cloned();
            }
        }
    }

    pub const fn get_current(&self) -> Option<&String> {
        self.current.as_ref()
    }

    /// get items ref
    pub const fn get_items(&self) -> Option<&IndexMap<String, PrfItem>> {
        self.items.as_ref()
    }

    /// find the item by the uid
    pub fn get_item(&self, uid: impl AsRef<str>) -> Result<&PrfItem> {
        self.items
            .as_ref()
            .and_then(|items| items.get(uid.as_ref()))
            .ok_or_else(|| {
                let uid_str = uid.as_ref();
                anyhow::anyhow!("failed to get the profile item \"uid:{}\"", uid_str)
            })
    }

    // TODO 或许可以优化掉 clone，或者和 get_item 合并
    pub fn get_item_arc(&self, uid: &str) -> Option<Arc<PrfItem>> {
        self.items
            .as_ref()
            .and_then(|items| items.get(uid).cloned().map(Arc::new))
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

            let file = item.file.clone().ok_or_else(|| {
                anyhow::anyhow!("file field is required when file_data is provided")
            })?;
            let path = dirs::app_profiles_dir()?.join(file.as_str());

            fs::write(&path, file_data.as_bytes())
                .await
                .with_context(|| format!("failed to write to file \"{file}\""))?;
        }

        if self.current.is_none()
            && (item.itype == Some("remote".into()) || item.itype == Some("local".into()))
        {
            self.current = uid.to_owned();
        }

        if self.items.is_none() {
            self.items = Some(IndexMap::new());
        }

        if let Some(items) = self.items.as_mut() {
            items.insert(item.uid.clone().unwrap_or_default(), item.to_owned());
        }

        Ok(())
    }

    /// reorder items
    pub async fn reorder(&mut self, active_id: &String, over_id: &String) -> Result<()> {
        let mut items = self.items.take().unwrap_or_default();
        let mut old_key = None;
        let mut new_key = None;

        for (key, item) in items.iter() {
            if item.uid.as_ref() == Some(active_id) {
                old_key = Some(key.clone());
            }
            if item.uid.as_ref() == Some(over_id) {
                new_key = Some(key.clone());
            }
        }

        let (old_key, new_key) = match (old_key, new_key) {
            (Some(old), Some(new)) => (old, new),
            _ => return Ok(()),
        };

        let old_index = items.get_index_of(&old_key);
        let new_index = items.get_index_of(&new_key);
        if let (Some(old_idx), Some(new_idx)) = (old_index, new_index) {
            items.move_index(old_idx, new_idx);
        }

        self.items = Some(items);
        self.save_file().await
    }

    /// update the item value
    pub async fn patch_item(&mut self, uid: &String, item: &PrfItem) -> Result<()> {
        let mut items = self.items.take().unwrap_or_default();

        if let Some(each) = items.get_mut(uid) {
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

        self.items = Some(items);
        bail!("failed to find the profile item \"uid:{uid}\"")
    }

    /// be used to update the remote item
    /// only patch `updated` `extra` `file_data`
    pub async fn update_item(&mut self, uid: &String, item: &PrfItem) -> Result<()> {
        let items = self.items.get_or_insert_with(IndexMap::new);

        let profile_item = items
            .get_mut(uid)
            .ok_or_else(|| anyhow::anyhow!("failed to find the profile item \"uid:{}\"", uid))?;

        profile_item.extra = item.extra;
        profile_item.updated = item.updated;
        profile_item.home = item.home.clone();
        profile_item.option = PrfOption::merge(profile_item.option.as_ref(), item.option.as_ref());

        if let Some(file_data) = &item.file_data {
            let file_name = if let Some(f) = profile_item.file.as_ref() {
                f.clone()
            } else {
                String::from(format!("{}.yaml", uid))
            };
            profile_item.file = Some(file_name.clone());
            let path = dirs::app_profiles_dir()?.join(file_name.as_str());
            fs::write(&path, file_data.as_bytes())
                .await
                .with_context(|| format!("failed to write to file \"{}\"", file_name))?;
        }

        self.save_file().await
    }

    /// delete item
    /// if delete the current then return true
    pub async fn delete_item(&mut self, uid: &String) -> Result<bool> {
        let is_current_uid = self.current.as_ref() == Some(uid);

        let item = match self.take_item_by_uid(Some(uid)) {
            Some(it) => it,
            None => return Ok(false),
        };

        let ext_uids = [
            item.option.as_ref().and_then(|o| o.merge.as_ref()),
            item.option.as_ref().and_then(|o| o.script.as_ref()),
            item.option.as_ref().and_then(|o| o.rules.as_ref()),
            item.option.as_ref().and_then(|o| o.proxies.as_ref()),
            item.option.as_ref().and_then(|o| o.groups.as_ref()),
        ];

        if let Some(file) = item.file.as_ref() {
            let _ = dirs::app_profiles_dir()?
                .join(file.as_str())
                .remove_if_exists()
                .await;
        }

        for ext_uid in ext_uids.iter().flatten() {
            if let Some(ext_item) = self.take_item_by_uid(Some(*ext_uid))
                && let Some(file) = ext_item.file
            {
                let _ = dirs::app_profiles_dir()?
                    .join(file.as_str())
                    .remove_if_exists()
                    .await;
            }
        }

        if is_current_uid {
            self.current = self.items.as_ref().and_then(|items| {
                items.iter().find_map(|(_, i)| {
                    let itype = i.itype.as_deref()?;
                    if itype == "remote" || itype == "local" {
                        i.uid.clone()
                    } else {
                        None
                    }
                })
            });
        }

        self.save_file().await?;
        Ok(is_current_uid)
    }

    /// 获取current指向的订阅内容
    pub async fn current_mapping(&self) -> Result<Mapping> {
        let current_uid = match &self.current {
            Some(uid) => uid,
            None => return Ok(Mapping::new()),
        };

        let items = match &self.items {
            Some(map) => map,
            None => return Ok(Mapping::new()),
        };

        let item = items.get(current_uid).ok_or_else(|| {
            anyhow::anyhow!("failed to find the current profile \"uid:{}\"", current_uid)
        })?;

        let file = item.file.as_ref().ok_or_else(|| {
            anyhow::anyhow!(
                "failed to get the file field for profile \"uid:{}\"",
                current_uid
            )
        })?;

        let path = dirs::app_profiles_dir()?.join(file.as_str());
        help::read_mapping(&path).await
    }

    /// 判断profile是否是current指向的
    pub fn is_current_profile_index(&self, index: &String) -> bool {
        self.current.as_ref() == Some(index)
    }

    /// 获取所有的profiles(uid，名称, 是否为 current)
    pub fn profiles_preview(&self) -> Option<Vec<IProfilePreview<'_>>> {
        self.items.as_ref().map(|items| {
            items
                .values()
                .filter_map(|item| {
                    let uid = item.uid.as_ref()?;
                    let name = item.name.as_ref()?;
                    let is_current = self.current.as_ref() == Some(uid);
                    Some(IProfilePreview {
                        uid,
                        name,
                        is_current,
                    })
                })
                .collect()
        })
    }

    /// 通过 uid 获取名称
    pub fn get_name_by_uid(&self, uid: &String) -> Option<&String> {
        self.items
            .as_ref()
            .and_then(|items| items.get(uid))
            .and_then(|item| item.name.as_ref())
    }

    /// 以 app 中的 profile 列表为准，删除不再需要的文件
    pub async fn cleanup_orphaned_files(&self) -> Result<CleanupResult> {
        let profiles_dir = dirs::app_profiles_dir()?;

        if !profiles_dir.exists() {
            return Ok(CleanupResult {
                total_files: 0,
                deleted_files: vec![],
                failed_deletions: vec![],
            });
        }

        // 获取所有 active profile 的文件名集合
        let active_files = self.get_all_active_files();

        // 添加全局扩展配置文件到保护列表
        let protected_files = self.get_protected_global_files();

        // 扫描 profiles 目录下的所有文件
        let mut total_files = 0;
        let mut deleted_files = vec![];
        let mut failed_deletions = vec![];

        for entry in std::fs::read_dir(&profiles_dir)? {
            let entry = entry?;
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
                            deleted_files.push(file_name.into());
                            logging!(info, Type::Config, "已清理冗余文件: {file_name}");
                        }
                        Err(e) => {
                            failed_deletions.push(format!("{file_name}: {e}").into());
                            logging!(
                                warn,
                                Type::Config,
                                "Warning: 清理文件失败: {file_name} - {e}"
                            );
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
            result.deleted_files.len(),
            result.failed_deletions.len()
        );

        Ok(result)
    }

    /// 不删除全局扩展配置
    fn get_protected_global_files(&self) -> HashSet<String> {
        let mut protected_files = HashSet::new();

        protected_files.insert("Merge.yaml".into());
        protected_files.insert("Script.js".into());

        protected_files
    }

    fn get_all_active_files(&self) -> HashSet<&str> {
        let mut active_files: HashSet<&str> = HashSet::new();

        if let Some(items) = &self.items {
            for item in items.values() {
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
        // 匹配各种 profile 文件格式
        // R12345678.yaml (remote)
        // L12345678.yaml (local)
        // m12345678.yaml (merge)
        // s12345678.js (script)
        // r12345678.yaml (rules)
        // p12345678.yaml (proxies)
        // g12345678.yaml (groups)

        let patterns = [
            r"^[RL][a-zA-Z0-9]+\.yaml$",  // Remote/Local profiles
            r"^m[a-zA-Z0-9]+\.yaml$",     // Merge files
            r"^s[a-zA-Z0-9]+\.js$",       // Script files
            r"^[rpg][a-zA-Z0-9]+\.yaml$", // Rules/Proxies/Groups files
        ];

        patterns.iter().any(|pattern| {
            regex::Regex::new(pattern)
                .map(|re| re.is_match(filename))
                .unwrap_or(false)
        })
    }
}

// 特殊的Send-safe helper函数，完全避免跨await持有guard
use crate::config::Config;

pub async fn profiles_append_item_with_filedata_safe(
    item: &PrfItem,
    file_data: Option<String>,
) -> Result<()> {
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

fn deserialize_items<'de, D>(deserializer: D) -> Result<Option<IndexMap<String, PrfItem>>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ItemsFormat {
        Map(IndexMap<String, PrfItem>),
        Vec(Vec<PrfItem>),
    }

    let value = Option::<ItemsFormat>::deserialize(deserializer)?;

    match value {
        None => Ok(None),
        Some(ItemsFormat::Map(map)) => Ok(Some(map)),
        Some(ItemsFormat::Vec(vec)) => {
            let mut map = IndexMap::new();
            for item in vec {
                if let Some(uid) = &item.uid {
                    map.insert(uid.clone(), item);
                } else {
                    logging!(
                        warn,
                        Type::Config,
                        "Skipping profile item without uid during migration"
                    );
                }
            }
            logging!(
                info,
                Type::Config,
                "Migrated {} profile items from Vec to IndexMap",
                map.len()
            );
            Ok(Some(map))
        }
    }
}

impl<'de> Deserialize<'de> for IProfiles {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct IProfilesHelper {
            current: Option<String>,
            #[serde(default, deserialize_with = "deserialize_items")]
            items: Option<IndexMap<String, PrfItem>>,
        }

        let helper = IProfilesHelper::deserialize(deserializer)?;
        Ok(Self {
            current: helper.current,
            items: helper.items,
        })
    }
}
