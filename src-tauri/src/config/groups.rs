use anyhow::Result;
use serde::{Deserialize, Serialize};
use smartstring::alias::String;
use std::collections::HashMap;

const DEFAULT_GROUP_NAME: &str = "Default";
const MAX_GROUP_NAME_LENGTH: usize = 50;

/// 订阅分组
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ProfileGroup {
    pub id: String,
    pub name: String,
    pub order: usize,
}

impl ProfileGroup {
    pub fn new(id: String, name: String, order: usize) -> Result<Self> {
        if name.trim().is_empty() {
            anyhow::bail!("group name cannot be empty");
        }

        if name.len() > MAX_GROUP_NAME_LENGTH {
            anyhow::bail!(
                "group name exceeds maximum length of {} characters",
                MAX_GROUP_NAME_LENGTH
            );
        }

        Ok(Self { id, name, order })
    }

    pub fn default_group() -> Self {
        Self {
            id: "default".into(),
            name: DEFAULT_GROUP_NAME.into(),
            order: 0,
        }
    }

    pub fn update_name(&mut self, name: String) -> Result<()> {
        if name.trim().is_empty() {
            anyhow::bail!("group name cannot be empty");
        }

        if name.len() > MAX_GROUP_NAME_LENGTH {
            anyhow::bail!(
                "group name exceeds maximum length of {} characters",
                MAX_GROUP_NAME_LENGTH
            );
        }

        self.name = name;
        Ok(())
    }
}

/// 分组管理器
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ProfileGroups {
    groups: Vec<ProfileGroup>,
}

impl ProfileGroups {
    pub fn new() -> Self {
        Self {
            groups: vec![ProfileGroup::default_group()],
        }
    }

    pub fn get_all(&self) -> &[ProfileGroup] {
        &self.groups
    }

    pub fn get_by_id(&self, id: &str) -> Option<&ProfileGroup> {
        self.groups.iter().find(|g| g.id.as_str() == id)
    }

    pub fn exists(&self, id: &str) -> bool {
        self.get_by_id(id).is_some()
    }

    pub fn add_group(&mut self, name: String) -> Result<ProfileGroup> {
        if self.group_name_exists(&name) {
            anyhow::bail!("group name '{}' already exists", name);
        }

        let id = crate::utils::help::get_uid("g");
        let order = self.groups.len();
        let group = ProfileGroup::new(id.into(), name, order)?;

        self.groups.push(group.clone());
        Ok(group)
    }

    pub fn remove_group(&mut self, id: &str) -> Result<ProfileGroup> {
        if id == "default" {
            anyhow::bail!("cannot delete the default group");
        }

        let position = self
            .groups
            .iter()
            .position(|g| g.id.as_str() == id)
            .ok_or_else(|| anyhow::anyhow!("group not found"))?;

        let removed = self.groups.remove(position);
        self.reorder_groups();

        Ok(removed)
    }

    pub fn rename_group(&mut self, id: &str, new_name: String) -> Result<()> {
        if self.group_name_exists(&new_name) {
            anyhow::bail!("group name '{}' already exists", new_name);
        }

        let group = self
            .groups
            .iter_mut()
            .find(|g| g.id.as_str() == id)
            .ok_or_else(|| anyhow::anyhow!("group not found"))?;

        group.update_name(new_name)
    }

    pub fn reorder_groups(&mut self) {
        for (index, group) in self.groups.iter_mut().enumerate() {
            group.order = index;
        }
    }

    pub fn move_group(&mut self, id: &str, new_position: usize) -> Result<()> {
        if id == "default" {
            anyhow::bail!("cannot move the default group");
        }

        let old_position = self
            .groups
            .iter()
            .position(|g| g.id.as_str() == id)
            .ok_or_else(|| anyhow::anyhow!("group not found"))?;

        if new_position >= self.groups.len() {
            anyhow::bail!("invalid new position");
        }

        let group = self.groups.remove(old_position);
        self.groups.insert(new_position, group);
        self.reorder_groups();

        Ok(())
    }

    pub fn get_group_profile_count(&self, id: &str, items: &[super::PrfItem]) -> usize {
        items
            .iter()
            .filter(|item| {
                item.group_id
                    .as_ref()
                    .map_or(id == "default", |gid| gid.as_str() == id)
            })
            .count()
    }

    pub fn get_profile_counts(&self, items: &[super::PrfItem]) -> HashMap<String, usize> {
        let mut counts = HashMap::new();

        for group in &self.groups {
            let count = self.get_group_profile_count(group.id.as_str(), items);
            counts.insert(group.id.clone(), count);
        }

        counts
    }

    fn group_name_exists(&self, name: &str) -> bool {
        self.groups
            .iter()
            .any(|g| g.name.eq_ignore_ascii_case(name))
    }

    pub fn ensure_default_group(&mut self) {
        if !self.exists("default") {
            self.groups.insert(0, ProfileGroup::default_group());
            self.reorder_groups();
        }
    }

    pub fn validate_group_id(&self, group_id: Option<&String>) -> Result<()> {
        if let Some(gid) = group_id
            && !self.exists(gid.as_str())
        {
            anyhow::bail!("group '{}' does not exist", gid);
        }
        Ok(())
    }

    /// 清理无配置文件的孤立分组
    pub fn cleanup_orphaned_groups(&mut self, items: &[super::PrfItem]) {
        let used_group_ids: std::collections::HashSet<_> = items
            .iter()
            .filter_map(|item| item.group_id.as_ref())
            .map(|id| id.as_str())
            .collect();

        self.groups.retain(|group| {
            group.id.as_str() == "default" || used_group_ids.contains(group.id.as_str())
        });

        self.reorder_groups();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_group() {
        let mut groups = ProfileGroups::new();
        let result = groups.add_group("Test Group".into());
        assert!(result.is_ok());
        assert_eq!(groups.get_all().len(), 2);
    }

    #[test]
    fn test_duplicate_group_name() {
        let mut groups = ProfileGroups::new();
        let _ = groups.add_group("Test".into());
        let result = groups.add_group("Test".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_group_name() {
        let result = ProfileGroup::new("id".into(), "".into(), 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_default_group() {
        let mut groups = ProfileGroups::new();
        let result = groups.remove_group("default");
        assert!(result.is_err());
    }

    #[test]
    fn test_move_default_group() {
        let mut groups = ProfileGroups::new();
        let _ = groups.add_group("Test".into());
        let result = groups.move_group("default", 1);
        assert!(result.is_err());
    }
}
