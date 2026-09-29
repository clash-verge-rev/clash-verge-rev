use backon::{BackoffBuilder as _, ExponentialBackoff, ExponentialBuilder};
use std::{future::Future, num::NonZeroUsize, time::Duration};

#[derive(Clone, Copy, Debug)]
pub enum Backoff {
    Fixed(Duration),
    #[allow(dead_code)]
    Exponential {
        base: Duration,
        cap: Duration,
    },
}

#[derive(Clone, Copy, Debug)]
pub struct RetryPolicy {
    pub attempts: NonZeroUsize,
    pub backoff: Backoff,
    pub jitter: bool,
}

impl RetryPolicy {
    pub const fn fixed(attempts: NonZeroUsize, delay: Duration) -> Self {
        Self {
            attempts,
            backoff: Backoff::Fixed(delay),
            jitter: false,
        }
    }

    fn delays(self) -> ExponentialBackoff {
        let (base, cap, factor) = match self.backoff {
            Backoff::Fixed(delay) => (delay, delay, 1.0),
            Backoff::Exponential { base, cap } => (base, cap, 2.0),
        };
        let mut builder = ExponentialBuilder::default()
            .with_min_delay(base)
            .with_max_delay(cap)
            .with_factor(factor)
            .with_max_times(self.attempts.get() - 1);
        if self.jitter {
            builder = builder.with_jitter();
        }
        builder.build()
    }
}

pub enum RetryError<E> {
    Retry(E),
    Stop(E),
}

pub async fn retry<T: Send, E: Send, Fut: Future<Output = Result<T, RetryError<E>>> + Send>(
    policy: RetryPolicy,
    mut operation: impl FnMut(usize) -> Fut + Send,
) -> Result<T, E> {
    let mut result = operation(0).await;
    for (index, delay) in policy.delays().enumerate() {
        match result {
            Ok(_) | Err(RetryError::Stop(_)) => break,
            Err(RetryError::Retry(_)) => {
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
            }
        }
        result = operation(index + 1).await;
    }
    result.map_err(|error| match error {
        RetryError::Retry(error) | RetryError::Stop(error) => error,
    })
}

pub async fn try_strategies<
    S: Copy + Send,
    T: Send,
    E: Send,
    Fut: Future<Output = Result<T, E>> + Send,
    const N: usize,
>(
    first: S,
    rest: [S; N],
    mut operation: impl FnMut(S) -> Fut + Send,
) -> Result<(S, T), E> {
    retry(
        RetryPolicy {
            attempts: NonZeroUsize::MIN.saturating_add(N),
            backoff: Backoff::Fixed(Duration::ZERO),
            jitter: false,
        },
        move |attempt| {
            let strategy = if attempt == 0 { first } else { rest[attempt - 1] };
            let future = operation(strategy);
            async move { future.await.map(|value| (strategy, value)).map_err(RetryError::Retry) }
        },
    )
    .await
}

pub async fn retry_with_state<S: Send, T: Send, E: Send>(
    policy: RetryPolicy,
    mut state: S,
    mut operation: impl for<'a> FnMut(&'a mut S, usize) -> futures::future::BoxFuture<'a, Result<T, RetryError<E>>> + Send,
) -> Result<T, E> {
    let mut result = operation(&mut state, 0).await;
    for (index, delay) in policy.delays().enumerate() {
        match result {
            Ok(_) | Err(RetryError::Stop(_)) => break,
            Err(RetryError::Retry(_)) => {
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
            }
        }
        result = operation(&mut state, index + 1).await;
    }
    result.map_err(|error| match error {
        RetryError::Retry(error) | RetryError::Stop(error) => error,
    })
}

pub fn retry_sync<T, E>(
    policy: RetryPolicy,
    mut operation: impl FnMut(usize) -> Result<T, RetryError<E>>,
) -> Result<T, E> {
    let mut result = operation(0);
    for (index, delay) in policy.delays().enumerate() {
        match result {
            Ok(_) | Err(RetryError::Stop(_)) => break,
            Err(RetryError::Retry(_)) => {
                if !delay.is_zero() {
                    std::thread::sleep(delay);
                }
            }
        }
        result = operation(index + 1);
    }
    result.map_err(|error| match error {
        RetryError::Retry(error) | RetryError::Stop(error) => error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn retries_stop_at_success_terminal_error_or_attempt_limit() {
        let policy = RetryPolicy {
            attempts: NonZeroUsize::MIN.saturating_add(2),
            backoff: Backoff::Fixed(Duration::ZERO),
            jitter: false,
        };
        let mut calls = 0;
        let success = retry(policy, |attempt| {
            calls += 1;
            async move {
                if attempt == 1 {
                    Ok(7)
                } else {
                    Err(RetryError::Retry(attempt))
                }
            }
        })
        .await;
        assert_eq!((success, calls), (Ok(7), 2));
        calls = 0;
        let stopped = retry(policy, |_| {
            calls += 1;
            async move { Err::<(), _>(RetryError::Stop("terminal")) }
        })
        .await;
        assert_eq!((stopped, calls), (Err("terminal"), 1));
        calls = 0;
        let exhausted = retry(policy, |attempt| {
            calls += 1;
            async move { Err::<(), _>(RetryError::Retry(attempt)) }
        })
        .await;
        assert_eq!((exhausted, calls), (Err(2), 3));
    }

    #[tokio::test]
    async fn strategies_preserve_order_and_the_last_failure() {
        let mut visited = Vec::new();
        let result = try_strategies("direct", ["clash", "system"], |strategy| {
            visited.push(strategy);
            async move { Err::<(), _>(strategy) }
        })
        .await;
        assert_eq!(result, Err("system"));
        assert_eq!(visited, ["direct", "clash", "system"]);
    }

    #[tokio::test]
    async fn stateful_and_sync_retries_preserve_progress_and_stop() {
        let policy = RetryPolicy::fixed(NonZeroUsize::MIN.saturating_add(2), Duration::ZERO);
        let result = retry_with_state(policy, Vec::new(), |visited, attempt| {
            Box::pin(async move {
                visited.push(attempt);
                if visited.len() == 3 {
                    Ok(visited.clone())
                } else {
                    Err(RetryError::Retry(()))
                }
            })
        })
        .await;
        assert_eq!(result, Ok(vec![0, 1, 2]));
        let mut visited = Vec::new();
        let result = retry_sync(policy, |attempt| {
            visited.push(attempt);
            if attempt == 1 {
                Err::<(), _>(RetryError::Stop("terminal"))
            } else {
                Err(RetryError::Retry("retry"))
            }
        });
        assert_eq!(result, Err("terminal"));
        assert_eq!(visited, [0, 1]);
    }

    #[test]
    fn backoff_keeps_the_attempt_budget_and_exponential_cap() {
        let policy = RetryPolicy {
            attempts: NonZeroUsize::MIN.saturating_add(4),
            backoff: Backoff::Exponential {
                base: Duration::from_millis(10),
                cap: Duration::from_millis(25),
            },
            jitter: false,
        };
        assert_eq!(
            policy.delays().collect::<Vec<_>>(),
            [10, 20, 25, 25].map(Duration::from_millis)
        );
    }
}
