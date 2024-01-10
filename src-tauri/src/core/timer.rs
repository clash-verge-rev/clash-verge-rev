use crate::config::Config;
use crate::feat;
use anyhow::{Context, Result};
use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, TaskBuilder};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

type TaskID = u64;

pub struct Timer {
    /// cron manager
    delay_timer: Arc<Mutex<DelayTimer>>,

    /// save the current state
    timer_map: Arc<Mutex<HashMap<String, (TaskID, u64)>>>,

    /// increment id
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
        self.refresh()?;

        let cur_timestamp = chrono::Local::now().timestamp();

        let timer_map = self.timer_map.lock();
        let delay_timer = self.delay_timer.lock();

        if let Some(items) = Config::profiles().latest().get_items() {
            items
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
                })
        }

        Ok(())
    }

    /// Correctly update all cron tasks
    pub fn refresh(&self) -> Result<()> {
        let diff_map = self.gen_diff();

        let mut timer_map = self.timer_map.lock();
        let mut delay_timer = self.delay_timer.lock();

        for (uid, diff) in diff_map.into_iter() {
            match diff {
                DiffFlag::Del(tid) => {
                    let _ = timer_map.remove(&uid);
                    crate::log_err!(delay_timer.remove_task(tid));
                }
                DiffFlag::Add(tid, val) => {
                    let _ = timer_map.insert(uid.clone(), (tid, val));
                    crate::log_err!(self.add_task(&mut delay_timer, uid, tid, val));
                }
                DiffFlag::Mod(tid, val) => {
                    let _ = timer_map.insert(uid.clone(), (tid, val));
                    crate::log_err!(delay_timer.remove_task(tid));
                    crate::log_err!(self.add_task(&mut delay_timer, uid, tid, val));
                }
            }
        }

        Ok(())
    }

    /// generate a uid -> update_interval map
    fn gen_map(&self) -> HashMap<String, u64> {
        let mut new_map = HashMap::new();

        if let Some(items) = Config::profiles().latest().get_items() {
            for item in items.iter() {
                if item.option.is_some() {
                    let option = item.option.as_ref().unwrap();
                    let interval = option.update_interval.unwrap_or(0);

                    if interval > 0 {
                        new_map.insert(item.uid.clone().unwrap(), interval);
                    }
                }
            }
        }

        new_map
    }

    /// generate the diff map for refresh
    fn gen_diff(&self) -> HashMap<String, DiffFlag> {
        let mut diff_map = HashMap::new();

        let timer_map = self.timer_map.lock();

        let new_map = self.gen_map();
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
    fn add_task(
        &self,
        delay_timer: &mut DelayTimer,
        uid: String,
        tid: TaskID,
        minutes: u64,
    ) -> Result<()> {
        let task = TaskBuilder::default()
            .set_task_id(tid)
            .set_maximum_parallel_runnable_num(1)
            .set_frequency_repeated_by_minutes(minutes)
            // .set_frequency_repeated_by_seconds(minutes) // for test
            .spawn_async_routine(move || Self::async_task(uid.to_owned()))
            .context("failed to create timer task")?;

        delay_timer
            .add_task(task)
            .context("failed to add timer task")?;

        Ok(())
    }

    /// the task runner
    async fn async_task(uid: String) {
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
