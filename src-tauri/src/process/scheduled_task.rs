use super::AsyncHandler;
use std::{future::Future, sync::Arc};

pub(crate) use clash_verge_task::scheduled_task::{Mailbox, Next, ScheduledTask};

pub(crate) fn spawn<P, F, Fut>(policy: P, execute: F) -> Arc<Mailbox<P::Input>>
where
    P: ScheduledTask + Send + 'static,
    P::Input: Send + 'static,
    F: FnMut(P::Work) -> Fut + Send + 'static,
    Fut: Future<Output = P::Output> + Send + 'static,
{
    let (mailbox, driver) = clash_verge_task::scheduled_task::new(policy, execute);
    AsyncHandler::spawn(move || driver);
    mailbox
}
