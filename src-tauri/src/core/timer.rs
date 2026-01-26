use crate::{config::Config, feat, singleton, utils::resolve::is_resolve_done};
use anyhow::{Context as _, Result};
use clash_verge_logging::{Type, logging, logging_error};
use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, TaskBuilder};
use parking_lot::RwLock;
use smartstring::alias::String;
use std::{
    collections::HashMap,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::time::{sleep, timeout};

type TaskID = u64;

#[derive(Debug, Clone)]
pub struct TimerTask {
    pub task_id: TaskID,
    pub interval_minutes: u64,
    #[allow(unused)]
    pub last_run: i64, // Timestamp of last execution
}

pub struct Timer {
    /// cron manager
    pub delay_timer: Arc<RwLock<DelayTimer>>,

    /// save the current state - using RwLock for better read concurrency
    pub timer_map: Arc<RwLock<HashMap<String, TimerTask>>>,

    /// increment id - atomic counter for better performance
    pub timer_count: AtomicU64,

    /// Flag to mark if timer is initialized - atomic for better performance
    pub initialized: AtomicBool,
}

// Use singleton macro
singleton!(Timer, TIMER_INSTANCE);

impl Timer {
    fn new() -> Self {
        Self {
            delay_timer: Arc::new(RwLock::new(DelayTimerBuilder::default().build())),
            timer_map: Arc::new(RwLock::new(HashMap::new())),
            timer_count: AtomicU64::new(1),
            initialized: AtomicBool::new(false),
        }
    }

    /// Initialize timer with better error handling and atomic operations
    pub async fn init(&self) -> Result<()> {
        // Use compare_exchange for thread-safe initialization check
        if self
            .initialized
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            logging!(debug, Type::Timer, "Timer already initialized, skipping...");
            return Ok(());
        }

        // Initialize timer tasks
        if let Err(e) = self.refresh().await {
            // Reset initialization flag on error
            self.initialized.store(false, Ordering::SeqCst);
            logging_error!(Type::Timer, "Failed to initialize timer: {}", e);
            return Err(e);
        }

        // Log timer info first
        {
            let timer_map = self.timer_map.read();
            logging!(info, Type::Timer, "已注册的定时任务数量: {}", timer_map.len());

            for (uid, task) in timer_map.iter() {
                logging!(
                    info,
                    Type::Timer,
                    "注册了定时任务 - uid={}, interval={}min, task_id={}",
                    uid,
                    task.interval_minutes,
                    task.task_id
                );
            }
        }

        let cur_timestamp = chrono::Local::now().timestamp();

        // Collect profiles that need immediate update
        let profiles_to_update = if let Some(items) = Config::profiles().await.latest_arc().get_items() {
            items
                .iter()
                .filter_map(|item| {
                    let allow_auto_update = item.option.as_ref()?.allow_auto_update.unwrap_or_default();
                    if !allow_auto_update {
                        return None;
                    }

                    let interval = item.option.as_ref()?.update_interval? as i64;
                    let updated = item.updated? as i64;
                    let uid = item.uid.as_ref()?;

                    if interval > 0 && cur_timestamp - updated >= interval * 60 {
                        logging!(info, Type::Timer, "需要立即更新的配置: uid={}", uid);
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
            logging!(
                info,
                Type::Timer,
                "需要立即更新的配置数量: {}",
                profiles_to_update.len()
            );
            let timer_map = self.timer_map.read();
            let delay_timer = self.delay_timer.write();

            for uid in profiles_to_update {
                if let Some(task) = timer_map.get(&uid) {
                    logging!(info, Type::Timer, "立即执行任务: uid={}", uid);
                    if let Err(e) = delay_timer.advance_task(task.task_id) {
                        logging!(warn, Type::Timer, "Failed to advance task {}: {}", uid, e);
                    }
                }
            }
        }

        logging!(info, Type::Timer, "Timer initialization completed");
        Ok(())
    }

    /// Refresh timer tasks with better error handling
    pub async fn refresh(&self) -> Result<()> {
        // Generate diff outside of lock to minimize lock contention
        let diff_map = self.gen_diff().await;

        if diff_map.is_empty() {
            logging!(debug, Type::Timer, "No timer changes needed");
            return Ok(());
        }

        logging!(info, Type::Timer, "Refreshing {} timer tasks", diff_map.len());

        // Apply changes - first collect operations to perform without holding locks
        let mut operations_to_add: Vec<(String, TaskID, u64)> = Vec::new();
        let _operations_to_remove: Vec<String> = Vec::new();

        // Perform sync operations while holding locks
        {
            for (uid, diff) in diff_map {
                match diff {
                    DiffFlag::Del(tid) => {
                        self.timer_map.write().remove(&uid);
                        let value = self.delay_timer.write().remove_task(tid);
                        if let Err(e) = value {
                            logging!(
                                warn,
                                Type::Timer,
                                "Failed to remove task {} for uid {}: {}",
                                tid,
                                uid,
                                e
                            );
                        } else {
                            logging!(debug, Type::Timer, "Removed task {} for uid {}", tid, uid);
                        }
                    }
                    DiffFlag::Add(tid, interval) => {
                        let task = TimerTask {
                            task_id: tid,
                            interval_minutes: interval,
                            last_run: chrono::Local::now().timestamp(),
                        };

                        self.timer_map.write().insert(uid.clone(), task);
                        operations_to_add.push((uid, tid, interval));
                    }
                    DiffFlag::Mod(tid, interval) => {
                        // Remove old task first
                        let value = self.delay_timer.write().remove_task(tid);
                        if let Err(e) = value {
                            logging!(
                                warn,
                                Type::Timer,
                                "Failed to remove old task {} for uid {}: {}",
                                tid,
                                uid,
                                e
                            );
                        }

                        // Then add the new one
                        let task = TimerTask {
                            task_id: tid,
                            interval_minutes: interval,
                            last_run: chrono::Local::now().timestamp(),
                        };

                        self.timer_map.write().insert(uid.clone(), task);
                        operations_to_add.push((uid, tid, interval));
                    }
                }
            }
        } // Locks are dropped here

        // Now perform async operations without holding locks
        let delay_timer = self.delay_timer.write();
        for (uid, tid, interval) in operations_to_add {
            if let Err(e) = self.add_task(&delay_timer, uid.clone(), tid, interval) {
                logging_error!(Type::Timer, "Failed to add task for uid {}: {}", uid, e);
                // Rollback on failure - remove from timer_map
                self.timer_map.write().remove(&uid);
            } else {
                logging!(debug, Type::Timer, "Added task {} for uid {}", tid, uid);
            }
        }

        Ok(())
    }

    /// Generate map of profile UIDs to update intervals
    async fn gen_map(&self) -> HashMap<String, u64> {
        let mut new_map = HashMap::new();

        if let Some(items) = Config::profiles().await.latest_arc().get_items() {
            for item in items.iter() {
                if let Some(option) = item.option.as_ref()
                    && let Some(allow_auto_update) = option.allow_auto_update
                    && let (Some(interval), Some(uid)) = (option.update_interval, &item.uid)
                    && allow_auto_update
                    && interval > 0
                {
                    logging!(
                        debug,
                        Type::Timer,
                        "找到定时更新配置: uid={}, interval={}min",
                        uid,
                        interval
                    );
                    new_map.insert(uid.clone(), interval);
                }
            }
        }

        logging!(debug, Type::Timer, "生成的定时更新配置数量: {}", new_map.len());
        new_map
    }

    /// Generate differences between current and new timer configuration
    async fn gen_diff(&self) -> HashMap<String, DiffFlag> {
        let mut diff_map = HashMap::new();
        let new_map = self.gen_map().await;

        // Read lock for comparing current state
        let timer_map = self.timer_map.read();
        logging!(debug, Type::Timer, "当前 timer_map 大小: {}", timer_map.len());

        // Find tasks to modify or delete
        for (uid, task) in timer_map.iter() {
            match new_map.get(uid) {
                Some(&interval) if interval != task.interval_minutes => {
                    // Task exists but interval changed
                    logging!(
                        debug,
                        Type::Timer,
                        "定时任务间隔变更: uid={}, 旧={}, 新={}",
                        uid,
                        task.interval_minutes,
                        interval
                    );
                    diff_map.insert(uid.clone(), DiffFlag::Mod(task.task_id, interval));
                }
                None => {
                    // Task no longer needed
                    logging!(debug, Type::Timer, "定时任务已删除: uid={}", uid);
                    diff_map.insert(uid.clone(), DiffFlag::Del(task.task_id));
                }
                _ => {
                    // Task exists with same interval, no change needed
                    logging!(debug, Type::Timer, "定时任务保持不变: uid={}", uid);
                }
            }
        }

        // Find new tasks to add
        let mut next_id = self.timer_count.load(Ordering::Relaxed);
        let original_id = next_id;

        for (uid, &interval) in new_map.iter() {
            if !timer_map.contains_key(uid) {
                logging!(
                    debug,
                    Type::Timer,
                    "新增定时任务: uid={}, interval={}min",
                    uid,
                    interval
                );
                diff_map.insert(uid.clone(), DiffFlag::Add(next_id, interval));
                next_id += 1;
            }
        }

        // Update counter only if we added new tasks
        if next_id > original_id {
            self.timer_count.store(next_id, Ordering::Relaxed);
        }

        logging!(debug, Type::Timer, "定时任务变更数量: {}", diff_map.len());
        diff_map
    }

    /// Add a timer task with better error handling
    fn add_task(&self, delay_timer: &DelayTimer, uid: String, tid: TaskID, minutes: u64) -> Result<()> {
        logging!(
            info,
            Type::Timer,
            "Adding task: uid={}, id={}, interval={}min",
            uid,
            tid,
            minutes
        );

        // Create a task with reasonable retries and backoff
        let task = TaskBuilder::default()
            .set_task_id(tid)
            .set_maximum_parallel_runnable_num(1)
            .set_frequency_repeated_by_minutes(minutes)
            .spawn_async_routine(move || {
                let uid = uid.clone();
                Box::pin(async move {
                    Self::wait_until_resolve_done(Duration::from_millis(5000)).await;
                    Self::async_task(&uid).await;
                }) as Pin<Box<dyn std::future::Future<Output = ()> + Send>>
            })
            .context("failed to create timer task")?;

        delay_timer.add_task(task).context("failed to add timer task")?;

        Ok(())
    }

    /// Get next update time for a profile
    pub async fn get_next_update_time(&self, uid: &str) -> Option<i64> {
        logging!(info, Type::Timer, "获取下次更新时间，uid={}", uid);

        // First extract timer task data without holding the lock across await
        let task_interval = {
            let timer_map = self.timer_map.read();
            match timer_map.get(uid) {
                Some(t) => t.interval_minutes,
                None => {
                    logging!(warn, Type::Timer, "找不到对应的定时任务，uid={}", uid);
                    return None;
                }
            }
        };

        // Get the profile updated timestamp - now safe to await
        let items = {
            let profiles = Config::profiles().await;
            let profiles_guard = profiles.latest_arc();
            match profiles_guard.get_items() {
                Some(i) => i.clone(),
                None => {
                    logging!(warn, Type::Timer, "获取配置列表失败");
                    return None;
                }
            }
        };

        let profile = match items.iter().find(|item| item.uid.as_deref() == Some(uid)) {
            Some(p) => p,
            None => {
                logging!(warn, Type::Timer, "找不到对应的配置，uid={}", uid);
                return None;
            }
        };

        let updated = profile.updated.unwrap_or(0) as i64;

        // Calculate next update time
        if updated > 0 && task_interval > 0 {
            let next_time = updated + (task_interval as i64 * 60);
            logging!(info, Type::Timer, "计算得到下次更新时间: {}, uid={}", next_time, uid);
            Some(next_time)
        } else {
            logging!(
                warn,
                Type::Timer,
                "更新时间或间隔无效，updated={}, interval={}",
                updated,
                task_interval
            );
            None
        }
    }

    /// Emit update events for frontend notification
    fn emit_update_event(_uid: &str, _is_start: bool) {
        {
            if _is_start {
                super::handle::Handle::notify_profile_update_started(_uid.into());
            } else {
                super::handle::Handle::notify_profile_update_completed(_uid.into());
            }
        }
    }

    /// Async task with better error handling and logging
    async fn async_task(uid: &String) {
        let task_start = std::time::Instant::now();
        logging!(info, Type::Timer, "Running timer task for profile: {}", uid);

        match tokio::time::timeout(std::time::Duration::from_secs(40), async {
            Self::emit_update_event(uid, true);

            let is_current = Config::profiles().await.latest_arc().current.as_ref() == Some(uid);
            logging!(info, Type::Timer, "配置 {} 是否为当前激活配置: {}", uid, is_current);

            feat::update_profile(uid, None, is_current, false).await
        })
        .await
        {
            Ok(result) => match result {
                Ok(_) => {
                    let duration = task_start.elapsed().as_millis();
                    logging!(
                        info,
                        Type::Timer,
                        "Timer task completed successfully for uid: {} (took {}ms)",
                        uid,
                        duration
                    );
                }
                Err(e) => {
                    logging_error!(Type::Timer, "Failed to update profile uid {}: {}", uid, e);
                }
            },
            Err(_) => {
                logging_error!(Type::Timer, "Timer task timed out for uid: {}", uid);
            }
        }

        // Emit completed event
        Self::emit_update_event(uid, false);
    }

    async fn wait_until_resolve_done(max_wait: Duration) {
        let _ = timeout(max_wait, async {
            while !is_resolve_done() {
                logging!(debug, Type::Timer, "Waiting for resolve to be done...");
                sleep(Duration::from_millis(200)).await;
            }
        })
        .await;
    }
}

#[derive(Debug)]
enum DiffFlag {
    Del(TaskID),
    Add(TaskID, u64),
    Mod(TaskID, u64),
}
