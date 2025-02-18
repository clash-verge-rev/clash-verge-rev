use super::{EnableFilter, PrfItem};
use crate::{
    config::ProfileType,
    enhance::chain::{ChainItem, ScopeType},
    utils::{dirs, help},
};
use anyhow::{bail, Context, Result};
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

                let enabled_chain = profiles.chain.clone().unwrap_or_default();
                // compatible with the old old old version
                if let Some(items) = profiles.items.as_mut() {
                    for item in items.iter_mut() {
                        if item.uid.is_none() {
                            item.uid = Some(help::get_uid("d"));
                        }
                        match item.itype {
                            Some(ProfileType::Merge) | Some(ProfileType::Script) => {
                                let uid = item.uid.clone().unwrap();
                                item.enable = Some(enabled_chain.contains(&uid));
                                item.scope = Some(ScopeType::Global);
                            }
                            _ => {}
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

    /// 只修改 current、global chain
    pub fn patch_config(&mut self, patch: IProfiles) -> Result<bool> {
        // if current profile is different, need to restart core to aviod some problems
        let mut restart_core = false;
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        if let Some(current) = patch.current {
            let items = self.items.as_ref().unwrap();
            let some_uid = Some(current);

            // check if need to restart core
            let current_old = self.get_current();
            if current_old != some_uid {
                restart_core = true;
            }

            if items.iter().any(|e| e.uid == some_uid) {
                self.current = some_uid;
            }
        }

        if let Some(new_chain) = patch.chain {
            let old_chain = self.chain.clone();
            // disable old chain
            if let Some(old_chain) = old_chain {
                for old_uid in old_chain {
                    let item = self.get_mut_item(&old_uid)?;
                    item.enable = Some(false);
                }
            }
            // enable new chain
            for new_uid in new_chain.clone() {
                let item = self.get_mut_item(&new_uid)?;
                item.enable = Some(true);
            }

            self.chain = Some(new_chain.clone());
        }

        Ok(restart_core)
    }

    pub fn get_current(&self) -> Option<String> {
        self.current.clone()
    }

    /// find the item by the uid
    pub fn get_item(&self, uid: &String) -> Result<&PrfItem> {
        if let Some(items) = self.items.as_ref() {
            for each in items.iter() {
                if each.uid == Some(uid.clone()) {
                    return Ok(each);
                }
            }
        }
        bail!("failed to get the profile item \"uid:{uid}\"");
    }

    pub fn get_mut_item(&mut self, uid: &String) -> Result<&mut PrfItem> {
        if let Some(items) = self.items.as_mut() {
            for item in items.iter_mut() {
                if item.uid == Some(uid.clone()) {
                    return Ok(item);
                }
            }
        }
        bail!("failed to get the profile item \"uid:{uid}\"");
    }

    pub fn get_profiles(&self) -> Vec<PrfItem> {
        let items = self.items.clone().unwrap_or_default();
        items
            .into_iter()
            .filter(|o| {
                matches!(
                    o.itype,
                    Some(ProfileType::Remote) | Some(ProfileType::Local)
                )
            })
            .collect::<Vec<PrfItem>>()
    }

    // includ all enable or disable chains
    pub fn get_profile_chains(
        &self,
        profile_uid: Option<String>,
        enable_filter: EnableFilter,
    ) -> Vec<ChainItem> {
        let items = self.items.clone().unwrap_or_default();
        items
            .into_iter()
            .filter(|o| {
                matches!(
                    o.itype,
                    Some(ProfileType::Merge) | Some(ProfileType::Script)
                )
            })
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
        if item.uid.is_none() {
            bail!("the uid should not be null");
        }

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

        if let Some(parent) = item.parent.clone() {
            let profile = self.get_mut_item(&parent)?;
            match profile.chain.as_mut() {
                Some(chain) => chain.push(item.uid.clone().unwrap()),
                None => profile.chain = Some(vec![item.uid.clone().unwrap()]),
            }
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
    pub fn update_item(&mut self, uid: String, mut item: PrfItem) -> Result<()> {
        if self.items.is_none() {
            self.items = Some(vec![]);
        }

        // find the item
        self.get_item(&uid)?;

        if let Some(items) = self.items.as_mut() {
            let some_uid = Some(uid.clone());

            for each in items.iter_mut() {
                if each.uid == some_uid {
                    each.extra = item.extra;
                    each.updated = item.updated;
                    each.home = item.home;
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
    pub fn delete_item(&mut self, uid: String) -> Result<(bool, bool)> {
        let current = self.current.as_ref().unwrap_or(&uid);
        let current = current.clone();

        let mut filter_uids: Vec<String> = Vec::new();

        let profile = self.get_item(&uid)?;
        filter_uids.push(uid.clone());
        // delete profile chain
        if let Some(profile_chain) = profile.chain.as_ref() {
            filter_uids.extend(profile_chain.clone());
            profile_chain
                .iter()
                .filter_map(|chain_uid| self.get_item(chain_uid).ok())
                .for_each(|o| {
                    let _ = o.delete_file();
                });
        }
        // delete profile
        profile.delete_file()?;

        // delete the original uid
        let delete_current = current == uid;
        let delete_current_chain = profile.parent == Some(current);
        let items = self.items.take().unwrap_or_default();
        if delete_current {
            self.current = match !items.is_empty() {
                true => items[0].uid.clone(),
                false => None,
            };
        }

        // generate new items
        let new_items = items
            .clone()
            .into_iter()
            .filter(|p| !filter_uids.contains(&p.uid.clone().unwrap()))
            .collect::<Vec<PrfItem>>();
        self.items = Some(new_items);

        self.save_file()?;
        Ok((delete_current, delete_current_chain))
    }

    pub fn set_rule_providers_path(&mut self, path: HashMap<String, PathBuf>) -> Result<()> {
        let current = self.current.as_ref();
        if current.is_none() {
            bail!("failed to get the current profile");
        }
        let mut items = self.items.take().unwrap_or_default();
        for item in items.iter_mut() {
            if item.uid.as_ref() == current {
                item.rule_providers_path = Some(path);
                break;
            }
        }
        self.items = Some(items);
        Ok(())
    }

    /// 获取 current 指向的订阅内容
    pub fn current_mapping(&self) -> Result<Mapping> {
        match self.current.as_ref() {
            Some(current) => self.get_profile_mapping(&current),
            None => Ok(Mapping::new()),
        }
    }

    pub fn get_profile_mapping(&self, profile_uid: &str) -> Result<Mapping> {
        match (profile_uid, self.items.as_ref()) {
            (profile_uid, Some(items)) => {
                if let Some(item) = items
                    .iter()
                    .find(|&e| e.uid == Some(profile_uid.to_string()))
                {
                    let file_path = match item.file.as_ref() {
                        Some(file) => dirs::app_profiles_dir()?.join(file),
                        None => bail!("failed to get the file field"),
                    };
                    return help::read_merge_mapping(&file_path);
                }
                bail!("failed to find the current profile \"uid:{profile_uid}\"");
            }
            _ => Ok(Mapping::new()),
        }
    }
}
