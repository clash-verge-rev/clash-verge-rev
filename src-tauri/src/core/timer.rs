use crate::{config::Config, core::CoreManager, feat};
use anyhow::{Context, Result};
use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, TaskBuilder};
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
use std::{collections::HashMap, sync::Arc};

type TaskID = u64;

#[derive(Debug, Clone)]
struct TimerTask {
    task_id: TaskID,
    interval_minutes: u64,
    __last_run: i64, // Timestamp of last execution
}

pub struct Timer {
    /// cron manager
    delay_timer: Arc<RwLock<DelayTimer>>,

    /// save the current state - using RwLock for better read concurrency
    timer_map: Arc<RwLock<HashMap<String, TimerTask>>>,

    /// increment id - kept as mutex since it's just a counter
    timer_count: Arc<Mutex<TaskID>>,

    /// Flag to mark if timer is initialized - atomic for better performance
    initialized: Arc<std::sync::atomic::AtomicBool>,
}

impl Timer {
    pub fn global() -> &'static Timer {
        static TIMER: OnceCell<Timer> = OnceCell::new();

        TIMER.get_or_init(|| Timer {
            delay_timer: Arc::new(RwLock::new(DelayTimerBuilder::default().build())),
            timer_map: Arc::new(RwLock::new(HashMap::new())),
            timer_count: Arc::new(Mutex::new(1)),
            initialized: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }

    /// Initialize timer with better error handling and atomic operations
    pub fn init(&self) -> Result<()> {
        // Use compare_exchange for thread-safe initialization check
        if self
            .initialized
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_err()
        {
            log::debug!(target: "app", "Timer already initialized, skipping...");
            return Ok(());
        }

        log::info!(target: "app", "Initializing timer...");

        // Initialize timer tasks
        if let Err(e) = self.refresh() {
            // Reset initialization flag on error
            self.initialized
                .store(false, std::sync::atomic::Ordering::SeqCst);
            log::error!(target: "app", "Failed to initialize timer: {}", e);
            return Err(e);
        }

        let cur_timestamp = chrono::Local::now().timestamp();

        // Collect profiles that need immediate update
        let profiles_to_update = if let Some(items) = Config::profiles().latest().get_items() {
            items
                .iter()
                .filter_map(|item| {
                    let interval = item.option.as_ref()?.update_interval? as i64;
                    let updated = item.updated? as i64;
                    let uid = item.uid.as_ref()?;

                    if interval > 0 && cur_timestamp - updated >= interval * 60 {
                        Some(uid.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<String>>()
        } else {
            Vec::new()
        };

        // Advance tasks outside of locks to minimize lock contention
        if !profiles_to_update.is_empty() {
            let timer_map = self.timer_map.read();
            let delay_timer = self.delay_timer.write();

            for uid in profiles_to_update {
                if let Some(task) = timer_map.get(&uid) {
                    log::info!(target: "app", "Advancing task for uid: {}", uid);
                    if let Err(e) = delay_timer.advance_task(task.task_id) {
                        log::warn!(target: "app", "Failed to advance task {}: {}", uid, e);
                    }
                }
            }
        }

        log::info!(target: "app", "Timer initialization completed");
        Ok(())
    }

    /// Refresh timer tasks with better error handling
    pub fn refresh(&self) -> Result<()> {
        // Generate diff outside of lock to minimize lock contention
        let diff_map = self.gen_diff();

        if diff_map.is_empty() {
            log::debug!(target: "app", "No timer changes needed");
            return Ok(());
        }

        log::info!(target: "app", "Refreshing {} timer tasks", diff_map.len());

        // Apply changes while holding locks
        let mut timer_map = self.timer_map.write();
        let mut delay_timer = self.delay_timer.write();

        for (uid, diff) in diff_map {
            match diff {
                DiffFlag::Del(tid) => {
                    timer_map.remove(&uid);
                    if let Err(e) = delay_timer.remove_task(tid) {
                        log::warn!(target: "app", "Failed to remove task {} for uid {}: {}", tid, uid, e);
                    } else {
                        log::debug!(target: "app", "Removed task {} for uid {}", tid, uid);
                    }
                }
                DiffFlag::Add(tid, interval) => {
                    let task = TimerTask {
                        task_id: tid,
                        interval_minutes: interval,
                        __last_run: chrono::Local::now().timestamp(),
                    };

                    timer_map.insert(uid.clone(), task);

                    if let Err(e) = self.add_task(&mut delay_timer, uid.clone(), tid, interval) {
                        log::error!(target: "app", "Failed to add task for uid {}: {}", uid, e);
                        timer_map.remove(&uid); // Rollback on failure
                    } else {
                        log::debug!(target: "app", "Added task {} for uid {}", tid, uid);
                    }
                }
                DiffFlag::Mod(tid, interval) => {
                    // Remove old task first
                    if let Err(e) = delay_timer.remove_task(tid) {
                        log::warn!(target: "app", "Failed to remove old task {} for uid {}: {}", tid, uid, e);
                    }

                    // Then add the new one
                    let task = TimerTask {
                        task_id: tid,
                        interval_minutes: interval,
                        __last_run: chrono::Local::now().timestamp(),
                    };

                    timer_map.insert(uid.clone(), task);

                    if let Err(e) = self.add_task(&mut delay_timer, uid.clone(), tid, interval) {
                        log::error!(target: "app", "Failed to update task for uid {}: {}", uid, e);
                        timer_map.remove(&uid); // Rollback on failure
                    } else {
                        log::debug!(target: "app", "Updated task {} for uid {}", tid, uid);
                    }
                }
            }
        }

        Ok(())
    }

    /// Generate map of profile UIDs to update intervals
    fn gen_map(&self) -> HashMap<String, u64> {
        let mut new_map = HashMap::new();

        if let Some(items) = Config::profiles().latest().get_items() {
            for item in items.iter() {
                if let Some(option) = item.option.as_ref() {
                    if let (Some(interval), Some(uid)) = (option.update_interval, &item.uid) {
                        if interval > 0 {
                            new_map.insert(uid.clone(), interval);
                        }
                    }
                }
            }
        }

        new_map
    }

    /// Generate differences between current and new timer configuration
    fn gen_diff(&self) -> HashMap<String, DiffFlag> {
        let mut diff_map = HashMap::new();
        let new_map = self.gen_map();

        // Read lock for comparing current state
        let timer_map = self.timer_map.read();

        // Find tasks to modify or delete
        for (uid, task) in timer_map.iter() {
            match new_map.get(uid) {
                Some(&interval) if interval != task.interval_minutes => {
                    // Task exists but interval changed
                    diff_map.insert(uid.clone(), DiffFlag::Mod(task.task_id, interval));
                }
                None => {
                    // Task no longer needed
                    diff_map.insert(uid.clone(), DiffFlag::Del(task.task_id));
                }
                _ => {
                    // Task exists with same interval, no change needed
                }
            }
        }

        // Find new tasks to add
        let mut next_id = *self.timer_count.lock();

        for (uid, &interval) in new_map.iter() {
            if !timer_map.contains_key(uid) {
                diff_map.insert(uid.clone(), DiffFlag::Add(next_id, interval));
                next_id += 1;
            }
        }

        // Update counter only if we added new tasks
        if next_id > *self.timer_count.lock() {
            *self.timer_count.lock() = next_id;
        }

        diff_map
    }

    /// Add a timer task with better error handling
    fn add_task(
        &self,
        delay_timer: &mut DelayTimer,
        uid: String,
        tid: TaskID,
        minutes: u64,
    ) -> Result<()> {
        log::info!(target: "app", "Adding task: uid={}, id={}, interval={}min", uid, tid, minutes);

        // Create a task with reasonable retries and backoff
        let task = TaskBuilder::default()
            .set_task_id(tid)
            .set_maximum_parallel_runnable_num(1)
            .set_frequency_repeated_by_minutes(minutes)
            .spawn_async_routine(move || {
                let uid = uid.clone();
                async move {
                    Self::async_task(uid).await;
                }
            })
            .context("failed to create timer task")?;

        delay_timer
            .add_task(task)
            .context("failed to add timer task")?;

        Ok(())
    }

    /// Async task with better error handling and logging
    async fn async_task(uid: String) {
        let task_start = std::time::Instant::now();
        log::info!(target: "app", "Running timer task for profile: {}", uid);

        // Update profile
        let profile_result = feat::update_profile(uid.clone(), None).await;

        match profile_result {
            Ok(_) => {
                // Update configuration
                match CoreManager::global().update_config().await {
                    Ok(_) => {
                        let duration = task_start.elapsed().as_millis();
                        log::info!(
                            target: "app",
                            "Timer task completed successfully for uid: {} (took {}ms)",
                            uid, duration
                        );
                    }
                    Err(e) => {
                        log::error!(
                            target: "app",
                            "Failed to refresh config after profile update for uid {}: {}",
                            uid, e
                        );
                    }
                }
            }
            Err(e) => {
                log::error!(target: "app", "Failed to update profile uid {}: {}", uid, e);
            }
        }
    }
}

#[derive(Debug)]
enum DiffFlag {
    Del(TaskID),
    Add(TaskID, u64),
    Mod(TaskID, u64),
}
