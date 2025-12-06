use crate::{
    config::{Config, IVerge},
    feat::create_local_backup_with_namer,
    process::AsyncHandler,
    utils::dirs::local_backup_dir,
};
use anyhow::Result;
use chrono::Local;
use clash_verge_logging::{Type, logging};
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI64, Ordering},
    },
    time::{Duration, UNIX_EPOCH},
};
use tokio::{
    fs,
    sync::{Mutex, watch},
};

const DEFAULT_INTERVAL_HOURS: u64 = 24;
const MIN_INTERVAL_HOURS: u64 = 1;
const MAX_INTERVAL_HOURS: u64 = 168;
const MIN_BACKUP_INTERVAL_SECS: i64 = 60;
const AUTO_BACKUP_KEEP: usize = 20;
const AUTO_MARKER: &str = "-auto-";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutoBackupTrigger {
    Scheduled,
    GlobalMerge,
    GlobalScript,
    ProfileChange,
}

impl AutoBackupTrigger {
    const fn slug(self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::GlobalMerge => "merge",
            Self::GlobalScript => "script",
            Self::ProfileChange => "profile",
        }
    }

    const fn is_schedule(self) -> bool {
        matches!(self, Self::Scheduled)
    }
}

#[derive(Clone, Copy, Debug)]
struct AutoBackupSettings {
    schedule_enabled: bool,
    interval_hours: u64,
    change_enabled: bool,
}

impl AutoBackupSettings {
    fn from_verge(verge: &IVerge) -> Self {
        let interval = verge
            .auto_backup_interval_hours
            .unwrap_or(DEFAULT_INTERVAL_HOURS)
            .clamp(MIN_INTERVAL_HOURS, MAX_INTERVAL_HOURS);

        Self {
            schedule_enabled: verge.enable_auto_backup_schedule.unwrap_or(false),
            interval_hours: interval,
            change_enabled: verge.auto_backup_on_change.unwrap_or(true),
        }
    }
}

impl Default for AutoBackupSettings {
    fn default() -> Self {
        Self {
            schedule_enabled: false,
            interval_hours: DEFAULT_INTERVAL_HOURS,
            change_enabled: true,
        }
    }
}

pub struct AutoBackupManager {
    settings: Arc<RwLock<AutoBackupSettings>>,
    settings_tx: watch::Sender<AutoBackupSettings>,
    runner_started: AtomicBool,
    exec_lock: Mutex<()>,
    last_backup: AtomicI64,
}

impl AutoBackupManager {
    pub fn global() -> &'static Self {
        static INSTANCE: OnceCell<AutoBackupManager> = OnceCell::new();
        INSTANCE.get_or_init(|| {
            let (tx, _rx) = watch::channel(AutoBackupSettings::default());
            Self {
                settings: Arc::new(RwLock::new(AutoBackupSettings::default())),
                settings_tx: tx,
                runner_started: AtomicBool::new(false),
                exec_lock: Mutex::new(()),
                last_backup: AtomicI64::new(0),
            }
        })
    }

    pub async fn init(&self) -> Result<()> {
        let settings = Self::load_settings().await;
        {
            *self.settings.write() = settings;
        }
        let _ = self.settings_tx.send(settings);
        self.maybe_start_runner(settings);
        Ok(())
    }

    pub async fn refresh_settings(&self) -> Result<()> {
        let settings = Self::load_settings().await;
        {
            *self.settings.write() = settings;
        }
        let _ = self.settings_tx.send(settings);
        self.maybe_start_runner(settings);
        Ok(())
    }

    pub fn trigger_backup(trigger: AutoBackupTrigger) {
        AsyncHandler::spawn(move || async move {
            if let Err(err) = Self::global().execute_trigger(trigger).await {
                logging!(
                    warn,
                    Type::Backup,
                    "Auto backup execution failed ({:?}): {err:#?}",
                    trigger
                );
            }
        });
    }

    fn maybe_start_runner(&self, settings: AutoBackupSettings) {
        if settings.schedule_enabled {
            self.ensure_runner();
        }
    }

    fn ensure_runner(&self) {
        if self.runner_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let mut rx = self.settings_tx.subscribe();
        AsyncHandler::spawn(move || async move {
            Self::run_scheduler(&mut rx).await;
        });
    }

    async fn run_scheduler(rx: &mut watch::Receiver<AutoBackupSettings>) {
        let mut current = *rx.borrow();
        loop {
            if !current.schedule_enabled {
                if rx.changed().await.is_err() {
                    break;
                }
                current = *rx.borrow();
                continue;
            }

            let duration = Duration::from_secs(current.interval_hours.saturating_mul(3600));
            let sleeper = tokio::time::sleep(duration);
            tokio::pin!(sleeper);

            tokio::select! {
                _ = &mut sleeper => {
                    if let Err(err) = Self::global()
                        .execute_trigger(AutoBackupTrigger::Scheduled)
                        .await
                    {
                        logging!(
                            warn,
                            Type::Backup,
                            "Scheduled auto backup failed: {err:#?}"
                        );
                    }
                }
                changed = rx.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    current = *rx.borrow();
                }
            }
        }
    }

    async fn execute_trigger(&self, trigger: AutoBackupTrigger) -> Result<()> {
        let snapshot = *self.settings.read();

        if trigger.is_schedule() && !snapshot.schedule_enabled {
            return Ok(());
        }
        if !trigger.is_schedule() && !snapshot.change_enabled {
            return Ok(());
        }

        if !self.should_run_now() {
            return Ok(());
        }

        let _guard = self.exec_lock.lock().await;
        if !self.should_run_now() {
            return Ok(());
        }

        let file_name = create_local_backup_with_namer(|name| append_auto_suffix(name, trigger.slug()).into()).await?;
        self.last_backup.store(Local::now().timestamp(), Ordering::Release);

        if let Err(err) = cleanup_auto_backups().await {
            logging!(warn, Type::Backup, "Failed to cleanup old auto backups: {err:#?}");
        }

        logging!(info, Type::Backup, "Auto backup created ({:?}): {}", trigger, file_name);
        Ok(())
    }

    fn should_run_now(&self) -> bool {
        let last = self.last_backup.load(Ordering::Acquire);
        if last == 0 {
            return true;
        }
        let now = Local::now().timestamp();
        now.saturating_sub(last) >= MIN_BACKUP_INTERVAL_SECS
    }

    async fn load_settings() -> AutoBackupSettings {
        let verge = Config::verge().await;
        AutoBackupSettings::from_verge(&verge.latest_arc())
    }
}

fn append_auto_suffix(file_name: &str, slug: &str) -> String {
    match file_name.rsplit_once('.') {
        Some((stem, ext)) => format!("{stem}{AUTO_MARKER}{slug}.{ext}"),
        None => format!("{file_name}{AUTO_MARKER}{slug}"),
    }
}

async fn cleanup_auto_backups() -> Result<()> {
    if AUTO_BACKUP_KEEP == 0 {
        return Ok(());
    }

    let backup_dir = local_backup_dir()?;
    if !backup_dir.exists() {
        return Ok(());
    }

    let mut entries = match fs::read_dir(&backup_dir).await {
        Ok(dir) => dir,
        Err(err) => {
            logging!(warn, Type::Backup, "Failed to read backup directory: {err:#?}");
            return Ok(());
        }
    };

    let mut files: Vec<(PathBuf, u64)> = Vec::new();

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = match entry.file_name().into_string() {
            Ok(name) => name,
            Err(_) => continue,
        };

        if !file_name.contains(AUTO_MARKER) {
            continue;
        }

        let modified = entry
            .metadata()
            .await
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|dur| dur.as_secs())
            .unwrap_or(0);

        files.push((path, modified));
    }

    if files.len() <= AUTO_BACKUP_KEEP {
        return Ok(());
    }

    files.sort_by_key(|(_, ts)| *ts);
    let remove_count = files.len() - AUTO_BACKUP_KEEP;
    for (path, _) in files.into_iter().take(remove_count) {
        if let Err(err) = fs::remove_file(&path).await {
            logging!(
                warn,
                Type::Backup,
                "Failed to remove auto backup {}: {err:#?}",
                path.display()
            );
        }
    }

    Ok(())
}
