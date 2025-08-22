use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::utils::dirs;
use crate::{feat, log_err};
use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, TaskBuilder};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use super::handle;

type TaskId = u64;

const ACTIVATING_SELECTED_TASK_ID: TaskId = 0;

pub struct Timer {
    /// cron manager
    delay_timer: Arc<Mutex<DelayTimer>>,

    /// save the current state
    timer_map: Arc<Mutex<HashMap<String, (TaskId, u64)>>>,

    /// increment id, from 2, the 1 is used to activating selected task after backup file
    timer_count: Arc<AtomicU64>,
}

impl Timer {
    pub fn global() -> &'static Timer {
        static TIMER: OnceCell<Timer> = OnceCell::new();

        TIMER.get_or_init(|| Timer {
            delay_timer: Arc::new(Mutex::new(DelayTimerBuilder::default().build())),
            timer_map: Arc::new(Mutex::new(HashMap::new())),
            timer_count: Arc::new(AtomicU64::new(1)),
        })
    }

    /// restore timer
    pub fn init(&self) -> AppResult<()> {
        self.activate_selected_task()?;
        self.refresh_profiles()?;

        let cur_timestamp = chrono::Local::now().timestamp();

        let timer_map = self.timer_map.lock();
        let delay_timer = self.delay_timer.lock();
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let profiles = profiles.get_profiles();
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
                if let Some(uid) = item.uid.as_ref()
                    && let Some((task_id, _)) = timer_map.get(uid)
                {
                    crate::log_err!(delay_timer.advance_task(*task_id));
                }
            });

        Ok(())
    }

    pub fn add_async_task<F, U>(&self, id: TaskId, seconds: u64, async_task: F) -> AppResult<()>
    where
        F: Fn() -> U + 'static + Send,
        U: std::future::Future + 'static + Send,
    {
        let task = TaskBuilder::default()
            .set_task_id(id)
            .set_maximum_parallel_runnable_num(1)
            .set_frequency_repeated_by_seconds(seconds)
            .spawn_async_routine(async_task)?;

        self.delay_timer.lock().add_task(task)?;

        Ok(())
    }

    #[allow(unused)]
    pub fn remove_task(&self, task_id: u64) -> AppResult<()> {
        let delay_timer = self.delay_timer.lock();
        delay_timer.remove_task(task_id)?;
        Ok(())
    }

    fn activate_selected_task(&self) -> AppResult<()> {
        if !dirs::backup_archive_file()?.exists() {
            return Ok(());
        }

        tracing::info!("backup file has been applied, register activating group selected task");
        let body = move || async {
            tracing::info!("starting activating selected task");
            let profiles = Config::profiles();
            let profiles = profiles.latest().clone();
            let current = profiles.get_current();
            if let Some(current) = current {
                let profiles = Config::profiles().latest().clone();
                let mihomo = handle::Handle::mihomo().await;

                if mihomo.get_base_config().await.is_err() {
                    tracing::error!("failed to get base config");
                    return;
                }

                match profiles.get_item(current) {
                    Some(profile) => {
                        if let Some(selected) = profile.selected.as_ref() {
                            for selected_item in selected {
                                if let Some(proxy_name) = selected_item.name.as_ref()
                                    && let Some(node) = selected_item.now.as_ref()
                                {
                                    if mihomo.select_node_for_proxy(proxy_name, node).await.is_err() {
                                        if mihomo.get_proxy_by_name(node).await.is_err() {
                                            tracing::error!(
                                                "Failed to select node for proxy: {proxy_name}, node: {node}, because the node [{node}] does not exist"
                                            );
                                            continue;
                                        }
                                        tracing::error!("Failed to select node for proxy: {proxy_name}, node: {node}");
                                        return;
                                    } else {
                                        tracing::info!("Selected node for proxy: {proxy_name}, node: {node}");
                                    }
                                }
                            }
                        }

                        if let Ok(archive_file) = dirs::backup_archive_file()
                            && archive_file.exists()
                        {
                            log_err!(std::fs::remove_file(archive_file), "failed to remove archive file");
                        }
                    }
                    None => {
                        tracing::error!("Failed to get current profile [{current}]");
                    }
                }
            }
        };

        self.add_async_task(ACTIVATING_SELECTED_TASK_ID, 3, body)?;
        {
            self.delay_timer.lock().advance_task(ACTIVATING_SELECTED_TASK_ID)?;
        }

        tauri::async_runtime::spawn(async move {
            loop {
                let archive_file = dirs::backup_archive_file();
                if let Ok(archive_file) = archive_file
                    && !archive_file.exists()
                {
                    tracing::info!("received finish activating selected event");
                    let delay_timer = Self::global().delay_timer.lock();
                    let _ = delay_timer.remove_task(ACTIVATING_SELECTED_TASK_ID);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        });
        Ok(())
    }

    /// Correctly update all cron tasks
    pub fn refresh_profiles(&self) -> AppResult<()> {
        let diff_map = self.gen_diff_profiles();

        let mut timer_map = self.timer_map.lock();
        let delay_timer = self.delay_timer.lock();

        for (uid, diff) in diff_map.into_iter() {
            match diff {
                DiffFlag::Del(tid) => {
                    let _ = timer_map.remove(&uid);
                    log_err!(delay_timer.remove_task(tid));
                }
                DiffFlag::Add(tid, val) => {
                    log_err!(self.add_profiles_task(&delay_timer, uid.clone(), tid, val));
                    let _ = timer_map.insert(uid, (tid, val));
                }
                DiffFlag::Mod(tid, val) => {
                    log_err!(delay_timer.remove_task(tid));
                    log_err!(self.add_profiles_task(&delay_timer, uid.clone(), tid, val));
                    let _ = timer_map.insert(uid, (tid, val));
                }
            }
        }

        Ok(())
    }

    /// generate a map -> (uid, update_interval)
    fn gen_profiles_interval(&self) -> HashMap<String, u64> {
        let mut new_map = HashMap::new();
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let profiles = profiles.get_profiles();
        for profile in profiles.iter() {
            if let Some(uid) = profile.uid.as_ref()
                && let Some(option) = profile.option.as_ref()
            {
                let interval = option.update_interval.unwrap_or(0);
                if interval > 0 {
                    new_map.insert(uid.clone(), interval);
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

        new_map.iter().for_each(|(uid, val)| {
            let count = self.timer_count.fetch_add(1, Ordering::SeqCst);
            if cur_map.get(uid).is_none() {
                diff_map.insert(uid.clone(), DiffFlag::Add(count, *val));
            }
        });

        diff_map
    }

    /// add a cron task
    fn add_profiles_task(&self, delay_timer: &DelayTimer, uid: String, tid: TaskId, minutes: u64) -> AppResult<()> {
        let task = TaskBuilder::default()
            .set_task_id(tid)
            .set_maximum_parallel_runnable_num(1)
            .set_frequency_repeated_by_minutes(minutes)
            // .set_frequency_repeated_by_seconds(minutes) // for test
            .spawn_async_routine(move || Self::update_profile_task(tid, uid.to_owned()))?;

        delay_timer.add_task(task)?;

        Ok(())
    }

    /// the task runner
    async fn update_profile_task(task_id: TaskId, uid: String) {
        tracing::info!("running timer update profile `{uid}` task");
        match feat::update_profile(&uid, None).await {
            Ok(_) => {
                tracing::info!("update profile successfully, refresh profiles");
            }
            Err(e) => {
                if let AppError::InvalidClashConfig(msg) = e {
                    tracing::error!("update profile `{uid}` failed, {msg}");
                    handle::Handle::notice_message(handle::NoticeStatus::Error, msg);
                } else {
                    tracing::debug!("update profile `{uid}` failed, retry update after 30 seconds, {e}");
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    log_err!(Self::global().delay_timer.lock().advance_task(task_id));
                }
            }
        }
        handle::Handle::refresh_profiles();
    }
}

#[derive(Debug)]
enum DiffFlag {
    Del(TaskId),
    Add(TaskId, u64),
    Mod(TaskId, u64),
}
