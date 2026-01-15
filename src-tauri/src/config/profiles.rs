use super::{PrfOption, prfitem::PrfItem};
use crate::utils::{
    dirs::{self, PathBufExec as _},
    help,
};
use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::collections::{HashMap, HashSet};
use tokio::fs;

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
    pub async fn reorder(&mut self, active_id: &str, over_id: &str) -> Result<()> {
        if active_id == over_id {
            return Ok(());
        }

        let Some(items) = self.items.as_mut() else {
            return Ok(());
        };

        let mut old_idx = None;
        let mut new_idx = None;

        for (i, item) in items.iter().enumerate() {
            if let Some(uid) = item.uid.as_ref() {
                if uid == active_id {
                    old_idx = Some(i);
                }
                if uid == over_id {
                    new_idx = Some(i);
                }
            }
            if old_idx.is_some() && new_idx.is_some() {
                break;
            }
        }

        if let (Some(old), Some(new)) = (old_idx, new_idx) {
            if old < new {
                items[old..=new].rotate_left(1);
            } else {
                items[new..=old].rotate_right(1);
            }

            return self.save_file().await;
        }

        Ok(())
    }

    /// update the item value
    pub async fn patch_item(&mut self, uid: &String, item: &PrfItem) -> Result<()> {
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
                            file.unwrap_or_else(|| item.file.take().unwrap_or_else(|| format!("{}.yaml", &uid).into()));

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
        let uids_to_remove: HashSet<String> = {
            let item = self.get_item(uid)?;
            let mut set = HashSet::new();
            set.insert(uid.clone());

            if let Some(opt) = &item.option {
                if let Some(u) = &opt.merge {
                    set.insert(u.clone());
                }
                if let Some(u) = &opt.script {
                    set.insert(u.clone());
                }
                if let Some(u) = &opt.rules {
                    set.insert(u.clone());
                }
                if let Some(u) = &opt.proxies {
                    set.insert(u.clone());
                }
                if let Some(u) = &opt.groups {
                    set.insert(u.clone());
                }
            }
            set
        };

        let mut items = self.items.take().unwrap_or_default();
        let mut deleted_files = Vec::new();

        items.retain_mut(|item| {
            if let Some(item_uid) = item.uid.as_ref()
                && uids_to_remove.contains(item_uid)
            {
                if let Some(file) = item.file.take() {
                    deleted_files.push(file);
                }
                return false;
            }
            true
        });

        let is_deleting_current = self.current.as_ref() == Some(uid);
        if is_deleting_current {
            self.current = items
                .iter()
                .find(|i| i.itype.as_deref() == Some("remote") || i.itype.as_deref() == Some("local"))
                .and_then(|i| i.uid.clone());
        }

        self.items = Some(items);

        if let Ok(profile_dir) = dirs::app_profiles_dir() {
            for file in deleted_files {
                let _ = profile_dir.join(file.as_str()).remove_if_exists().await;
            }
        }

        self.save_file().await?;
        Ok(is_deleting_current)
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
                            logging!(debug, Type::Config, "已清理冗余文件: {file_name}");
                        }
                        Err(e) => {
                            failed_deletions.push(format!("{file_name}: {e}").into());
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

    /// 获取所有 active profile 关联的文件名
    fn get_all_active_files(&self) -> HashSet<&str> {
        let mut active_files = HashSet::new();
        let items = match &self.items {
            Some(i) => i,
            None => return active_files,
        };

        let item_map: HashMap<Option<&str>, &PrfItem> = items.iter().map(|i| (i.uid.as_deref(), i)).collect();

        for item in items {
            if let Some(f) = &item.file {
                active_files.insert(f.as_str());
            }

            let Some(opt) = &item.option else {
                continue;
            };

            let related = [
                opt.merge.as_deref(),
                opt.script.as_deref(),
                opt.rules.as_deref(),
                opt.proxies.as_deref(),
                opt.groups.as_deref(),
            ];

            for r_uid in related.into_iter().flatten() {
                if let Some(r_item) = item_map.get(&Some(r_uid))
                    && let Some(f) = &r_item.file
                {
                    active_files.insert(f.as_str());
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
