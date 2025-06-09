use super::{prfitem::PrfItem, PrfOption};
use crate::utils::{dirs, help};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::{collections::HashSet, fs, io::Write};

/// Define the `profiles.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IProfiles {
    /// same as PrfConfig.current
    pub current: Option<String>,

    /// profile list
    pub items: Option<Vec<PrfItem>>,
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
            $lv.$key = $rv.$key;
        }
    };
}

impl IProfiles {
    pub fn new() -> Self {
        match dirs::profiles_path().and_then(|path| help::read_yaml::<Self>(&path)) {
            Ok(mut profiles) => {
                if profiles.items.is_none() {
                    profiles.items = Some(vec![]);
                }
                // compatible with the old old old version
                if let Some(items) = profiles.items.as_mut() {
                    for item in items.iter_mut() {
                        if item.uid.is_none() {
                            item.uid = Some(help::get_uid("d"));
                        }
                    }
                }
                profiles
            }
            Err(err) => {
                log::error!(target: "app", "{err}");
                Self::template()
            }
        }
    }

    pub fn template() -> Self {
        Self {
            items: Some(vec![]),
            ..Self::default()
        }
    }

    pub fn save_file(&self) -> Result<()> {
        help::save_yaml(
            &dirs::profiles_path()?,
            self,
            Some("# Profiles Config for Clash Verge"),
        )
    }

    /// 只修改current，valid和chain
    pub fn patch_config(&mut self, patch: IProfiles) -> Result<()> {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        if let Some(current) = patch.current {
            let items = self.items.as_ref().unwrap();
            let some_uid = Some(current);
            if items.iter().any(|e| e.uid == some_uid) {
                self.current = some_uid;
            }
        }

        Ok(())
    }

    pub fn get_current(&self) -> Option<String> {
        self.current.clone()
    }

    /// get items ref
    pub fn get_items(&self) -> Option<&Vec<PrfItem>> {
        self.items.as_ref()
    }

    /// find the item by the uid
    pub fn get_item(&self, uid: &String) -> Result<&PrfItem> {
        if let Some(items) = self.items.as_ref() {
            let some_uid = Some(uid.clone());

            for each in items.iter() {
                if each.uid == some_uid {
                    return Ok(each);
                }
            }
        }

        bail!("failed to get the profile item \"uid:{uid}\"");
    }

    /// append new item
    /// if the file_data is some
    /// then should save the data to file
    pub fn append_item(&mut self, mut item: PrfItem) -> Result<()> {
        if item.uid.is_none() {
            bail!("the uid should not be null");
        }
        let uid = item.uid.clone();

        // save the file data
        // move the field value after save
        if let Some(file_data) = item.file_data.take() {
            if item.file.is_none() {
                bail!("the file should not be null");
            }

            let file = item.file.clone().unwrap();
            let path = dirs::app_profiles_dir()?.join(&file);

            fs::File::create(path)
                .with_context(|| format!("failed to create file \"{}\"", file))?
                .write(file_data.as_bytes())
                .with_context(|| format!("failed to write to file \"{}\"", file))?;
        }

        if self.current.is_none()
            && (item.itype == Some("remote".to_string()) || item.itype == Some("local".to_string()))
        {
            self.current = uid;
        }

        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        if let Some(items) = self.items.as_mut() {
            items.push(item)
        }

        self.save_file()
    }

    /// reorder items
    pub fn reorder(&mut self, active_id: String, over_id: String) -> Result<()> {
        let mut items = self.items.take().unwrap_or_default();
        let mut old_index = None;
        let mut new_index = None;

        for (i, _) in items.iter().enumerate() {
            if items[i].uid == Some(active_id.clone()) {
                old_index = Some(i);
            }
            if items[i].uid == Some(over_id.clone()) {
                new_index = Some(i);
            }
        }

        if old_index.is_none() || new_index.is_none() {
            return Ok(());
        }
        let item = items.remove(old_index.unwrap());
        items.insert(new_index.unwrap(), item);
        self.items = Some(items);
        self.save_file()
    }

    /// update the item value
    pub fn patch_item(&mut self, uid: String, item: PrfItem) -> Result<()> {
        let mut items = self.items.take().unwrap_or_default();

        for each in items.iter_mut() {
            if each.uid == Some(uid.clone()) {
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
                return self.save_file();
            }
        }

        self.items = Some(items);
        bail!("failed to find the profile item \"uid:{uid}\"")
    }

    /// be used to update the remote item
    /// only patch `updated` `extra` `file_data`
    pub fn update_item(&mut self, uid: String, mut item: PrfItem) -> Result<()> {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        // find the item
        let _ = self.get_item(&uid)?;

        if let Some(items) = self.items.as_mut() {
            let some_uid = Some(uid.clone());

            for each in items.iter_mut() {
                if each.uid == some_uid {
                    each.extra = item.extra;
                    each.updated = item.updated;
                    each.home = item.home;
                    each.option = PrfOption::merge(each.option.clone(), item.option);
                    // save the file data
                    // move the field value after save
                    if let Some(file_data) = item.file_data.take() {
                        let file = each.file.take();
                        let file =
                            file.unwrap_or(item.file.take().unwrap_or(format!("{}.yaml", &uid)));

                        // the file must exists
                        each.file = Some(file.clone());

                        let path = dirs::app_profiles_dir()?.join(&file);

                        fs::File::create(path)
                            .with_context(|| format!("failed to create file \"{}\"", file))?
                            .write(file_data.as_bytes())
                            .with_context(|| format!("failed to write to file \"{}\"", file))?;
                    }

                    break;
                }
            }
        }

        self.save_file()
    }

    /// delete item
    /// if delete the current then return true
    pub fn delete_item(&mut self, uid: String) -> Result<bool> {
        let current = self.current.as_ref().unwrap_or(&uid);
        let current = current.clone();
        let item = self.get_item(&uid)?;
        let merge_uid = item.option.as_ref().and_then(|e| e.merge.clone());
        let script_uid = item.option.as_ref().and_then(|e| e.script.clone());
        let rules_uid = item.option.as_ref().and_then(|e| e.rules.clone());
        let proxies_uid = item.option.as_ref().and_then(|e| e.proxies.clone());
        let groups_uid = item.option.as_ref().and_then(|e| e.groups.clone());
        let mut items = self.items.take().unwrap_or_default();
        let mut index = None;
        let mut merge_index = None;
        let mut script_index = None;
        let mut rules_index = None;
        let mut proxies_index = None;
        let mut groups_index = None;

        // get the index
        for (i, _) in items.iter().enumerate() {
            if items[i].uid == Some(uid.clone()) {
                index = Some(i);
                break;
            }
        }
        if let Some(index) = index {
            if let Some(file) = items.remove(index).file {
                let _ = dirs::app_profiles_dir().map(|path| {
                    let path = path.join(file);
                    if path.exists() {
                        let _ = fs::remove_file(path);
                    }
                });
            }
        }
        // get the merge index
        for (i, _) in items.iter().enumerate() {
            if items[i].uid == merge_uid {
                merge_index = Some(i);
                break;
            }
        }
        if let Some(index) = merge_index {
            if let Some(file) = items.remove(index).file {
                let _ = dirs::app_profiles_dir().map(|path| {
                    let path = path.join(file);
                    if path.exists() {
                        let _ = fs::remove_file(path);
                    }
                });
            }
        }
        // get the script index
        for (i, _) in items.iter().enumerate() {
            if items[i].uid == script_uid {
                script_index = Some(i);
                break;
            }
        }
        if let Some(index) = script_index {
            if let Some(file) = items.remove(index).file {
                let _ = dirs::app_profiles_dir().map(|path| {
                    let path = path.join(file);
                    if path.exists() {
                        let _ = fs::remove_file(path);
                    }
                });
            }
        }
        // get the rules index
        for (i, _) in items.iter().enumerate() {
            if items[i].uid == rules_uid {
                rules_index = Some(i);
                break;
            }
        }
        if let Some(index) = rules_index {
            if let Some(file) = items.remove(index).file {
                let _ = dirs::app_profiles_dir().map(|path| {
                    let path = path.join(file);
                    if path.exists() {
                        let _ = fs::remove_file(path);
                    }
                });
            }
        }
        // get the proxies index
        for (i, _) in items.iter().enumerate() {
            if items[i].uid == proxies_uid {
                proxies_index = Some(i);
                break;
            }
        }
        if let Some(index) = proxies_index {
            if let Some(file) = items.remove(index).file {
                let _ = dirs::app_profiles_dir().map(|path| {
                    let path = path.join(file);
                    if path.exists() {
                        let _ = fs::remove_file(path);
                    }
                });
            }
        }
        // get the groups index
        for (i, _) in items.iter().enumerate() {
            if items[i].uid == groups_uid {
                groups_index = Some(i);
                break;
            }
        }
        if let Some(index) = groups_index {
            if let Some(file) = items.remove(index).file {
                let _ = dirs::app_profiles_dir().map(|path| {
                    let path = path.join(file);
                    if path.exists() {
                        let _ = fs::remove_file(path);
                    }
                });
            }
        }
        // delete the original uid
        if current == uid {
            self.current = None;
            for item in items.iter() {
                if item.itype == Some("remote".to_string())
                    || item.itype == Some("local".to_string())
                {
                    self.current = item.uid.clone();
                    break;
                }
            }
        }

        self.items = Some(items);
        self.save_file()?;
        Ok(current == uid)
    }

    /// 获取current指向的订阅内容
    pub fn current_mapping(&self) -> Result<Mapping> {
        match (self.current.as_ref(), self.items.as_ref()) {
            (Some(current), Some(items)) => {
                if let Some(item) = items.iter().find(|e| e.uid.as_ref() == Some(current)) {
                    let file_path = match item.file.as_ref() {
                        Some(file) => dirs::app_profiles_dir()?.join(file),
                        None => bail!("failed to get the file field"),
                    };
                    return help::read_mapping(&file_path);
                }
                bail!("failed to find the current profile \"uid:{current}\"");
            }
            _ => Ok(Mapping::new()),
        }
    }

    /// 获取current指向的订阅的merge
    pub fn current_merge(&self) -> Option<String> {
        match (self.current.as_ref(), self.items.as_ref()) {
            (Some(current), Some(items)) => {
                if let Some(item) = items.iter().find(|e| e.uid.as_ref() == Some(current)) {
                    let merge = item.option.as_ref().and_then(|e| e.merge.clone());
                    return merge;
                }
                None
            }
            _ => None,
        }
    }

    /// 获取current指向的订阅的script
    pub fn current_script(&self) -> Option<String> {
        match (self.current.as_ref(), self.items.as_ref()) {
            (Some(current), Some(items)) => {
                if let Some(item) = items.iter().find(|e| e.uid.as_ref() == Some(current)) {
                    let script = item.option.as_ref().and_then(|e| e.script.clone());
                    return script;
                }
                None
            }
            _ => None,
        }
    }

    /// 获取current指向的订阅的rules
    pub fn current_rules(&self) -> Option<String> {
        match (self.current.as_ref(), self.items.as_ref()) {
            (Some(current), Some(items)) => {
                if let Some(item) = items.iter().find(|e| e.uid.as_ref() == Some(current)) {
                    let rules = item.option.as_ref().and_then(|e| e.rules.clone());
                    return rules;
                }
                None
            }
            _ => None,
        }
    }

    /// 获取current指向的订阅的proxies
    pub fn current_proxies(&self) -> Option<String> {
        match (self.current.as_ref(), self.items.as_ref()) {
            (Some(current), Some(items)) => {
                if let Some(item) = items.iter().find(|e| e.uid.as_ref() == Some(current)) {
                    let proxies = item.option.as_ref().and_then(|e| e.proxies.clone());
                    return proxies;
                }
                None
            }
            _ => None,
        }
    }

    /// 获取current指向的订阅的groups
    pub fn current_groups(&self) -> Option<String> {
        match (self.current.as_ref(), self.items.as_ref()) {
            (Some(current), Some(items)) => {
                if let Some(item) = items.iter().find(|e| e.uid.as_ref() == Some(current)) {
                    let groups = item.option.as_ref().and_then(|e| e.groups.clone());
                    return groups;
                }
                None
            }
            _ => None,
        }
    }

    /// 判断profile是否是current指向的
    pub fn is_current_profile_index(&self, index: String) -> bool {
        self.current == Some(index)
    }

    /// 获取所有的profiles(uid，名称)
    pub fn all_profile_uid_and_name(&self) -> Option<Vec<(String, String)>> {
        self.items.as_ref().map(|items| {
            items
                .iter()
                .filter_map(|e| {
                    if let (Some(uid), Some(name)) = (e.uid.clone(), e.name.clone()) {
                        Some((uid, name))
                    } else {
                        None
                    }
                })
                .collect()
        })
    }

    /// 以 app 中的 profile 列表为准，删除不再需要的文件
    pub fn cleanup_orphaned_files(&self) -> Result<CleanupResult> {
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

            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if Self::is_profile_file(file_name) {
                    // 检查是否为全局扩展文件
                    if protected_files.contains(file_name) {
                        log::debug!(target: "app", "保护全局扩展配置文件: {}", file_name);
                        continue;
                    }

                    // 检查是否为活跃文件
                    if !active_files.contains(file_name) {
                        match std::fs::remove_file(&path) {
                            Ok(_) => {
                                deleted_files.push(file_name.to_string());
                                log::info!(target: "app", "已清理冗余文件: {}", file_name);
                            }
                            Err(e) => {
                                failed_deletions.push(format!("{}: {}", file_name, e));
                                log::warn!(target: "app", "清理文件失败: {} - {}", file_name, e);
                            }
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

        log::info!(
            target: "app",
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

        protected_files.insert("Merge.yaml".to_string());
        protected_files.insert("Script.js".to_string());

        protected_files
    }

    /// 获取所有 active profile 关联的文件名
    fn get_all_active_files(&self) -> HashSet<String> {
        let mut active_files = HashSet::new();

        if let Some(items) = &self.items {
            for item in items {
                // 收集所有类型 profile 的文件
                if let Some(file) = &item.file {
                    active_files.insert(file.clone());
                }

                // 对于主 profile 类型（remote/local），还需要收集其关联的扩展文件
                if let Some(itype) = &item.itype {
                    if itype == "remote" || itype == "local" {
                        if let Some(option) = &item.option {
                            // 收集关联的扩展文件
                            if let Some(merge_uid) = &option.merge {
                                if let Ok(merge_item) = self.get_item(merge_uid) {
                                    if let Some(file) = &merge_item.file {
                                        active_files.insert(file.clone());
                                    }
                                }
                            }

                            if let Some(script_uid) = &option.script {
                                if let Ok(script_item) = self.get_item(script_uid) {
                                    if let Some(file) = &script_item.file {
                                        active_files.insert(file.clone());
                                    }
                                }
                            }

                            if let Some(rules_uid) = &option.rules {
                                if let Ok(rules_item) = self.get_item(rules_uid) {
                                    if let Some(file) = &rules_item.file {
                                        active_files.insert(file.clone());
                                    }
                                }
                            }

                            if let Some(proxies_uid) = &option.proxies {
                                if let Ok(proxies_item) = self.get_item(proxies_uid) {
                                    if let Some(file) = &proxies_item.file {
                                        active_files.insert(file.clone());
                                    }
                                }
                            }

                            if let Some(groups_uid) = &option.groups {
                                if let Ok(groups_item) = self.get_item(groups_uid) {
                                    if let Some(file) = &groups_item.file {
                                        active_files.insert(file.clone());
                                    }
                                }
                            }
                        }
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

    pub fn auto_cleanup(&self) -> Result<()> {
        match self.cleanup_orphaned_files() {
            Ok(result) => {
                if !result.deleted_files.is_empty() {
                    log::info!(
                        target: "app",
                        "自动清理完成，删除了 {} 个冗余文件",
                        result.deleted_files.len()
                    );
                }
                Ok(())
            }
            Err(e) => {
                log::warn!(target: "app", "自动清理失败: {}", e);
                Ok(())
            }
        }
    }
}
