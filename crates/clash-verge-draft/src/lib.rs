use parking_lot::Mutex;
use std::sync::Arc;
use std::sync::atomic::{
    AtomicBool,
    Ordering::{Acquire, Relaxed, Release},
};
use tokio::sync::Notify;

pub type SharedDraft<T> = Arc<Box<T>>;
// (committed_snapshot, optional_draft_snapshot)
type DraftData<T> = (SharedDraft<T>, Option<SharedDraft<T>>);
// Retry one scheduler turn before parking on Notify for long async updates.
const DATA_MODIFY_FAST_RETRY_YIELDS: usize = 1;

#[derive(Debug)]
struct DraftInner<T> {
    data: Mutex<DraftData<T>>,
    data_modifying: AtomicBool,
    data_modify_notify: Notify,
}

struct DataModifyPermit<'a>(&'a AtomicBool, &'a Notify);

impl Drop for DataModifyPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Release);
        self.1.notify_one();
    }
}

/// Draft 管理：committed 与 optional draft 都以 Arc<Box<T>> 存储。
#[derive(Debug, Clone)]
pub struct Draft<T> {
    inner: Arc<DraftInner<T>>,
}

impl<T: Clone> Draft<T> {
    #[inline]
    pub fn new(data: T) -> Self {
        Self {
            inner: Arc::new(DraftInner {
                data: Mutex::new((Arc::new(Box::new(data)), None)),
                data_modifying: AtomicBool::new(false),
                data_modify_notify: Notify::new(),
            }),
        }
    }
    /// 以 Arc<Box<T>> 的形式获取当前“已提交（正式）”数据的快照（零拷贝，仅 clone Arc）
    #[inline]
    pub fn data_arc(&self) -> SharedDraft<T> {
        let guard = self.inner.data.lock();
        Arc::clone(&guard.0)
    }

    /// 获取当前（草稿若存在则返回草稿，否则返回已提交）的快照
    /// 这也是零拷贝：只 clone Arc，不 clone T
    #[inline]
    pub fn latest_arc(&self) -> SharedDraft<T> {
        let guard = self.inner.data.lock();
        guard.1.clone().unwrap_or_else(|| Arc::clone(&guard.0))
    }

    /// 通过闭包以可变方式编辑草稿（在闭包中我们给出 &mut T）
    /// - 延迟拷贝：如果只有这一个 Arc 引用，则直接修改，不会克隆 T；
    /// - 若草稿被其他读者共享，Arc::make_mut 会做一次 T.clone（最小必要拷贝）。
    #[inline]
    pub fn edit_draft<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&mut T) -> R,
    {
        let mut guard = self.inner.data.lock();
        let mut draft_arc = guard.1.take().unwrap_or_else(|| Arc::clone(&guard.0));
        let data_mut = Arc::make_mut(&mut draft_arc);
        let result = f(data_mut.as_mut());
        guard.1 = Some(draft_arc);
        result
    }

    /// 将草稿提交到已提交位置（替换），并清除草稿
    #[inline]
    pub fn apply(&self) {
        let mut guard = self.inner.data.lock();
        if let Some(d) = guard.1.take() {
            guard.0 = d;
        }
    }

    /// 丢弃草稿（如果存在）
    #[inline]
    pub fn discard(&self) {
        let mut guard = self.inner.data.lock();
        guard.1 = None;
    }

    /// 异步地以拥有 Box<T> 的方式修改已提交数据：将克隆一次已提交数据到本地，
    /// 异步闭包返回新的 Box<T>（替换已提交数据）和业务返回值 R。
    #[inline]
    pub async fn with_data_modify<F, Fut, R>(&self, f: F) -> Result<R, anyhow::Error>
    where
        T: Send + Sync + 'static,
        F: FnOnce(T) -> Fut + Send,
        Fut: std::future::Future<Output = Result<(T, R), anyhow::Error>> + Send,
    {
        let _permit = self.acquire_data_modify_permit().await;
        let (local, original_arc) = {
            let guard = self.inner.data.lock();
            let arc = Arc::clone(&guard.0);
            ((**arc).clone(), arc)
        };
        let (new_local, res) = f(local).await?;
        let mut guard = self.inner.data.lock();
        if !Arc::ptr_eq(&guard.0, &original_arc) {
            return Err(anyhow::anyhow!(
                "Optimistic lock failed: Committed data has changed during async operation"
            ));
        }
        guard.0 = Arc::new(Box::new(new_local));
        Ok(res)
    }

    #[inline]
    fn try_acquire_data_modify_permit(&self) -> Option<DataModifyPermit<'_>> {
        self.inner
            .data_modifying
            .compare_exchange(false, true, Acquire, Relaxed)
            .ok()
            .map(|_| DataModifyPermit(&self.inner.data_modifying, &self.inner.data_modify_notify))
    }

    #[inline]
    async fn acquire_data_modify_permit(&self) -> DataModifyPermit<'_> {
        for _ in 0..DATA_MODIFY_FAST_RETRY_YIELDS {
            if let Some(permit) = self.try_acquire_data_modify_permit() {
                return permit;
            }
            tokio::task::yield_now().await;
        }

        loop {
            let notified = self.inner.data_modify_notify.notified();
            if let Some(permit) = self.try_acquire_data_modify_permit() {
                return permit;
            }
            notified.await;
        }
    }
}
