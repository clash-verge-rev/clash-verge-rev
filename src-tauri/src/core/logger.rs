use std::{
    str::FromStr as _,
    sync::{
        Arc,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
};

use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::WriterConfig;
use compact_str::CompactString;
use flexi_logger::{
    Cleanup, Criterion, DeferredNow, FileSpec, LogSpecBuilder, LogSpecification, LoggerHandle,
    writers::{FileLogWriter, FileLogWriterBuilder, LogWriter as _},
};
use log::{Level, LevelFilter, Record};
#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
use std::collections::VecDeque;
#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
use tauri::Emitter as _;

use crate::{
    core::service,
    singleton,
    utils::dirs::{self, service_log_dir, sidecar_log_dir},
};

/// tauri event `app-log` 的 payload schema；与前端 `src/hooks/use-log-data.ts`
/// 的 `AppLogPayload` interface 对齐（camelCase 字段）。加字段只改这个 struct，
/// 前端 TS 类型靠评审保证同步。
///
/// 在所有 feature 组合下都编译，让 Tauri command `get_app_log_history` 的
/// 签名保持稳定；只有主 logger（`cfg(not(any(feature = "tauri-dev",
/// feature = "tokio-trace")))`）下 ring buffer 才会被写入，其他 feature 替换
/// 了 flexi_logger，filter 不装、buffer 始终为空。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogRecord {
    /// 单调递增序号，由 `APP_LOG_SEQ` 原子分配。前端用它做 live listener 与
    /// history 拉取之间的竞态 dedup：history 返回后已 append 过的 seq 不会被
    /// live listener 再次 append（详情见 use-log-data.ts 的 seenSeqsRef 注释）。
    pub seq: u64,
    /// wall-clock 时间戳，`None` 表示系统时钟异常（`SystemTime::now()` 早于
    /// UNIX_EPOCH，罕见但真实存在：NTP 回拨 / VM 时钟漂移 / 用户错改 BIOS
    /// 时间）。前端 `use-log-data.ts` 在值缺失时回落到 `Date.now()` 渲染
    /// "接收时刻"，避免所有日志显示成 1970-01-01。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unix_ms: Option<u64>,
    pub level: String,
    pub source: String,
    pub message: String,
}

/// 为什么需要 ring buffer：`tauri::Emitter::emit` 在没有前端 listener 的情况
/// 下**静默丢弃** event，而 `useLogData` 里的 `listen("app-log", ...)` 仅在
/// 用户打开日志页时才注册——启动早期（sampler init、首次 sample、core_ready
/// trigger 等最有诊断价值的窗口）产生的 `logging!(_, Type::Network, ...)` 会
/// 在日志页打开之前被 drop 掉。mihomo 内核自己维护 log ring buffer + `/logs`
/// 历史回放接口，进日志页时可从 `getClashLogs()` 补回；对齐这一行为需要 CVR
/// 侧也为 app-log 维护历史缓冲。
///
/// 为什么不做 unbounded：避免 netmon 事件风暴下（网络切换抖动等）无上限吃
/// 内存；FIFO 淘汰最旧条目是可接受降级——启动期日志自然集中在 buffer 前段,
/// 稳态下前端应已挂上 listener 不再依赖 buffer。
///
/// 容量 500 基于典型桌面 netmon 事件频率（<10 条/hour light usage），覆盖
/// 约 50 小时；事件风暴下也够 cover 首 500 条，穿过"启动 → 日志页打开"的
/// 用户交互间隔。
#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
const APP_LOG_HISTORY_CAPACITY: usize = 500;

#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
static APP_LOG_SEQ: AtomicU64 = AtomicU64::new(0);

#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
static APP_LOG_HISTORY: OnceCell<Mutex<VecDeque<AppLogRecord>>> = OnceCell::new();

#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
fn app_log_history() -> &'static Mutex<VecDeque<AppLogRecord>> {
    APP_LOG_HISTORY.get_or_init(|| Mutex::new(VecDeque::with_capacity(APP_LOG_HISTORY_CAPACITY)))
}

#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
fn push_app_log_history(record: AppLogRecord) {
    let mut guard = app_log_history().lock();
    guard.push_back(record);
    // 用 `while` 而非单次 `pop_front`：当前 push_back 在 lock 内单线程串行，
    // 单次 pop 就够；但若未来重构让此函数可被多线程并发调用（例如拆成批量
    // push），或 CAPACITY 被动态下调，`if` 版本会让 buffer 瞬时超过 CAPACITY
    // 才回到上限。`while` 收敛到正确的不变式：`len <= CAPACITY`。
    while guard.len() > APP_LOG_HISTORY_CAPACITY {
        guard.pop_front();
    }
}

/// Tauri command 的实现入口。返回 buffer 的 owned 快照——前端
/// `useLogData::onConnected` 把它 prepend 到日志列表，让用户进日志页时能看
/// 到错过的 `[Network]` 条目。前端按 `seq` 做 dedup，避免 live listener 与
/// history 拉取竞态窗口下重复写入。
///
/// 为什么不支持 level filter 参数：容量 500 条全量 clone 比过滤 + 维护 seq
/// 连续性更简单；前端 `LOG_LEVEL_FILTERS` 在合流时按级别自行过滤即可。
#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
pub fn get_app_log_history_snapshot() -> Vec<AppLogRecord> {
    app_log_history().lock().iter().cloned().collect()
}

#[cfg(any(feature = "tauri-dev", feature = "tokio-trace"))]
#[allow(
    clippy::missing_const_for_fn,
    reason = "parallels the non-stub branch which locks a Mutex; keeping signatures identical avoids propagating const into the Tauri command wrapper"
)]
pub fn get_app_log_history_snapshot() -> Vec<AppLogRecord> {
    Vec::new()
}

/// flexi_logger `LogLineFilter` 扩展：继承原 `NoModuleFilter` 的模块屏蔽，
/// 额外截获 `target=="app"` 且消息以 `"[Network] "` 开头的 record，通过
/// tauri event `app-log` 实时推送到前端 GUI 日志列表。
///
/// 前缀字符串与 `clash_verge_logging::Type::Network` 的 `Display` 实现耦合；
/// `tests::app_log_prefix_invariant` 做编译期锚定，改动 Display 会 CI 报错。
/// 白名单逻辑集中在这一个 filter 内，logging crate 无需感知 tauri / AppHandle。
/// 要扩大白名单（比如放行 `[Config]` 日志），直接添加 `strip_prefix` 分支即可。
///
/// **覆盖范围**：仅 `logging!` 宏（格式 `"{} {}", type, msg` → `"[Network] msg"`）。
/// 兄弟宏 `logging_error!` 用 `"[{}] {}"` 模板给 type 额外套一层方括号，`Type::Network`
/// 的 `Display` 本身就含 `[...]`，最终落成 `"[[Network]] msg"`——**不会匹配**本 filter。
/// 需要让 error 路径进入 GUI 的调用点请改用 `logging!(error, Type::Network, ...)`。
/// **扩展路径**：若未来确实需要放行 `logging_error!(Type::Network, ...)`，在
/// `try_emit_app_log` 里把 `strip_prefix` 改成
/// `strip_prefix("[Network] ").or_else(|| rendered.strip_prefix("[[Network]] "))`
/// 即可，其余逻辑无需改动。
#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
struct AppLogFilter {
    blocked_modules: Vec<&'static str>,
}

#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
impl AppLogFilter {
    /// 对所有 logging! 宏落点（`target="app"`）且消息以 `"[Network] "` 开头的
    /// record 做分流：符合条件的全部进 ring buffer + emit，**不在本层做 level
    /// 过滤**。级别"**产生端**"决策完全交给上游——Rust log crate 的
    /// `LevelFilter` 已由 `Logger::init` 根据 `verge.app_log_level` 配置；任何
    /// 到达 filter 的 record 都是已被 log crate 放行的，本层不再做二次截断。
    ///
    /// 为什么不再在后端 filter 限 level：之前版本硬编码 `level() > Info` 丢
    /// Debug/Trace，让 `verge.app_log_level` 对 `[Network]` 部分失效——用户即
    /// 使把 `app_log_level` 调到 debug 也看不到 netmon 的 debug 日志进文件 /
    /// ring buffer / emit。现在改为完全遵从 `app_log_level`：想让 debug 级
    /// `[Network]` 日志被采集，只需在"杂项"面板把 `app_log_level` 调到 debug；
    /// 想收紧则反之。
    ///
    /// **与前端 `LOG_LEVEL_FILTERS` 的分层**（两者正交，不互斥）：
    /// - 后端 `app_log_level` 决定**产生**：什么级别的 record 进 Rust log 流 →
    ///   写文件日志 → 走 `AppLogFilter` → 进 ring buffer + emit。本 filter 是
    ///   这条产生链路的末端，不做级别判断。
    /// - 前端 `src/hooks/use-log-data.ts::LOG_LEVEL_FILTERS` 决定**展示**：已到
    ///   前端的 record（无论来自 mihomo core `/logs` WS 还是 `app-log`）中哪些
    ///   呈现在日志列表。它是展示层过滤器，**同时作用于两条通道**——
    ///   `use-log-data.ts` 在 mihomo live（handleMessage）、mihomo history
    ///   （onConnected 里的 filterLogsByLevel）、app-log history（onConnected
    ///   里的 for-of 过滤循环）、app-log live（listen 回调）**四个触点**都应用
    ///   此过滤；即便 `app_log_level=debug` 让 debug [Network] 进了 ring buffer,
    ///   用户在日志页切到 info 档时仍会在展示层被过滤掉。
    ///
    /// 用户想在日志页看到 debug 级 `[Network]` 日志需要**两处都放开**：
    /// (1) 杂项里 `app_log_level >= debug`（否则 record 根本不产生）；
    /// (2) 日志页 logLevel 选 debug 档（否则前端展示被过滤）。这是有意的分层,
    /// 不是 bug——产生成本（文件日志体积 + IPC 频率）由 (1) 控制，日常 UX 噪音
    /// 由 (2) 控制。
    ///
    /// 代价：ring buffer 填充速率随 `app_log_level` 变化，debug 档下 IPC 频率
    /// 略升；但 netmon 自身 debug 级调用稀疏，事件风暴下仍在可接受范围。
    fn try_emit_app_log(record: &Record<'_>) {
        if record.target() != "app" {
            return;
        }
        let rendered = record.args().to_string();
        let Some(body) = rendered.strip_prefix("[Network] ") else {
            return;
        };
        let level_name = match record.level() {
            Level::Error => "error",
            Level::Warn => "warn",
            Level::Info => "info",
            Level::Debug => "debug",
            Level::Trace => "trace",
        };
        let unix_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis() as u64);
        // 分配 seq 并构建 owned record。**先 push buffer 再 emit**——这样即使
        // 稍后 `APP_HANDLE.get()` 返回 None（极端重构场景）或 emit 失败，日志
        // 也已在历史缓冲中，用户进日志页时仍可通过 `get_app_log_history` 看到。
        let seq = APP_LOG_SEQ.fetch_add(1, Ordering::Relaxed);
        let event = AppLogRecord {
            seq,
            unix_ms,
            level: level_name.to_string(),
            source: "Network".to_string(),
            message: body.to_string(),
        };
        push_app_log_history(event.clone());
        // 防御性取 handle：lib.rs 里 `APP_HANDLE.set()` 先于 `Logger::init()`
        // 调用，且 flexi_logger 的 filter 仅在 `logger.start()` 之后才参与
        // record 流——稳态下此分支不可达。保留短路避免在极端重构场景（例如
        // 未来有人调换初始化顺序或引入另一个调用 `init()` 的路径）panic；
        // 此时 record 已入 buffer，live listener 缺席但 history 仍可回放。
        let Some(handle) = crate::APP_HANDLE.get() else {
            return;
        };
        let _ = handle.emit("app-log", event);
    }
}

#[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
impl flexi_logger::filter::LogLineFilter for AppLogFilter {
    fn write(
        &self,
        now: &mut DeferredNow,
        record: &Record<'_>,
        writer: &dyn flexi_logger::filter::LogLineWriter,
    ) -> std::io::Result<()> {
        // 沿用 NoModuleFilter 的前缀屏蔽逻辑（wry / tauri / tokio_tungstenite / ...）
        if let Some(module) = record.module_path() {
            for blocked in &self.blocked_modules {
                if module.starts_with(blocked) {
                    return Ok(());
                }
            }
        }
        writer.write(now, record)?;
        Self::try_emit_app_log(record);
        Ok(())
    }
}

pub struct Logger {
    handle: Arc<Mutex<Option<LoggerHandle>>>,
    sidecar_file_writer: Arc<RwLock<Option<FileLogWriter>>>,
    log_level: Arc<RwLock<LevelFilter>>,
    log_max_size: AtomicU64,
    log_max_count: AtomicUsize,
}

impl Default for Logger {
    fn default() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
            sidecar_file_writer: Arc::new(RwLock::new(None)),
            log_level: Arc::new(RwLock::new(LevelFilter::Info)),
            log_max_size: AtomicU64::new(128),
            log_max_count: AtomicUsize::new(8),
        }
    }
}

singleton!(Logger, LOGGER);

impl Logger {
    fn new() -> Self {
        Self::default()
    }

    pub async fn init(&self) -> Result<()> {
        let (log_level, log_max_size, log_max_count) = {
            let verge_guard = crate::config::Config::verge().await;
            let verge = verge_guard.latest_arc();
            (
                verge.get_log_level(),
                verge.app_log_max_size.unwrap_or(128),
                verge.app_log_max_count.unwrap_or(8),
            )
        };
        let log_level = std::env::var("RUST_LOG")
            .ok()
            .and_then(|v| log::LevelFilter::from_str(&v).ok())
            .unwrap_or(log_level);
        *self.log_level.write() = log_level;
        self.log_max_size.store(log_max_size, Ordering::SeqCst);
        self.log_max_count.store(log_max_count, Ordering::SeqCst);

        #[cfg(not(any(feature = "tauri-dev", feature = "tokio-trace")))]
        {
            let log_spec = Self::generate_log_spec(log_level);
            let log_dir = dirs::app_logs_dir()?;
            let logger = flexi_logger::Logger::with(log_spec)
                .log_to_file(FileSpec::default().directory(log_dir).basename(""))
                .duplicate_to_stdout(log_level.into())
                .format(clash_verge_logger::console_format)
                .format_for_files(clash_verge_logger::file_format_with_level)
                .rotate(
                    Criterion::Size(log_max_size * 1024),
                    flexi_logger::Naming::TimestampsCustomFormat {
                        current_infix: Some("latest"),
                        format: "%Y-%m-%d_%H-%M-%S",
                    },
                    Cleanup::KeepLogFiles(log_max_count),
                );

            let mut filter_modules = vec!["wry", "tokio_tungstenite", "tungstenite"];
            #[cfg(not(feature = "tracing"))]
            filter_modules.push("tauri");
            #[cfg(feature = "tracing")]
            filter_modules.extend(["tauri_plugin_mihomo", "kode_bridge"]);
            // AppLogFilter 继承模块屏蔽 + 对白名单 `[Network]` 日志分流到 tauri event
            let logger = logger.filter(Box::new(AppLogFilter {
                blocked_modules: filter_modules,
            }));

            let handle = logger.start()?;
            *self.handle.lock() = Some(handle);
        }

        let sidecar_file_writer = self.generate_sidecar_writer()?;
        *self.sidecar_file_writer.write() = Some(sidecar_file_writer);

        std::panic::set_hook(Box::new(move |info| {
            let payload = info
                .payload()
                .downcast_ref::<&str>()
                .unwrap_or(&"Unknown panic payload");
            let location = info
                .location()
                .map(|loc| format!("{}:{}", loc.file(), loc.line()))
                .unwrap_or_else(|| "Unknown location".to_string());
            logging!(error, Type::System, "Panic occurred at {}: {}", location, payload);
            if let Some(h) = Self::global().handle.lock().as_ref() {
                h.flush();
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }));

        Ok(())
    }

    fn generate_log_spec(log_level: LevelFilter) -> LogSpecification {
        let mut spec = LogSpecBuilder::new();
        let log_level = std::env::var("RUST_LOG")
            .ok()
            .and_then(|v| log::LevelFilter::from_str(&v).ok())
            .unwrap_or(log_level);
        spec.default(log_level);
        #[cfg(feature = "tracing")]
        spec.module("tauri", log::LevelFilter::Debug)
            .module("wry", log::LevelFilter::Off)
            .module("tauri_plugin_mihomo", log::LevelFilter::Off);
        spec.build()
    }

    fn generate_file_log_writer(&self) -> Result<FileLogWriterBuilder> {
        let log_dir = dirs::app_logs_dir()?;
        let log_max_size = self.log_max_size.load(Ordering::SeqCst);
        let log_max_count = self.log_max_count.load(Ordering::SeqCst);
        let flwb = FileLogWriter::builder(FileSpec::default().directory(log_dir).basename("")).rotate(
            Criterion::Size(log_max_size * 1024),
            flexi_logger::Naming::TimestampsCustomFormat {
                current_infix: Some("latest"),
                format: "%Y-%m-%d_%H-%M-%S",
            },
            Cleanup::KeepLogFiles(log_max_count),
        );
        Ok(flwb)
    }

    /// only update app log level
    pub fn update_log_level(&self, level: LevelFilter) -> Result<()> {
        *self.log_level.write() = level;
        let log_level = self.log_level.read().to_owned();
        if let Some(handle) = self.handle.lock().as_mut() {
            let log_spec = Self::generate_log_spec(log_level);
            handle.set_new_spec(log_spec);
            handle.adapt_duplication_to_stdout(log_level.into())?;
        } else {
            bail!("failed to get logger handle, make sure it init");
        };
        Ok(())
    }

    /// update app and mihomo core log config
    pub async fn update_log_config(&self, log_max_size: u64, log_max_count: usize) -> Result<()> {
        self.log_max_size.store(log_max_size, Ordering::SeqCst);
        self.log_max_count.store(log_max_count, Ordering::SeqCst);
        if let Some(handle) = self.handle.lock().as_ref() {
            let log_file_writer = self.generate_file_log_writer()?;
            handle.reset_flw(&log_file_writer)?;
        } else {
            bail!("failed to get logger handle, make sure it init");
        };
        let sidecar_writer = self.generate_sidecar_writer()?;
        *self.sidecar_file_writer.write() = Some(sidecar_writer);

        // update service writer config
        if service::is_service_ipc_path_exists() && service::is_service_available().await.is_ok() {
            let service_log_dir = dirs::path_to_str(&service_log_dir()?)?.into();
            clash_verge_service_ipc::update_writer(&WriterConfig {
                directory: service_log_dir,
                max_log_size: log_max_size * 1024,
                max_log_files: log_max_count,
            })
            .await?;
        }

        Ok(())
    }

    fn generate_sidecar_writer(&self) -> Result<FileLogWriter> {
        let sidecar_log_dir = sidecar_log_dir()?;
        let log_max_size = self.log_max_size.load(Ordering::SeqCst);
        let log_max_count = self.log_max_count.load(Ordering::SeqCst);
        Ok(FileLogWriter::builder(
            FileSpec::default()
                .directory(sidecar_log_dir)
                .basename("sidecar")
                .suppress_timestamp(),
        )
        .format(clash_verge_logger::file_format_without_level)
        .rotate(
            Criterion::Size(log_max_size * 1024),
            flexi_logger::Naming::TimestampsCustomFormat {
                current_infix: Some("latest"),
                format: "%Y-%m-%d_%H-%M-%S",
            },
            Cleanup::KeepLogFiles(log_max_count),
        )
        .try_build()?)
    }

    pub fn writer_sidecar_log(&self, level: Level, message: &CompactString) {
        if let Some(writer) = self.sidecar_file_writer.read().as_ref() {
            let mut now = DeferredNow::default();
            let args = format_args!("{}", message);
            let record = Record::builder().args(args).level(level).target("sidecar").build();
            let _ = writer.write(&mut now, &record);
        } else {
            logging!(error, Type::System, "failed to get sidecar file log writer");
        }
    }

    pub fn service_writer_config(&self) -> Result<WriterConfig> {
        let service_log_dir = dirs::path_to_str(&service_log_dir()?)?.into();
        let log_max_size = self.log_max_size.load(Ordering::SeqCst);
        let log_max_count = self.log_max_count.load(Ordering::SeqCst);
        let writer_config = WriterConfig {
            directory: service_log_dir,
            max_log_size: log_max_size * 1024,
            max_log_files: log_max_count,
        };

        Ok(writer_config)
    }
}

#[cfg(test)]
mod tests {
    use clash_verge_logging::Type;

    /// `AppLogFilter::try_emit_app_log` 的前缀嗅探依赖
    /// `Type::Network::Display` 输出 `"[Network]"`。若 logging crate 把 Display
    /// 改成其他文本（如 `"[network]"` / `"[Net]"` / 去中括号），GUI 日志分流
    /// 会**静默失配**：文件日志正常、app-log event 永不触发、无任何 CI 报错。
    /// 本测试把不变式钉在 CI 上，防止回归。
    #[test]
    fn app_log_prefix_invariant() {
        assert_eq!(format!("{}", Type::Network), "[Network]");
    }

    /// Display 不变式不够：`try_emit_app_log` 的 `strip_prefix("[Network] ")`
    /// 还依赖 `logging!` 宏本身用 `"{} {}"` 拼接 Type 和 message——即前缀必须
    /// 以单个空格收尾。若 logging crate 把宏模板改成 `"{}: {}"` / `"{} | {}"`
    /// 等，Display 测试仍然过，但 filter 会因尾随字符不匹配而漏掉所有
    /// `[Network]` 日志（同样静默失配）。本测试用 `format!` 复现宏的拼接，
    /// 把完整前缀（含空格）锚在 CI 上。
    #[test]
    fn app_log_full_prefix_invariant() {
        let rendered = format!("{} {}", Type::Network, "probe");
        assert!(
            rendered.starts_with("[Network] "),
            "logging! macro format changed: {rendered:?}"
        );
    }
}
