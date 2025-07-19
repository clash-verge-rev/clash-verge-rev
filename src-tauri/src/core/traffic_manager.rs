use crate::ipc::IpcManager;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::time;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrafficData {
    pub up: u64,
    pub down: u64,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryData {
    pub inuse: u64,
    pub oslimit: Option<u64>,
    pub timestamp: u64,
}

pub struct TrafficManager {
    traffic_data: Arc<Mutex<TrafficData>>,
    memory_data: Arc<Mutex<MemoryData>>,
    is_running: Arc<Mutex<bool>>,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl TrafficManager {
    pub fn new() -> Self {
        Self {
            traffic_data: Arc::new(Mutex::new(TrafficData::default())),
            memory_data: Arc::new(Mutex::new(MemoryData::default())),
            is_running: Arc::new(Mutex::new(false)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        *self.is_running.lock()
    }

    pub fn get_traffic_data(&self) -> TrafficData {
        self.traffic_data.lock().clone()
    }

    pub fn get_memory_data(&self) -> MemoryData {
        self.memory_data.lock().clone()
    }

    pub fn start(&self) -> Result<(), String> {
        let mut is_running = self.is_running.lock();
        if *is_running {
            return Ok(());
        }

        log::info!(target: "app", "启动流量管理器 (IPC模式)");
        *is_running = true;

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        *self.shutdown_tx.lock() = Some(shutdown_tx);

        let traffic_data = Arc::clone(&self.traffic_data);
        let memory_data = Arc::clone(&self.memory_data);
        let is_running_clone = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let shutdown_rx = shutdown_rx;

            // 启动流量数据收集任务
            let traffic_data_clone = Arc::clone(&traffic_data);
            let traffic_task = tokio::spawn(async move {
                Self::collect_traffic_data(traffic_data_clone).await;
            });

            // 启动内存数据收集任务
            let memory_data_clone = Arc::clone(&memory_data);
            let memory_task = tokio::spawn(async move {
                Self::collect_memory_data(memory_data_clone).await;
            });

            // 等待关闭信号
            let _ = shutdown_rx.await;
            log::info!(target: "app", "流量管理器接收到关闭信号");

            // 取消任务
            traffic_task.abort();
            memory_task.abort();

            *is_running_clone.lock() = false;
            log::info!(target: "app", "流量管理器已停止");
        });

        Ok(())
    }

    pub fn stop(&self) {
        let mut is_running = self.is_running.lock();
        if !*is_running {
            return;
        }

        log::info!(target: "app", "停止流量管理器");
        *is_running = false;

        if let Some(shutdown_tx) = self.shutdown_tx.lock().take() {
            let _ = shutdown_tx.send(());
        }
    }

    async fn collect_traffic_data(traffic_data: Arc<Mutex<TrafficData>>) {
        log::info!(target: "app", "开始收集流量数据 (IPC模式)");

        let mut interval = time::interval(Duration::from_secs(1));
        let mut consecutive_errors = 0;

        loop {
            interval.tick().await;

            match IpcManager::global().get_traffic().await {
                Ok(data) => {
                    consecutive_errors = 0; // 重置错误计数
                    if let (Some(up), Some(down)) = (data["up"].as_u64(), data["down"].as_u64()) {
                        let mut traffic = traffic_data.lock();
                        traffic.up = up;
                        traffic.down = down;
                        traffic.timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;
                        log::debug!(target: "app", "更新流量数据: up={up}, down={down}");
                    }
                }
                Err(e) => {
                    consecutive_errors += 1;
                    log::error!(target: "app", "IPC 获取流量数据失败 (错误次数: {consecutive_errors}): {e}");

                    // 如果连续错误太多，增加等待时间
                    if consecutive_errors >= 5 {
                        log::warn!(target: "app", "流量数据获取连续失败，等待10秒后重试");
                        time::sleep(Duration::from_secs(10)).await;
                        consecutive_errors = 0; // 重置计数
                    } else {
                        time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        }
    }

    async fn collect_memory_data(memory_data: Arc<Mutex<MemoryData>>) {
        log::info!(target: "app", "开始收集内存数据 (IPC模式)");

        let mut interval = time::interval(Duration::from_secs(1));
        let mut consecutive_errors = 0;

        loop {
            interval.tick().await;

            match IpcManager::global().get_memory().await {
                Ok(data) => {
                    consecutive_errors = 0; // 重置错误计数
                    if let Some(inuse) = data["inuse"].as_u64() {
                        let mut memory = memory_data.lock();
                        memory.inuse = inuse;
                        memory.oslimit = data["oslimit"].as_u64();
                        memory.timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;
                        log::debug!(target: "app", "更新内存数据: inuse={inuse}");
                    }
                }
                Err(e) => {
                    consecutive_errors += 1;
                    log::error!(target: "app", "IPC 获取内存数据失败 (错误次数: {consecutive_errors}): {e}");

                    // 如果连续错误太多，增加等待时间
                    if consecutive_errors >= 5 {
                        log::warn!(target: "app", "内存数据获取连续失败，等待10秒后重试");
                        time::sleep(Duration::from_secs(10)).await;
                        consecutive_errors = 0; // 重置计数
                    } else {
                        time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        }
    }
}

impl Drop for TrafficManager {
    fn drop(&mut self) {
        self.stop();
    }
}
