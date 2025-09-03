use super::{EnableFilter, PrfItem};
use crate::{
    any_err,
    config::ProfileType,
    enhance::chain::{ChainItem, ScopeType},
    error::{AppError, AppResult},
    log_err,
    utils::{dirs, help},
};
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::{collections::HashMap, fs, io::Write, path::PathBuf};

/// Define the `profiles.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IProfiles {
    /// same as PrfConfig.current
    pub current: Option<String>,

    /// same as PrfConfig.chain
    pub chain: Option<Vec<String>>,

    /// profile list
    pub items: Option<Vec<PrfItem>>,
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

                // This is old bug since 2.0.0 ~ 2.1.4 version
                // clear profile data and delete invalid profile files
                let mut save_file = false;
                let mut available_files = Vec::new();

                let enabled_global_chain = profiles.chain.as_deref().unwrap_or_default();
                // compatible with the old old old version
                if let Some(items) = profiles.items.as_mut() {
                    let items_ = items.clone();
                    let all_uids: Vec<String> = items_.iter().filter_map(|i| i.uid.clone()).collect();
                    available_files = items_.iter().filter_map(|i| i.file.clone()).collect();
                    for item in items.iter_mut() {
                        if item.uid.is_none() {
                            item.uid = Some(help::get_uid("d"));
                        }
                        if let Some(chain) = item.chain.as_mut() {
                            // This is old bug since 2.0.0 ~ 2.1.4 version
                            // remove invalid chains
                            chain.retain(|i| all_uids.contains(i));
                            save_file = true;
                        }
                        match item.itype {
                            Some(ProfileType::Merge) | Some(ProfileType::Script) => {
                                if item.scope.is_none() {
                                    let uid = item.uid.as_ref().unwrap();
                                    item.scope = Some(ScopeType::Global);
                                    item.enable = Some(enabled_global_chain.contains(uid));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                if save_file {
                    log_err!(profiles.save_file());
                }
                // This is old bug since 2.0.0 ~ 2.1.4 version
                // delete invalid files in profiles dir
                if let Ok(dir) = dirs::app_profiles_dir()
                    && let Ok(dir) = std::fs::read_dir(dir)
                {
                    for entry in dir.flatten() {
                        if let Ok(file_name) = entry.file_name().into_string()
                            && !available_files.contains(&file_name)
                        {
                            let _ = std::fs::remove_file(entry.path());
                            tracing::debug!(
                                "delete invalid profile {}, {}",
                                entry.file_name().display(),
                                entry.path().display()
                            );
                        }
                    }
                }
                profiles
            }
            Err(err) => {
                tracing::error!("{err}");
                // delete all files in profiles dir
                if let Ok(dir) = dirs::app_profiles_dir()
                    && let Ok(dir) = std::fs::read_dir(dir)
                {
                    tracing::debug!("clear all files in profiles dir");
                    for entry in dir.flatten() {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
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

    pub fn save_file(&self) -> AppResult<()> {
        help::save_yaml(&dirs::profiles_path()?, self, Some("# Profiles Config for Clash Verge"))
    }

    /// 只修改 current、global chain
    pub fn patch_config(&mut self, patch: IProfiles) -> AppResult<()> {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        if let Some(current) = patch.current {
            let items = self.items.as_deref().unwrap_or_default();
            let some_uid = Some(current);
            if items.iter().any(|e| e.uid == some_uid) {
                self.current = some_uid;
            }
        }

        if let Some(new_chain) = patch.chain {
            // disable old global chain
            if let Some(old_chain) = self.chain.clone() {
                for old_uid in old_chain {
                    let item = self
                        .get_item_mut(&old_uid)
                        .ok_or(any_err!("failed to find the profile item \"uid:{old_uid}\""))?;

                    item.enable = Some(false);
                }
            }
            // enable new global chain
            for new_uid in new_chain.iter() {
                let item = self
                    .get_item_mut(new_uid)
                    .ok_or(any_err!("failed to find the profile item \"uid:{new_uid}\""))?;
                item.enable = Some(true);
            }

            self.chain = Some(new_chain);
        }

        Ok(())
    }

    pub fn get_current(&self) -> Option<&String> {
        self.current.as_ref()
    }

    /// find the item by the uid
    pub fn get_item(&self, uid: &str) -> Option<&PrfItem> {
        self.items
            .as_ref()
            .and_then(|items| items.iter().find(|item| item.uid == Some(uid.to_string())))
    }

    pub fn get_item_mut(&mut self, uid: &str) -> Option<&mut PrfItem> {
        self.items
            .as_mut()
            .and_then(|items| items.iter_mut().find(|item| item.uid == Some(uid.to_string())))
    }

    pub fn get_profiles(&self) -> Vec<&PrfItem> {
        let items = self.items.as_deref().unwrap_or_default();
        items
            .iter()
            .filter(|&o| matches!(o.itype, Some(ProfileType::Remote) | Some(ProfileType::Local)))
            .collect::<Vec<&PrfItem>>()
    }

    // include all enable or disable chains
    pub fn get_profile_chains(&self, profile_uid: Option<String>, enable_filter: EnableFilter) -> Vec<ChainItem> {
        let items = self.items.clone().unwrap_or_default();
        items
            .into_iter()
            .filter(|o| matches!(o.itype, Some(ProfileType::Merge) | Some(ProfileType::Script)))
            .filter(|i| match enable_filter {
                EnableFilter::All => true,
                EnableFilter::Enable => i.enable.unwrap_or_default(),
                EnableFilter::Disable => !i.enable.unwrap_or_default(),
            })
            .filter(|o| o.parent == profile_uid)
            .filter_map(<Option<ChainItem>>::from)
            .collect::<Vec<ChainItem>>()
    }

    /// append new item
    /// if the file_data is some
    /// then should save the data to file
    pub fn append_item(&mut self, mut item: PrfItem) -> AppResult<bool> {
        let mut restart_core = false;
        if let Some(uid) = item.uid.clone() {
            // save the file data
            // move the field value after save
            if let Some(file_data) = item.file_data.take()
                && let Some(file) = item.file.as_ref()
            {
                let path = dirs::app_profiles_dir()?.join(file);
                fs::File::create(path)?.write_all(file_data.as_bytes())?;
            }

            if let Some(parent) = item.parent.as_ref() {
                let profile = self
                    .get_item_mut(parent)
                    .ok_or(any_err!("failed to find the profile item \"uid:{parent}\""))?;
                match profile.chain.as_mut() {
                    Some(chain) => chain.push(uid.clone()),
                    None => profile.chain = Some(vec![uid.clone()]),
                }
            }

            if self.current.is_none()
                && let Some(profile_type) = item.itype.as_ref()
                && matches!(profile_type, ProfileType::Local | ProfileType::Remote)
            {
                restart_core = true;
                self.current = Some(uid);
            }

            if let Some(items) = self.items.as_mut() {
                items.push(item)
            } else {
                self.items = Some(vec![]);
            }
            self.save_file()?;
        } else {
            return Err(AppError::InvalidValue("the uid should not be null".to_string()));
        }

        Ok(restart_core)
    }

    /// reorder items
    pub fn reorder(&mut self, active_id: String, over_id: String) -> AppResult<()> {
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

        if let Some(old_index) = old_index
            && let Some(new_index) = new_index
        {
            let item = items.remove(old_index);
            items.insert(new_index, item);
            self.items = Some(items);
            self.save_file()?;
        }
        Ok(())
    }

    /// update the item value
    pub fn patch_item(&mut self, uid: &str, item: PrfItem) -> AppResult<()> {
        let mut items = self.items.take().unwrap_or_default();

        for each in items.iter_mut() {
            if each.uid == Some(uid.to_string()) {
                patch!(each, item, itype);
                patch!(each, item, name);
                patch!(each, item, desc);
                patch!(each, item, file);
                patch!(each, item, url);
                patch!(each, item, selected);
                patch!(each, item, extra);
                patch!(each, item, updated);
                patch!(each, item, option);
                // chain filed
                patch!(each, item, parent);
                patch!(each, item, enable);

                self.items = Some(items);
                return self.save_file();
            }
        }

        self.items = Some(items);
        Err(any_err!("failed to find the profile item \"uid:{uid}\""))
    }

    /// be used to update the remote item
    /// only patch `updated` `extra` `file_data`
    pub fn update_item(&mut self, uid: &str, mut item: PrfItem) -> AppResult<()> {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        // find the item
        self.get_item(uid)
            .ok_or(any_err!("failed to find the profile item \"uid:{uid}\""))?;

        if let Some(items) = self.items.as_mut() {
            let some_uid = Some(uid);

            for each in items.iter_mut() {
                if each.uid.as_deref() == some_uid {
                    each.extra = item.extra;
                    each.updated = item.updated;
                    each.home = item.home;
                    // save the file data
                    // move the field value after save
                    if let Some(file_data) = item.file_data.take() {
                        let file = each.file.take();
                        let file = file.unwrap_or(item.file.take().unwrap_or(format!("{uid}.yaml")));
                        // the file must exists
                        each.file = Some(file.clone());
                        let path = dirs::app_profiles_dir()?.join(&file);
                        fs::File::create(path)?.write_all(file_data.as_bytes())?;
                    }

                    break;
                }
            }
        }

        self.save_file()
    }

    /// delete item
    /// if delete the current then return true
    pub fn delete_item(&mut self, uid: String) -> AppResult<bool> {
        let current = self.current.as_ref().unwrap_or(&uid);
        let delete_current = *current == uid;
        let mut restart_core = delete_current;

        let mut items = self.items.clone().unwrap_or_default();
        if let Some(profile) = self.get_item(&uid) {
            match profile.itype {
                Some(ProfileType::Local | ProfileType::Remote) => {
                    tracing::debug!("delete profile {:?}", profile.name);
                    let mut remove_uids = vec![uid.clone()];
                    if let Some(profile_chain) = profile.chain.as_ref() {
                        remove_uids.extend(profile_chain.clone());
                        profile_chain
                            .iter()
                            .filter_map(|chain_uid| self.get_item(chain_uid))
                            .for_each(|o| {
                                tracing::debug!("delete profile chains");
                                log_err!(o.delete_file())
                            });
                    }

                    profile.delete_file()?;
                    items.retain(|i| {
                        if let Some(uid_) = i.uid.as_ref()
                            && !remove_uids.contains(uid_)
                        {
                            true
                        } else {
                            false
                        }
                    });
                    // delete current profile, use next profile
                    if delete_current {
                        if let Some(first) = items.first()
                            && let Some(uid) = first.uid.as_ref()
                        {
                            self.current = Some(uid.clone());
                        } else {
                            self.current = None
                        }
                    }
                }
                Some(ProfileType::Merge | ProfileType::Script) => {
                    tracing::debug!("delete enhance script {:?}", profile.name);
                    // delete running profile chain, need to restart core
                    if let Some(parent) = profile.parent.as_ref()
                        && let Some(parent_profile) = items.iter_mut().find(|i| i.uid.as_ref() == Some(parent))
                        && let Some(chains) = parent_profile.chain.as_mut()
                    {
                        // update profile chains
                        chains.retain(|i| i != &uid);
                        if let Some(enable) = profile.enable
                            && enable
                            && parent == current
                        {
                            restart_core = true;
                        }
                    }
                    // delete running global chain, need to restart core
                    if let Some(scope) = profile.scope.as_ref()
                        && matches!(scope, ScopeType::Global)
                        && let Some(enable) = profile.enable
                        && enable
                    {
                        restart_core = true;
                    }

                    profile.delete_file()?;
                    items.retain(|i| i.uid != Some(uid.clone()));
                }
                None => {
                    return Err(AppError::InvalidValue("profile type is null".to_string()));
                }
            }
            self.items = Some(items);
        } else {
            tracing::debug!("reset profiles config");
            *self = Self::template();
            restart_core = true;
        }
        self.save_file()?;

        Ok(restart_core)
    }

    pub fn set_rule_providers_path(&mut self, path: HashMap<String, PathBuf>) {
        let current = self.current.as_ref();
        if let Some(current) = current {
            let mut items = self.items.take().unwrap_or_default();
            for item in items.iter_mut() {
                if let Some(uid) = item.uid.as_ref()
                    && uid == current
                {
                    item.rule_providers_path = Some(path);
                    break;
                }
            }
            self.items = Some(items);
        }
    }

    /// 获取 current 指向的订阅内容
    pub fn current_mapping(&self) -> Option<Mapping> {
        if let Some(current) = self.current.as_ref() {
            self.get_profile_mapping(current)
        } else {
            None
        }
    }

    pub fn get_profile_mapping(&self, profile_uid: &str) -> Option<Mapping> {
        if let Some(items) = self.items.as_ref()
            && let Some(item) = items.iter().find(|&i| i.uid == Some(profile_uid.to_string()))
            && let Some(file) = item.file.as_ref()
        {
            let file_path = dirs::app_profiles_dir().ok()?.join(file);
            let mapping = help::read_merge_mapping(&file_path).ok()?;
            Some(mapping)
        } else {
            None
        }
    }

    pub fn get_current_profile_rule_providers(&self) -> Option<&HashMap<String, PathBuf>> {
        if let Some(current) = self.get_current()
            && let Some(item) = self.get_item(current)
        {
            item.rule_providers_path.as_ref()
        } else {
            None
        }
    }
}
