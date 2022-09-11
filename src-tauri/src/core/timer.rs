use super::Core;
use crate::utils::help::get_now;
use crate::{data::Data, log_if_err};
use anyhow::{Context, Result};
use delay_timer::prelude::{DelayTimer, DelayTimerBuilder, TaskBuilder};
use std::collections::HashMap;

type TaskID = u64;

pub struct Timer {
  /// cron manager
  delay_timer: DelayTimer,

  /// save the current state
  timer_map: HashMap<String, (TaskID, u64)>,

  /// increment id
  timer_count: TaskID,
}

impl Timer {
  pub fn new() -> Self {
    Timer {
      delay_timer: DelayTimerBuilder::default().build(),
      timer_map: HashMap::new(),
      timer_count: 1,
    }
  }

  /// Correctly update all cron tasks
  pub fn refresh(&mut self) -> Result<()> {
    let diff_map = self.gen_diff();

    for (uid, diff) in diff_map.into_iter() {
      match diff {
        DiffFlag::Del(tid) => {
          let _ = self.timer_map.remove(&uid);
          log_if_err!(self.delay_timer.remove_task(tid));
        }
        DiffFlag::Add(tid, val) => {
          let _ = self.timer_map.insert(uid.clone(), (tid, val));
          log_if_err!(self.add_task(uid, tid, val));
        }
        DiffFlag::Mod(tid, val) => {
          let _ = self.timer_map.insert(uid.clone(), (tid, val));
          log_if_err!(self.delay_timer.remove_task(tid));
          log_if_err!(self.add_task(uid, tid, val));
        }
      }
    }

    Ok(())
  }

  /// restore timer
  pub fn restore(&mut self) -> Result<()> {
    self.refresh()?;

    let cur_timestamp = get_now(); // seconds

    let global = Data::global();
    let profiles = global.profiles.lock();

    profiles
      .get_items()
      .unwrap_or(&vec![])
      .iter()
      .filter(|item| item.uid.is_some() && item.updated.is_some() && item.option.is_some())
      .filter(|item| {
        // mins to seconds
        let interval = item.option.as_ref().unwrap().update_interval.unwrap_or(0) as usize * 60;
        let updated = item.updated.unwrap();
        return interval > 0 && cur_timestamp - updated >= interval;
      })
      .for_each(|item| {
        let uid = item.uid.as_ref().unwrap();
        if let Some((task_id, _)) = self.timer_map.get(uid) {
          log_if_err!(self.delay_timer.advance_task(*task_id));
        }
      });

    Ok(())
  }

  /// generate a uid -> update_interval map
  fn gen_map(&self) -> HashMap<String, u64> {
    let global = Data::global();
    let profiles = global.profiles.lock();

    let mut new_map = HashMap::new();

    if let Some(items) = profiles.get_items() {
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
  fn gen_diff(&mut self) -> HashMap<String, DiffFlag> {
    let mut diff_map = HashMap::new();

    let new_map = self.gen_map();
    let cur_map = &self.timer_map;

    cur_map.iter().for_each(|(uid, (tid, val))| {
      let new_val = new_map.get(uid).unwrap_or(&0);

      if *new_val == 0 {
        diff_map.insert(uid.clone(), DiffFlag::Del(*tid));
      } else if new_val != val {
        diff_map.insert(uid.clone(), DiffFlag::Mod(*tid, *new_val));
      }
    });

    let mut count = self.timer_count;

    new_map.iter().for_each(|(uid, val)| {
      if cur_map.get(uid).is_none() {
        diff_map.insert(uid.clone(), DiffFlag::Add(count, *val));

        count += 1;
      }
    });

    self.timer_count = count;

    diff_map
  }

  /// add a cron task
  fn add_task(&self, uid: String, tid: TaskID, minutes: u64) -> Result<()> {
    let core = Core::global();

    let task = TaskBuilder::default()
      .set_task_id(tid)
      .set_maximum_parallel_runnable_num(1)
      .set_frequency_repeated_by_minutes(minutes)
      // .set_frequency_repeated_by_seconds(minutes) // for test
      .spawn_async_routine(move || Self::async_task(core.to_owned(), uid.to_owned()))
      .context("failed to create timer task")?;

    self
      .delay_timer
      .add_task(task)
      .context("failed to add timer task")?;

    Ok(())
  }

  /// the task runner
  async fn async_task(core: Core, uid: String) {
    log::info!(target: "app", "running timer task `{uid}`");
    log_if_err!(core.update_profile_item(uid, None).await);
  }
}

#[derive(Debug)]
enum DiffFlag {
  Del(TaskID),
  Add(TaskID, u64),
  Mod(TaskID, u64),
}
