use super::{handle::Handle, notification::FrontendEvent};
use anyhow::Result;
use parking_lot::Mutex;
use std::{cell::RefCell, future::Future, time::Duration};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refresh {
    Clash,
    Verge,
    Profiles,
    Proxies,
}

tokio::task_local! {
    static PENDING: RefCell<Vec<Refresh>>;
}

const REFRESH_WINDOW: Duration = Duration::from_millis(20);
static BATCH: RefreshBatch = RefreshBatch(Mutex::new(Vec::new()));

#[derive(Default)]
struct RefreshBatch(Mutex<Vec<Refresh>>);

impl RefreshBatch {
    fn enqueue(&self, refresh: Refresh) -> bool {
        let mut pending = self.0.lock();
        let start_window = pending.is_empty();
        if !pending.contains(&refresh) {
            pending.push(refresh);
        }
        start_window
    }

    async fn flush(&self, emit: impl Fn(Refresh)) {
        // A fixed window bounds latency even under a continuous stream of refreshes.
        tokio::time::sleep(REFRESH_WINDOW).await;
        let refreshes = std::mem::take(&mut *self.0.lock());
        for refresh in refreshes {
            emit(refresh);
        }
    }
}

pub fn announce(refresh: Refresh) {
    if PENDING.try_with(|pending| pending.borrow_mut().push(refresh)).is_err() && BATCH.enqueue(refresh) {
        crate::AsyncHandler::spawn(|| BATCH.flush(emit));
    }
}

fn emit(refresh: Refresh) {
    Handle::send_event(match refresh {
        Refresh::Clash => FrontendEvent::RefreshClash,
        Refresh::Verge => FrontendEvent::RefreshVerge,
        Refresh::Profiles => FrontendEvent::RefreshProfiles,
        Refresh::Proxies => FrontendEvent::RefreshProxyConfig,
    });
}

async fn collect_committed<T: Send>(operation: impl Future<Output = Result<T>> + Send) -> Result<(T, Vec<Refresh>)> {
    PENDING
        .scope(RefCell::new(Vec::new()), async {
            let value = operation.await?;
            let refreshes = PENDING.with(|pending| pending.take());
            Ok((value, refreshes))
        })
        .await
}

pub async fn after_commit<T: Send>(operation: impl Future<Output = Result<T>> + Send) -> Result<T> {
    let (value, refreshes) = collect_committed(operation).await?;
    // Nested transactions hand their notifications to the outer transaction.
    for refresh in refreshes {
        announce(refresh);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn only_successful_transactions_publish_refreshes() -> Result<()> {
        let (_, refreshes) = collect_committed(async {
            announce(Refresh::Clash);
            after_commit(async {
                announce(Refresh::Verge);
                Ok(())
            })
            .await?;
            let failed = after_commit(async {
                announce(Refresh::Profiles);
                Err::<(), _>(anyhow::anyhow!("persistence failed"))
            })
            .await;
            assert!(failed.is_err());
            announce(Refresh::Clash);
            Ok(())
        })
        .await?;
        assert_eq!(refreshes, [Refresh::Clash, Refresh::Verge, Refresh::Clash]);
        Ok(())
    }

    #[tokio::test]
    async fn bursts_keep_each_refresh_kind_and_rearm_during_delivery() -> Result<()> {
        let batch = RefreshBatch::default();
        let delivered = Mutex::new(Vec::new());
        assert!(batch.enqueue(Refresh::Clash));
        for refresh in [Refresh::Verge, Refresh::Clash, Refresh::Profiles, Refresh::Proxies] {
            assert!(!batch.enqueue(refresh));
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            batch
                .flush(|refresh| {
                    delivered.lock().push(refresh);
                    if refresh == Refresh::Clash {
                        assert!(batch.enqueue(Refresh::Clash));
                        assert!(!batch.enqueue(Refresh::Clash));
                    }
                })
                .await;
            batch.flush(|refresh| delivered.lock().push(refresh)).await;
        })
        .await?;
        assert_eq!(
            *delivered.lock(),
            [
                Refresh::Clash,
                Refresh::Verge,
                Refresh::Profiles,
                Refresh::Proxies,
                Refresh::Clash
            ]
        );
        assert!(batch.enqueue(Refresh::Verge));
        Ok(())
    }
}
