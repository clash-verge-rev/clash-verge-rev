use super::{EnableFilter, PrfItem};
use crate::{
    config::ProfileType,
    enhance::chain::{ChainItem, ScopeType},
    log_err,
    utils::{dirs, help},
};
use anyhow::{Context, Result, anyhow, bail};
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
                let enabled_global_chain = profiles.chain.as_deref().unwrap_or_default();
                // compatible with the old old old version
                if let Some(items) = profiles.items.as_mut() {
                    for item in items.iter_mut() {
                        if item.uid.is_none() {
                            item.uid = Some(help::get_uid("d"));
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
                profiles
            }
            Err(err) => {
                tracing::error!("{err}");
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
        help::save_yaml(&dirs::profiles_path()?, self, Some("# Profiles Config for Clash Verge"))
    }

    /// 只修改 current、global chain
    pub fn patch_config(&mut self, patch: IProfiles) -> Result<()> {
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
            let old_chain = self.chain.clone();
            // disable old chain
            if let Some(old_chain) = old_chain {
                for old_uid in old_chain {
                    let item = self
                        .get_item_mut(&old_uid)
                        .ok_or(anyhow!("failed to find the profile item \"uid:{old_uid}\""))?;

                    item.enable = Some(false);
                }
            }
            // enable new chain
            for new_uid in new_chain.iter() {
                let item = self
                    .get_item_mut(new_uid)
                    .ok_or(anyhow!("failed to find the profile item \"uid:{new_uid}\""))?;
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
    pub fn append_item(&mut self, mut item: PrfItem) -> Result<()> {
        if let Some(uid) = item.uid.clone() {
            // save the file data
            // move the field value after save
            if let Some(file_data) = item.file_data.take()
                && let Some(file) = item.file.as_ref()
            {
                let path = dirs::app_profiles_dir()?.join(file);
                fs::File::create(path)
                    .with_context(|| format!("failed to create file \"{file}\""))?
                    .write(file_data.as_bytes())
                    .with_context(|| format!("failed to write to file \"{file}\""))?;
            }

            if let Some(parent) = item.parent.as_ref() {
                let profile = self
                    .get_item_mut(parent)
                    .ok_or(anyhow!("failed to find the profile item \"uid:{parent}\""))?;
                match profile.chain.as_mut() {
                    Some(chain) => chain.push(uid),
                    None => profile.chain = Some(vec![uid]),
                }
            }

            if self.items.is_none() {
                self.items = Some(vec![]);
            }

            if let Some(items) = self.items.as_mut() {
                items.push(item)
            }
            self.save_file()
        } else {
            bail!("the uid should not be null");
        }
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
    pub fn patch_item(&mut self, uid: &str, item: PrfItem) -> Result<()> {
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
        bail!("failed to find the profile item \"uid:{uid}\"")
    }

    /// be used to update the remote item
    /// only patch `updated` `extra` `file_data`
    pub fn update_item(&mut self, uid: &str, mut item: PrfItem) -> Result<()> {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        // find the item
        self.get_item(uid)
            .ok_or(anyhow!("failed to find the profile item \"uid:{uid}\""))?;

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

                        fs::File::create(path)
                            .with_context(|| format!("failed to create file \"{file}\""))?
                            .write(file_data.as_bytes())
                            .with_context(|| format!("failed to write to file \"{file}\""))?;
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
        let mut filter_uids: Vec<String> = Vec::new();

        let profile = self
            .get_item(&uid)
            .ok_or(anyhow!("failed to find the profile item \"uid:{uid}\""))?;
        filter_uids.push(uid.clone());
        // delete profile chain
        if let Some(profile_chain) = profile.chain.as_ref() {
            filter_uids.extend(profile_chain.clone());
            profile_chain
                .iter()
                .filter_map(|chain_uid| self.get_item(chain_uid))
                .for_each(|o| log_err!(o.delete_file()));
        }
        // delete profile
        profile.delete_file()?;

        // delete the original uid
        let delete_current = uid == *current;
        let mut restart_core = delete_current;
        if let Some(parent) = profile.parent.as_ref()
            && *parent == *current
            && let Some(enable) = profile.enable.as_ref()
            && *enable
        {
            restart_core = true;
        }

        let items = self.items.take().unwrap_or_default();
        if delete_current && let [first, ..] = items.as_slice() {
            self.current = Some(first.uid.clone().unwrap_or_default());
        }

        // generate new items
        let new_items = items
            .into_iter()
            .filter(|p| !filter_uids.contains(&p.uid.clone().unwrap()))
            .collect::<Vec<PrfItem>>();
        self.items = Some(new_items);

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
