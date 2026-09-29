use super::{handle::Handle, notification::FrontendEvent};
use anyhow::Result;
use std::{cell::RefCell, future::Future};

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

pub fn announce(refresh: Refresh) {
    if PENDING.try_with(|pending| pending.borrow_mut().push(refresh)).is_err() {
        emit(refresh);
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
}
