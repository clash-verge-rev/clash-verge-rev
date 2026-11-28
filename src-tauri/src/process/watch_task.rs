use futures::FutureExt as _;
use std::{future::Future, panic::AssertUnwindSafe};
use tokio::sync::watch;

pub(crate) async fn run<T, F, Fut>(
    mut desired: watch::Receiver<Option<T>>,
    mut run: F,
    mut on_panic: impl FnMut(T) + Send,
) where
    T: Clone + Send + Sync,
    F: FnMut(T, watch::Receiver<Option<T>>) -> Fut + Send,
    Fut: Future<Output = ()> + Send,
{
    while desired.changed().await.is_ok() {
        let state = desired.borrow_and_update().clone();
        if let Some(state) = state {
            // Cancellation can consume updates on this clone without skipping them in the owner.
            let updates = desired.clone();
            if AssertUnwindSafe(async { run(state.clone(), updates).await })
                .catch_unwind()
                .await
                .is_err()
            {
                on_panic(state);
            }
        }
    }
}
