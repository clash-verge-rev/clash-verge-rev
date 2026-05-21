use crate::{config::Config, feat, process::AsyncHandler, singleton, utils::resolve::is_resolve_done};
use anyhow::Result;
use clash_verge_logging::{Type, logging, logging_error};
use parking_lot::RwLock;
use smartstring::alias::String;
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::watch,
    time::{sleep, timeout},
};
use tokio_stream::StreamExt as _;
use tokio_util::time::DelayQueue;

pub struct Timer {
    pub notify_tx: watch::Sender<HashMap<String, u64>>,
    pub timer_map: Arc<RwLock<HashMap<String, u64>>>,
    pub initialized: AtomicBool,
}

singleton!(Timer, TIMER_INSTANCE);

impl Timer {
    fn new() -> Self {
        let (notify_tx, _) = watch::channel(HashMap::new());
        Self {
            notify_tx,
            timer_map: Arc::new(RwLock::new(HashMap::new())),
            initialized: AtomicBool::new(false),
        }
    }

    pub async fn init(&self) -> Result<()> {
        if self
            .initialized
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            logging!(debug, Type::Timer, "Timer already initialized, skipping...");
            return Ok(());
        }

        if let Err(e) = self.refresh().await {
            self.initialized.store(false, Ordering::SeqCst);
            logging_error!(Type::Timer, "Failed to initialize timer: {}", e);
            return Err(e);
        }

        {
            let timer_map = self.timer_map.read();
            logging!(debug, Type::Timer, "已注册的定时任务数量: {}", timer_map.len());
            for (uid, interval) in timer_map.iter() {
                logging!(
                    debug,
                    Type::Timer,
                    "注册了定时任务 - uid={}, interval={}min",
                    uid,
                    interval
                );
            }
        }

        let mut notify_rx = self.notify_tx.subscribe();

        AsyncHandler::spawn(move || async move {
            loop {
                let current_tasks = notify_rx.borrow_and_update().clone();

                if current_tasks.is_empty() {
                    logging!(debug, Type::Timer, "当前无定时任务，调度中心静默中...");
                    if notify_rx.changed().await.is_err() {
                        break;
                    }
                    continue;
                }

                let mut queue = DelayQueue::new();
                for (uid, interval_minutes) in current_tasks {
                    let delay = Duration::from_secs(interval_minutes * 60);
                    queue.insert((uid, interval_minutes), delay);
                }

                logging!(debug, Type::Timer, "统一调度中心已就绪，正在轮询时间轮...");

                loop {
                    tokio::select! {
                        Some(expired) = queue.next() => {
                            let (uid, interval_minutes) = expired.into_inner();
                            logging!(info, Type::Timer, "时钟信号触发，开始执行定时任务: uid={}", uid);

                            let uid_clone = uid.clone();
                            AsyncHandler::spawn(move || async move {
                                Self::wait_until_resolve_done(Duration::from_millis(5000)).await;
                                Self::async_task(&uid_clone).await;
                            });

                            let next_delay = Duration::from_secs(interval_minutes * 60);
                            queue.insert((uid, interval_minutes), next_delay);
                        }

                        res = notify_rx.changed() => {
                            if res.is_err() {
                                return;
                            }
                            logging!(debug, Type::Timer, "接收到定时任务变更通知，重建统一时间轮中...");
                            break;
                        }
                    }
                }
            }
        });

        let cur_timestamp = chrono::Local::now().timestamp();
        if let Some(items) = Config::profiles().await.latest_arc().get_items() {
            for item in items.iter() {
                if let Some(option) = item.option.as_ref()
                    && let Some(allow_auto_update) = option.allow_auto_update
                    && allow_auto_update
                    && let Some(interval) = option.update_interval
                    && interval > 0
                    && let Some(uid) = item.uid.as_ref()
                    && let Some(updated) = item.updated
                    && cur_timestamp - (updated as i64) >= (interval as i64) * 60
                {
                    logging!(info, Type::Timer, "立即执行到期落后任务: uid={}", uid);
                    let uid_clone = uid.clone();
                    AsyncHandler::spawn(move || async move {
                        Self::wait_until_resolve_done(Duration::from_millis(5000)).await;
                        Self::async_task(&uid_clone).await;
                    });
                }
            }
        }

        logging!(info, Type::Timer, "Timer initialization completed");
        Ok(())
    }

    pub async fn refresh(&self) -> Result<()> {
        let new_map = self.gen_map().await;

        {
            let mut cache = self.timer_map.write();
            if *cache == new_map {
                logging!(debug, Type::Timer, "No timer changes needed");
                return Ok(());
            }

            logging!(
                info,
                Type::Timer,
                "Refreshing timer tasks map, count: {}",
                new_map.len()
            );
            *cache = new_map.clone();
            drop(cache);

            let _ = self.notify_tx.send(new_map);
        }

        Ok(())
    }

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
                    new_map.insert(uid.clone(), interval);
                }
            }
        }
        new_map
    }

    pub async fn get_next_update_time(&self, uid: &str) -> Option<i64> {
        logging!(debug, Type::Timer, "获取下次更新时间，uid={}", uid);

        let task_interval = *self.timer_map.read().get(uid)?;
        let profiles = Config::profiles().await;
        let profiles_guard = profiles.latest_arc();
        let items = profiles_guard.get_items()?;

        let profile = items.iter().find(|item| item.uid.as_deref() == Some(uid))?;
        let updated = profile.updated.unwrap_or(0) as i64;

        if updated > 0 {
            Some(updated + (task_interval as i64 * 60))
        } else {
            None
        }
    }

    fn emit_update_event(uid: &String, is_start: bool) {
        if is_start {
            super::handle::Handle::notify_profile_update_started(uid);
        } else {
            super::handle::Handle::notify_profile_update_completed(uid);
        }
    }

    async fn async_task(uid: &String) {
        let task_start = std::time::Instant::now();
        logging!(debug, Type::Timer, "Running timer task for profile: {}", uid);

        match tokio::time::timeout(std::time::Duration::from_secs(40), async {
            Self::emit_update_event(uid, true);

            let is_current = Config::profiles().await.latest_arc().current.as_ref() == Some(uid);
            logging!(debug, Type::Timer, "配置 {} 是否为当前激活配置: {}", uid, is_current);

            feat::update_profile(uid, None, is_current, false, false).await
        })
        .await
        {
            Ok(Ok(_)) => {
                logging!(
                    info,
                    Type::Timer,
                    "Timer task completed for uid: {} (took {}ms)",
                    uid,
                    task_start.elapsed().as_millis()
                );
            }
            Ok(Err(e)) => logging_error!(Type::Timer, "Failed to update profile uid {}: {}", uid, e),
            Err(_) => logging_error!(Type::Timer, "Timer task timed out for uid: {}", uid),
        }

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
