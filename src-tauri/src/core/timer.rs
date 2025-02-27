use crate::config::Config;
use crate::core::mihomo::MihomoClientManager;
use crate::feat;
use anyhow::{Context, Result};
use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, TaskBuilder};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, Listener};

use super::backup::ENV_APPLY_BACKUP;
use super::handle;

type TaskID = u64;

const ACTIVATING_SELECTED_TASK_ID: TaskID = 0;
const ACTIVATING_SELECTED_EVENT: &str = "activate-selected-finish";

pub struct Timer {
    /// cron manager
    delay_timer: Arc<Mutex<DelayTimer>>,

    /// save the current state
    timer_map: Arc<Mutex<HashMap<String, (TaskID, u64)>>>,

    /// increment id, from 2, the 1 is used to activating selected task after backup file
    timer_count: Arc<Mutex<TaskID>>,
}

impl Timer {
    pub fn global() -> &'static Timer {
        static TIMER: OnceCell<Timer> = OnceCell::new();

        TIMER.get_or_init(|| Timer {
            delay_timer: Arc::new(Mutex::new(DelayTimerBuilder::default().build())),
            timer_map: Arc::new(Mutex::new(HashMap::new())),
            timer_count: Arc::new(Mutex::new(1)),
        })
    }

    /// restore timer
    pub fn init(&self) -> Result<()> {
        self.activate_selected_task()?;
        self.refresh_profiles()?;

        let app_handle = handle::Handle::global().get_app_handle()?;
        app_handle.listen(ACTIVATING_SELECTED_EVENT, |_| {
            log::info!("recived finish activating selected event");
            std::env::remove_var(ENV_APPLY_BACKUP);
            let delay_timer = Self::global().delay_timer.lock();
            // TODO: remove error --> (Fn : `finish_task`, Without the `task_mark_ref_mut` for task_id :0)
            //      But, this task seems to have been removed
            let _ = delay_timer.remove_task(ACTIVATING_SELECTED_TASK_ID);
        });

        let cur_timestamp = chrono::Local::now().timestamp();

        let timer_map = self.timer_map.lock();
        let delay_timer = self.delay_timer.lock();
        let profiles = Config::profiles().latest().get_profiles();
        profiles
            .iter()
            .filter_map(|item| {
                // mins to seconds
                let interval = ((item.option.as_ref()?.update_interval?) as i64) * 60;
                let updated = item.updated? as i64;

                if interval > 0 && cur_timestamp - updated >= interval {
                    Some(item)
                } else {
                    None
                }
            })
            .for_each(|item| {
                if let Some(uid) = item.uid.as_ref() {
                    if let Some((task_id, _)) = timer_map.get(uid) {
                        crate::log_err!(delay_timer.advance_task(*task_id));
                    }
                }
            });

        Ok(())
    }

    pub fn add_async_task<F, U>(&self, id: TaskID, seconds: u64, async_task: F) -> Result<()>
    where
        F: Fn() -> U + 'static + Send,
        U: std::future::Future + 'static + Send,
    {
        let task = TaskBuilder::default()
            .set_task_id(id)
            .set_maximum_parallel_runnable_num(1)
            .set_frequency_repeated_by_seconds(seconds)
            .spawn_async_routine(async_task)
            .context("failed to create timer task")?;

        self.delay_timer
            .lock()
            .add_task(task)
            .context("failed to add timer task")?;

        Ok(())
    }

    fn activate_selected_task(&self) -> Result<()> {
        if std::env::var(ENV_APPLY_BACKUP).is_err() {
            return Ok(());
        }

        log::info!("backup file has been applied, register activating group selected task");
        let body = move || async {
            log::info!("starting activating selected task");
            let current = Config::profiles().latest().get_current();
            if current.is_none() {
                log::info!("No current profile found");
                return;
            }
            let current = current.unwrap_or_default();
            let profiles = Config::profiles().latest().clone();
            let mihomo = MihomoClientManager::global().mihomo();

            if mihomo.get_base_config().await.is_err() {
                log::error!("Failed to get base config");
                return;
            }
            if profiles.get_item(&current).is_err() {
                log::error!("Failed to get profile");
                return;
            }
            let profile = profiles.get_item(&current).unwrap();
            let selected = profile.selected.clone().unwrap_or_default();
            for selected_item in selected {
                if selected_item.now.is_none() {
                    continue;
                }
                let proxy_name = selected_item.name.clone().unwrap_or_default();
                let node = selected_item.now.clone().unwrap();
                if mihomo
                    .select_node_for_proxy(&proxy_name, &node)
                    .await
                    .is_err()
                {
                    if mihomo.get_proxy_by_name(&node).await.is_err() {
                        log::error!("Failed to select node for proxy: {}, node: {}, because the node [{}] does not exist", proxy_name, node, node);
                        continue;
                    }
                    log::error!(
                        "Failed to select node for proxy: {}, node: {}",
                        proxy_name,
                        node
                    );
                    return;
                }
                log::info!("Selected node for proxy: {}, node: {}", proxy_name, node);
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            let app_handle = handle::Handle::global().get_app_handle().unwrap();
            let _ = app_handle.emit(ACTIVATING_SELECTED_EVENT, ());
        };

        // 10 seconds interval
        self.add_async_task(ACTIVATING_SELECTED_TASK_ID, 10, body)?;

        Ok(())
    }

    /// Correctly update all cron tasks
    pub fn refresh_profiles(&self) -> Result<()> {
        let diff_map = self.gen_diff_profiles();

        let mut timer_map = self.timer_map.lock();
        let delay_timer = self.delay_timer.lock();

        for (uid, diff) in diff_map.into_iter() {
            match diff {
                DiffFlag::Del(tid) => {
                    let _ = timer_map.remove(&uid);
                    crate::log_err!(delay_timer.remove_task(tid));
                }
                DiffFlag::Add(tid, val) => {
                    let _ = timer_map.insert(uid.clone(), (tid, val));
                    crate::log_err!(self.add_profiles_task(&delay_timer, uid, tid, val));
                }
                DiffFlag::Mod(tid, val) => {
                    let _ = timer_map.insert(uid.clone(), (tid, val));
                    crate::log_err!(delay_timer.remove_task(tid));
                    crate::log_err!(self.add_profiles_task(&delay_timer, uid, tid, val));
                }
            }
        }

        Ok(())
    }

    /// generate a map -> (uid, update_interval)
    fn gen_profiles_interval(&self) -> HashMap<String, u64> {
        let mut new_map = HashMap::new();

        let profiles = Config::profiles().latest().get_profiles();
        for profile in profiles.iter() {
            if profile.option.is_some() {
                let option = profile.option.as_ref().unwrap();
                let interval = option.update_interval.unwrap_or(0);

                if interval > 0 {
                    new_map.insert(profile.uid.clone().unwrap(), interval);
                }
            }
        }

        new_map
    }

    /// generate the diff map for refresh
    fn gen_diff_profiles(&self) -> HashMap<String, DiffFlag> {
        let mut diff_map = HashMap::new();

        let timer_map = self.timer_map.lock();

        let new_map = self.gen_profiles_interval();
        let cur_map = &timer_map;

        cur_map.iter().for_each(|(uid, (tid, val))| {
            let new_val = new_map.get(uid).unwrap_or(&0);

            if *new_val == 0 {
                diff_map.insert(uid.clone(), DiffFlag::Del(*tid));
            } else if new_val != val {
                diff_map.insert(uid.clone(), DiffFlag::Mod(*tid, *new_val));
            }
        });

        let mut count = self.timer_count.lock();

        new_map.iter().for_each(|(uid, val)| {
            if cur_map.get(uid).is_none() {
                diff_map.insert(uid.clone(), DiffFlag::Add(*count, *val));

                *count += 1;
            }
        });

        diff_map
    }

    /// add a cron task
    fn add_profiles_task(
        &self,
        delay_timer: &DelayTimer,
        uid: String,
        tid: TaskID,
        minutes: u64,
    ) -> Result<()> {
        let task = TaskBuilder::default()
            .set_task_id(tid)
            .set_maximum_parallel_runnable_num(1)
            .set_frequency_repeated_by_minutes(minutes)
            // .set_frequency_repeated_by_seconds(minutes) // for test
            .spawn_async_routine(move || Self::update_profile_task(uid.to_owned()))
            .context("failed to create timer task")?;

        delay_timer
            .add_task(task)
            .context("failed to add timer task")?;

        Ok(())
    }

    /// the task runner
    async fn update_profile_task(uid: String) {
        log::info!(target: "app", "running timer task `{uid}`");
        crate::log_err!(feat::update_profile(uid, None).await);
    }
}

#[derive(Debug)]
enum DiffFlag {
    Del(TaskID),
    Add(TaskID, u64),
    Mod(TaskID, u64),
}
