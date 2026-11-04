use std::sync::Arc;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use super::store::SQLiteStore;
use super::types::TrafficRecord;
use clash_verge_logging::{Type, logging};

/// Flush once this many records are buffered.
const BATCH_SIZE: usize = 200;
/// Flush at least this often, so the exit-loss window stays small.
const FLUSH_INTERVAL: Duration = Duration::from_secs(2);

/// Buffers records on a dedicated thread and writes them to SQLite in batches.
pub struct RecordBatcher {
    store: Arc<SQLiteStore>,
}

impl RecordBatcher {
    pub const fn new(store: Arc<SQLiteStore>) -> Self {
        Self { store }
    }

    /// Spawns the writer thread. It exits after the sender side is dropped and
    /// both the channel contents and the buffer have been flushed.
    pub fn spawn(self, record_rx: Receiver<TrafficRecord>) -> std::thread::JoinHandle<()> {
        #[expect(clippy::expect_used)]
        std::thread::Builder::new()
            .name("traffic-stats-batcher".into())
            .spawn(move || {
                let store = self.store;
                let mut buffer: Vec<TrafficRecord> = Vec::with_capacity(BATCH_SIZE);

                loop {
                    match record_rx.recv_timeout(FLUSH_INTERVAL) {
                        Ok(record) => {
                            buffer.push(record);
                            if buffer.len() >= BATCH_SIZE {
                                flush_buffer(&store, &mut buffer);
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            flush_buffer(&store, &mut buffer);
                        }
                        Err(RecvTimeoutError::Disconnected) => {
                            // Drain whatever is still queued, then exit.
                            while let Ok(record) = record_rx.try_recv() {
                                buffer.push(record);
                                if buffer.len() >= BATCH_SIZE {
                                    flush_buffer(&store, &mut buffer);
                                }
                            }
                            flush_buffer(&store, &mut buffer);
                            break;
                        }
                    }
                }
                logging!(debug, Type::System, "Traffic stats batcher thread exited");
            })
            .expect("failed to spawn traffic-stats-batcher thread")
    }
}

fn flush_buffer(store: &SQLiteStore, buffer: &mut Vec<TrafficRecord>) {
    if buffer.is_empty() {
        return;
    }

    let count = buffer.len();
    let records = std::mem::take(buffer);

    if let Err(err) = store.insert_batch(&records) {
        // Keep the loss visible in logs; retrying could block the writer forever.
        logging!(
            error,
            Type::System,
            "Traffic stats: failed to write {} records, data lost: {err}",
            count
        );
    }
}
