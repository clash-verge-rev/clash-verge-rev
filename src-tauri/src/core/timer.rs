use crate::{config::Config, feat, logging, logging_error, utils::logging::Type};
use anyhow::{Context, Result};
use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, TaskBuilder};
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
use std::{collections::HashMap, sync::Arc};

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

    /// increment id - kept as mutex since it's just a counter
    pub timer_count: Arc<Mutex<TaskID>>,

    /// Flag to mark if timer is initialized - atomic for better performance
    pub initialized: Arc<std::sync::atomic::AtomicBool>,
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
            logging!(debug, Type::Timer, "Timer already initialized, skipping...");
            return Ok(());
        }

        logging!(info, Type::Timer, true, "Initializing timer...");

        // Initialize timer tasks
        if let Err(e) = self.refresh() {
            // Reset initialization flag on error
            self.initialized
                .store(false, std::sync::atomic::Ordering::SeqCst);
            logging_error!(Type::Timer, false, "Failed to initialize timer: {}", e);
            return Err(e);
        }

        let timer_map = self.timer_map.read();
        logging!(
            info,
            Type::Timer,
            "已注册的定时任务数量: {}",
            timer_map.len()
        );

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
    pub fn refresh(&self) -> Result<()> {
        // Generate diff outside of lock to minimize lock contention
        let diff_map = self.gen_diff();

        if diff_map.is_empty() {
            logging!(debug, Type::Timer, "No timer changes needed");
            return Ok(());
        }

        logging!(
            info,
            Type::Timer,
            "Refreshing {} timer tasks",
            diff_map.len()
        );

        // Apply changes while holding locks
        let mut timer_map = self.timer_map.write();
        let mut delay_timer = self.delay_timer.write();

        for (uid, diff) in diff_map {
            match diff {
                DiffFlag::Del(tid) => {
                    timer_map.remove(&uid);
                    if let Err(e) = delay_timer.remove_task(tid) {
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

                    timer_map.insert(uid.clone(), task);

                    if let Err(e) = self.add_task(&mut delay_timer, uid.clone(), tid, interval) {
                        logging_error!(Type::Timer, "Failed to add task for uid {}: {}", uid, e);
                        timer_map.remove(&uid); // Rollback on failure
                    } else {
                        logging!(debug, Type::Timer, "Added task {} for uid {}", tid, uid);
                    }
                }
                DiffFlag::Mod(tid, interval) => {
                    // Remove old task first
                    if let Err(e) = delay_timer.remove_task(tid) {
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

                    timer_map.insert(uid.clone(), task);

                    if let Err(e) = self.add_task(&mut delay_timer, uid.clone(), tid, interval) {
                        logging_error!(Type::Timer, "Failed to update task for uid {}: {}", uid, e);
                        timer_map.remove(&uid); // Rollback on failure
                    } else {
                        logging!(debug, Type::Timer, "Updated task {} for uid {}", tid, uid);
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
            }
        }

        logging!(
            debug,
            Type::Timer,
            "生成的定时更新配置数量: {}",
            new_map.len()
        );
        new_map
    }

    /// Generate differences between current and new timer configuration
    fn gen_diff(&self) -> HashMap<String, DiffFlag> {
        let mut diff_map = HashMap::new();
        let new_map = self.gen_map();

        // Read lock for comparing current state
        let timer_map = self.timer_map.read();
        logging!(
            debug,
            Type::Timer,
            "当前 timer_map 大小: {}",
            timer_map.len()
        );

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
        let mut next_id = *self.timer_count.lock();

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
        if next_id > *self.timer_count.lock() {
            *self.timer_count.lock() = next_id;
        }

        logging!(debug, Type::Timer, "定时任务变更数量: {}", diff_map.len());
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

    /// Get next update time for a profile
    pub fn get_next_update_time(&self, uid: &str) -> Option<i64> {
        logging!(info, Type::Timer, "获取下次更新时间，uid={}", uid);

        let timer_map = self.timer_map.read();
        let task = match timer_map.get(uid) {
            Some(t) => t,
            None => {
                logging!(warn, Type::Timer, "找不到对应的定时任务，uid={}", uid);
                return None;
            }
        };

        // Get the profile updated timestamp
        let profiles_config = Config::profiles();
        let profiles = profiles_config.latest();
        let items = match profiles.get_items() {
            Some(i) => i,
            None => {
                logging!(warn, Type::Timer, "获取配置列表失败");
                return None;
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
        if updated > 0 && task.interval_minutes > 0 {
            let next_time = updated + (task.interval_minutes as i64 * 60);
            logging!(
                info,
                Type::Timer,
                "计算得到下次更新时间: {}, uid={}",
                next_time,
                uid
            );
            Some(next_time)
        } else {
            logging!(
                warn,
                Type::Timer,
                "更新时间或间隔无效，updated={}, interval={}",
                updated,
                task.interval_minutes
            );
            None
        }
    }

    /// Emit update events for frontend notification
    fn emit_update_event(_uid: &str, _is_start: bool) {
        #[cfg(any(feature = "verge-dev", feature = "default"))]
        {
            if _is_start {
                super::handle::Handle::notify_profile_update_started(_uid.to_string());
            } else {
                super::handle::Handle::notify_profile_update_completed(_uid.to_string());
            }
        }
    }

    /// Async task with better error handling and logging
    async fn async_task(uid: String) {
        let task_start = std::time::Instant::now();
        logging!(info, Type::Timer, "Running timer task for profile: {}", uid);

        match tokio::time::timeout(std::time::Duration::from_secs(40), async {
            Self::emit_update_event(&uid, true);

            let is_current = Config::profiles().latest().current.as_ref() == Some(&uid);
            logging!(
                info,
                Type::Timer,
                "配置 {} 是否为当前激活配置: {}",
                uid,
                is_current
            );

            feat::update_profile(uid.clone(), None, Some(is_current)).await
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
                logging_error!(Type::Timer, false, "Timer task timed out for uid: {}", uid);
            }
        }

        // Emit completed event
        Self::emit_update_event(&uid, false);
    }
}

#[derive(Debug)]
enum DiffFlag {
    Del(TaskID),
    Add(TaskID, u64),
    Mod(TaskID, u64),
}
