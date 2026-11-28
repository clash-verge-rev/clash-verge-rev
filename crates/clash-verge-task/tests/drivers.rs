use clash_verge_task::{
    countdown,
    scheduled_task::{self, Mailbox, Next, ScheduledTask},
    watch_task,
};
use std::{error::Error, future::ready, time::Duration};
use tokio::{
    sync::{mpsc, oneshot, watch},
    time::{Instant, advance, timeout},
};

type TestResult = Result<(), Box<dyn Error>>;

struct Schedule {
    due: Option<Instant>,
    completed: mpsc::UnboundedSender<bool>,
}

impl ScheduledTask for Schedule {
    type Input = Option<Instant>;
    type Work = Instant;
    type Output = ();

    fn on_input(&mut self, input: Self::Input, _: Instant) {
        self.due = self.due.into_iter().chain(input).min();
    }

    fn next(&mut self, now: Instant) -> Next<Instant> {
        match self.due {
            Some(due) if due <= now => {
                self.due = None;
                Next::Run(due)
            }
            Some(due) => Next::At(due),
            None => Next::Idle,
        }
    }

    fn finished(&mut self, _: Instant, result: std::thread::Result<()>, _: Instant) {
        let _ = self.completed.send(result.is_ok());
    }
}

fn request(mailbox: &Mailbox<Option<Instant>>, due: Instant) {
    mailbox.update(|pending| {
        if pending.is_some_and(|current| current <= due) {
            return false;
        }
        *pending = Some(due);
        true
    });
}

async fn receive<T: Send>(receiver: &mut mpsc::UnboundedReceiver<T>) -> Result<T, Box<dyn Error>> {
    timeout(Duration::from_secs(10), receiver.recv())
        .await?
        .ok_or_else(|| "driver event channel closed".into())
}

#[tokio::test(start_paused = true)]
async fn countdown_keeps_the_first_arm_until_it_expires() -> TestResult {
    let delay = Duration::from_secs(4);
    let (elapsed, mut events) = mpsc::unbounded_channel();
    let (countdown, driver) = countdown::new(
        move |_| Some(ready(delay)),
        move |input| {
            let _ = elapsed.send(input);
        },
    );
    let mut driver = Box::pin(driver);
    let start = Instant::now();
    countdown.arm(1);
    assert!(futures::poll!(driver.as_mut()).is_pending());
    advance(Duration::from_secs(2)).await;
    countdown.arm(2);
    let driver = tokio::spawn(driver);

    assert_eq!(receive(&mut events).await?, 1);
    assert_eq!(Instant::now() - start, delay);
    drop(countdown);
    driver.await?;
    assert!(events.try_recv().is_err());
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn ready_disarm_wins_and_the_next_arm_starts_a_new_countdown() -> TestResult {
    let delay = Duration::from_secs(4);
    let (elapsed, mut events) = mpsc::unbounded_channel();
    let (countdown, driver) = countdown::new(
        move |_| Some(ready(delay)),
        move |input| {
            let _ = elapsed.send(input);
        },
    );
    let mut driver = Box::pin(driver);
    countdown.arm(1);
    assert!(futures::poll!(driver.as_mut()).is_pending());
    advance(delay).await;
    countdown.disarm();
    countdown.arm(2);
    let rearmed_at = Instant::now();
    let driver = tokio::spawn(driver);

    assert_eq!(receive(&mut events).await?, 2);
    assert_eq!(Instant::now() - rearmed_at, delay);
    drop(countdown);
    driver.await?;
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn an_earlier_request_reschedules_an_idle_wait() -> TestResult {
    let (completed, mut results) = mpsc::unbounded_channel();
    let (mailbox, driver) = scheduled_task::new(Schedule { due: None, completed }, |_| async {});
    let mut driver = Box::pin(driver);
    let start = Instant::now();

    request(&mailbox, start + Duration::from_secs(8));
    assert!(futures::poll!(driver.as_mut()).is_pending());
    request(&mailbox, start + Duration::from_secs(2));
    let driver = tokio::spawn(driver);
    assert!(receive(&mut results).await?);
    assert_eq!(Instant::now() - start, Duration::from_secs(2));
    driver.abort();
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn active_work_finishes_before_one_coalesced_successor() -> TestResult {
    let (completed, mut results) = mpsc::unbounded_channel();
    let (started, mut runs) = mpsc::unbounded_channel();
    let (mailbox, driver) = scheduled_task::new(Schedule { due: None, completed }, move |due| {
        let (release, wait) = oneshot::channel();
        let _ = started.send((due, release));
        async move {
            let _ = wait.await;
        }
    });
    let driver = tokio::spawn(driver);
    let start = Instant::now();
    request(&mailbox, start);
    let (_, release) = receive(&mut runs).await?;

    let next = start + Duration::from_secs(2);
    request(&mailbox, start + Duration::from_secs(4));
    request(&mailbox, next);
    advance(Duration::from_secs(5)).await;
    assert!(runs.try_recv().is_err());
    assert!(results.try_recv().is_err());

    release.send(()).map_err(|()| "first job was dropped")?;
    assert!(receive(&mut results).await?);
    let (due, release) = receive(&mut runs).await?;
    assert_eq!(due, next);
    release.send(()).map_err(|()| "second job was dropped")?;
    assert!(receive(&mut results).await?);
    assert!(timeout(Duration::from_secs(1), runs.recv()).await.is_err());
    driver.abort();
    Ok(())
}

#[tokio::test(start_paused = true)]
#[allow(clippy::panic, reason = "inject an unwind into the execution future")]
async fn a_job_panic_reports_failure_and_allows_more_work() -> TestResult {
    let (completed, mut results) = mpsc::unbounded_channel();
    let start = Instant::now();
    let (mailbox, driver) = scheduled_task::new(Schedule { due: None, completed }, move |due| async move {
        if due == start {
            panic!("test job panic");
        }
    });
    let driver = tokio::spawn(driver);

    request(&mailbox, start);
    assert!(!receive(&mut results).await?);
    request(&mailbox, start + Duration::from_secs(1));
    assert!(receive(&mut results).await?);
    driver.abort();
    Ok(())
}

#[tokio::test(start_paused = true)]
#[allow(clippy::panic, reason = "inject an unwind after observing session replacement")]
async fn a_session_panic_does_not_consume_the_replacement() -> TestResult {
    let (plan, desired) = watch::channel(None);
    let (event, mut events) = mpsc::unbounded_channel();
    let panicked = event.clone();
    let driver = tokio::spawn(watch_task::run(
        desired,
        move |session, mut updates| {
            let event = event.clone();
            async move {
                let _ = event.send((session, false));
                if session == 1 && updates.changed().await.is_ok() {
                    panic!("test session panic");
                }
            }
        },
        move |session| {
            let _ = panicked.send((session, true));
        },
    ));

    plan.send_replace(Some(1));
    assert_eq!(receive(&mut events).await?, (1, false));
    plan.send_replace(Some(2));
    assert_eq!(receive(&mut events).await?, (1, true));
    assert_eq!(receive(&mut events).await?, (2, false));
    drop(plan);
    driver.await?;
    Ok(())
}
