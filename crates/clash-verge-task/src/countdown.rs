use std::{future::Future, time::Duration};
use tokio::{sync::mpsc, time::sleep};

enum Command<T> {
    Arm(T),
    Disarm,
}

pub struct Countdown<T> {
    commands: mpsc::UnboundedSender<Command<T>>,
}

impl<T> Countdown<T> {
    pub fn arm(&self, input: T) {
        let _ = self.commands.send(Command::Arm(input));
    }

    pub fn disarm(&self) {
        let _ = self.commands.send(Command::Disarm);
    }
}

/// Create a countdown with a caller-owned driver. An active countdown ignores
/// additional arms. Disarm and channel closure take precedence over expiry.
///
/// Return `None` from `delay` to reject an arm before starting the countdown.
/// The delay future may be dropped on disarm, including while it loads the duration.
pub fn new<T, Fut>(
    mut delay: impl FnMut(T) -> Option<Fut> + Send,
    mut elapsed: impl FnMut(T) + Send,
) -> (Countdown<T>, impl Future<Output = ()> + Send)
where
    T: Copy + Send,
    Fut: Future<Output = Duration> + Send,
{
    let (commands, mut receiver) = mpsc::unbounded_channel();
    let driver = async move {
        while let Some(command) = receiver.recv().await {
            let Command::Arm(input) = command else { continue };
            let Some(delay) = delay(input) else { continue };
            let countdown = async { sleep(delay.await).await };
            tokio::pin!(countdown);
            loop {
                tokio::select! {
                    biased;
                    command = receiver.recv() => match command {
                        Some(Command::Arm(_)) => {}
                        Some(Command::Disarm) => break,
                        None => return,
                    },
                    () = &mut countdown => {
                        elapsed(input);
                        break;
                    }
                }
            }
        }
    };
    (Countdown { commands }, driver)
}
