use super::AsyncHandler;
use futures::FutureExt as _;
use parking_lot::Mutex;
use std::{future::Future, panic::AssertUnwindSafe, sync::Arc};
use tokio::{
    sync::Notify,
    time::{Instant, sleep_until},
};

pub(crate) enum Next<W> {
    Idle,
    At(Instant),
    Run(W),
}

pub(crate) trait ScheduledTask {
    type Input: Default;
    type Work: Copy + Send;
    type Output;

    fn on_input(&mut self, input: Self::Input, now: Instant);
    fn next(&mut self, now: Instant) -> Next<Self::Work>;
    fn finished(&mut self, work: Self::Work, result: std::thread::Result<Self::Output>, now: Instant);
}

pub(crate) struct Mailbox<I> {
    pending: Mutex<I>,
    changed: Notify,
}

impl<I> Mailbox<I> {
    pub(crate) fn update(&self, merge: impl FnOnce(&mut I) -> bool) {
        let changed = merge(&mut *self.pending.lock());
        if changed {
            self.changed.notify_one();
        }
    }
}

pub(crate) fn spawn<P, F, Fut>(policy: P, execute: F) -> Arc<Mailbox<P::Input>>
where
    P: ScheduledTask + Send + 'static,
    P::Input: Send + 'static,
    F: FnMut(P::Work) -> Fut + Send + 'static,
    Fut: Future<Output = P::Output> + Send + 'static,
{
    let inbox = Arc::new(Mailbox {
        pending: Mutex::default(),
        changed: Notify::new(),
    });
    let receiver = Arc::clone(&inbox);
    AsyncHandler::spawn(move || drive(policy, receiver, execute));
    inbox
}

async fn drive<P, F, Fut>(mut policy: P, inbox: Arc<Mailbox<P::Input>>, mut execute: F)
where
    P: ScheduledTask,
    F: FnMut(P::Work) -> Fut,
    Fut: Future<Output = P::Output>,
{
    loop {
        let input = std::mem::take(&mut *inbox.pending.lock());
        let now = Instant::now();
        policy.on_input(input, now);
        match policy.next(now) {
            Next::Idle => inbox.changed.notified().await,
            Next::At(due) => {
                tokio::select! {
                    _ = inbox.changed.notified() => {}
                    _ = sleep_until(due) => {}
                }
            }
            Next::Run(work) => {
                // Pending inputs merge while the job runs. They cannot interrupt its effects.
                let run = &mut execute;
                let result = AssertUnwindSafe(async move { run(work).await }).catch_unwind().await;
                policy.finished(work, result, Instant::now());
            }
        }
    }
}
