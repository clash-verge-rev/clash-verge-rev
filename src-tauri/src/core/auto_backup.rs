use crate::{
    config::{Config, IVerge},
    feat::create_local_backup_with_namer,
    process::scheduled_task::{self, Mailbox, Next, ScheduledTask},
    utils::dirs::local_backup_dir,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use std::{
    path::PathBuf,
    sync::{Arc, LazyLock},
    time::{Duration, UNIX_EPOCH},
};
use tokio::{fs, time::Instant};

const DEFAULT_INTERVAL_HOURS: u64 = 24;
const MIN_INTERVAL_HOURS: u64 = 1;
const MAX_INTERVAL_HOURS: u64 = 168;
const MIN_BACKUP_INTERVAL: Duration = Duration::from_secs(60);
const AUTO_BACKUP_KEEP: usize = 20;
const AUTO_MARKER: &str = "-auto-";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutoBackupTrigger {
    Scheduled,
    GlobalMerge,
    GlobalScript,
}

impl AutoBackupTrigger {
    const fn slug(self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::GlobalMerge => "merge",
            Self::GlobalScript => "script",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AutoBackupSettings {
    schedule_enabled: bool,
    interval_hours: u64,
    change_enabled: bool,
}

impl AutoBackupSettings {
    fn interval(self) -> Option<Duration> {
        self.schedule_enabled
            .then(|| Duration::from_secs(self.interval_hours * 3600))
    }

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

#[derive(Default)]
struct BackupInput {
    settings: Option<AutoBackupSettings>,
    restart_schedule: bool,
    clear_pending_edit: bool,
    edit_before_settings: Option<AutoBackupTrigger>,
    edit: Option<AutoBackupTrigger>,
}

impl BackupInput {
    fn update_settings(&mut self, settings: AutoBackupSettings) -> bool {
        if self.settings == Some(settings) {
            return false;
        }
        // A pending off/on or interval round trip still restarts the countdown.
        self.restart_schedule |= self
            .settings
            .is_some_and(|previous| previous.interval() != settings.interval());
        self.settings = Some(settings);
        if !settings.change_enabled {
            self.clear_pending_edit = true;
            self.edit = None;
            self.edit_before_settings = None;
        }
        true
    }

    const fn request_edit(&mut self, trigger: AutoBackupTrigger) -> bool {
        let pending = match self.settings {
            Some(settings) if settings.change_enabled => &mut self.edit,
            Some(_) => return false,
            None => &mut self.edit_before_settings,
        };
        if pending.is_some() {
            return false;
        }
        *pending = Some(trigger);
        true
    }
}

static BACKUP_REQUESTS: LazyLock<Arc<Mailbox<BackupInput>>> =
    LazyLock::new(|| scheduled_task::spawn(BackupSchedule::default(), execute_backup));

pub(crate) async fn init() {
    let _write = Config::lock_config_write().await;
    publish_settings(&Config::verge().await.data_arc());
}

pub(crate) fn publish_settings(verge: &IVerge) {
    let settings = AutoBackupSettings::from_verge(verge);
    BACKUP_REQUESTS.update(|pending| pending.update_settings(settings));
}

pub(crate) fn trigger_backup(trigger: AutoBackupTrigger) {
    BACKUP_REQUESTS.update(|pending| pending.request_edit(trigger));
}

#[derive(Default)]
struct BackupSchedule {
    settings: AutoBackupSettings,
    due: Option<Instant>,
    edit: Option<AutoBackupTrigger>,
    last_backup: Option<Instant>,
}

impl ScheduledTask for BackupSchedule {
    type Input = BackupInput;
    type Work = AutoBackupTrigger;
    type Output = Result<Instant>;

    fn on_input(&mut self, input: BackupInput, now: Instant) {
        if input.clear_pending_edit {
            self.edit = None;
        }
        let previous_edit = if self.settings.change_enabled {
            input.edit_before_settings
        } else {
            None
        };
        if let Some(settings) = input.settings {
            if input.restart_schedule || self.settings.interval() != settings.interval() {
                self.due = settings.interval().map(|interval| now + interval);
            }
            self.settings = settings;
        }
        if self.settings.change_enabled {
            self.edit = self.edit.or(previous_edit).or(input.edit);
        } else {
            self.edit = None;
        }
    }

    fn next(&mut self, now: Instant) -> Next<AutoBackupTrigger> {
        let throttled = self.last_backup.is_some_and(|last| now - last < MIN_BACKUP_INTERVAL);
        if self.due.is_some_and(|due| due <= now) {
            self.due = None;
            if !throttled {
                return Next::Run(AutoBackupTrigger::Scheduled);
            }
            self.due = self.settings.interval().map(|interval| now + interval);
        }

        if let Some(edit) = self.edit.take()
            && !throttled
        {
            return Next::Run(edit);
        }
        self.due.map_or(Next::Idle, Next::At)
    }

    fn finished(&mut self, trigger: AutoBackupTrigger, result: std::thread::Result<Self::Output>, now: Instant) {
        if trigger == AutoBackupTrigger::Scheduled {
            self.due = self.settings.interval().map(|interval| now + interval);
        }
        match result {
            Ok(Ok(created_at)) => self.last_backup = Some(created_at),
            Ok(Err(err)) => logging!(warn, Type::Backup, "Auto backup failed ({trigger:?}): {err:#}"),
            Err(_) => logging!(error, Type::Backup, "Auto backup panicked ({trigger:?})"),
        }
    }
}

async fn execute_backup(trigger: AutoBackupTrigger) -> Result<Instant> {
    let file_name = create_local_backup_with_namer(|name| append_auto_suffix(name, trigger.slug()).into()).await?;
    let created_at = Instant::now();

    if let Err(err) = cleanup_auto_backups().await {
        logging!(warn, Type::Backup, "Failed to cleanup old auto backups: {err:#?}");
    }

    logging!(info, Type::Backup, "Auto backup created ({trigger:?}): {file_name}");
    Ok(created_at)
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
            .map_or(0, |dur| dur.as_secs());

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
