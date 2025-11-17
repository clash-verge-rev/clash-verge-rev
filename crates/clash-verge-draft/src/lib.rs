use parking_lot::RwLock;
use std::sync::Arc;

pub type SharedBox<T> = Arc<Box<T>>;
type DraftInner<T> = (SharedBox<T>, Option<SharedBox<T>>);

/// Draft 管理：committed 与 optional draft 都以 Arc<Box<T>> 存储，
// (committed_snapshot, optional_draft_snapshot)
#[derive(Debug, Clone)]
pub struct Draft<T: Clone> {
    inner: Arc<RwLock<DraftInner<T>>>,
}

impl<T: Clone> Draft<T> {
    #[inline]
    pub fn new(data: T) -> Self {
        Self {
            inner: Arc::new(RwLock::new((Arc::new(Box::new(data)), None))),
        }
    }
    /// 以 Arc<Box<T>> 的形式获取当前“已提交（正式）”数据的快照（零拷贝，仅 clone Arc）
    #[inline]
    pub fn data_arc(&self) -> SharedBox<T> {
        let guard = self.inner.read();
        Arc::clone(&guard.0)
    }

    /// 获取当前（草稿若存在则返回草稿，否则返回已提交）的快照
    /// 这也是零拷贝：只 clone Arc，不 clone T
    #[inline]
    pub fn latest_arc(&self) -> SharedBox<T> {
        let guard = self.inner.read();
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
        // 先获得写锁以创建或取出草稿 Arc 的可变引用位置
        let mut guard = self.inner.write();
        let mut draft_arc = if guard.1.is_none() {
            Arc::clone(&guard.0)
        } else {
            #[allow(clippy::unwrap_used)]
            guard.1.take().unwrap()
        };
        drop(guard);
        // Arc::make_mut: 如果只有一个引用则返回可变引用；否则会克隆底层 Box<T>（要求 T: Clone）
        let boxed = Arc::make_mut(&mut draft_arc); // &mut Box<T>
        // 对 Box<T> 解引用得到 &mut T
        let result = f(&mut **boxed);
        // 恢复修改后的草稿 Arc
        self.inner.write().1 = Some(draft_arc);
        result
    }

    /// 将草稿提交到已提交位置（替换），并清除草稿
    #[inline]
    pub fn apply(&self) {
        let mut guard = self.inner.write();
        if let Some(d) = guard.1.take() {
            guard.0 = d;
        }
    }

    /// 丢弃草稿（如果存在）
    #[inline]
    pub fn discard(&self) {
        let mut guard = self.inner.write();
        guard.1 = None;
    }

    /// 异步地以拥有 Box<T> 的方式修改已提交数据：将克隆一次已提交数据到本地，
    /// 异步闭包返回新的 Box<T>（替换已提交数据）和业务返回值 R。
    #[inline]
    pub async fn with_data_modify<F, Fut, R>(&self, f: F) -> Result<R, anyhow::Error>
    where
        T: Send + Sync + 'static,
        F: FnOnce(Box<T>) -> Fut + Send,
        Fut: std::future::Future<Output = Result<(Box<T>, R), anyhow::Error>> + Send,
    {
        // 读取已提交快照（cheap Arc clone, 然后得到 Box<T> 所有权 via clone）
        // 注意：为了让闭包接收 Box<T> 所有权，我们需要 clone 底层 T（不可避免）
        let local: Box<T> = {
            let guard = self.inner.read();
            // 将 Arc<Box<T>> 的 Box<T> clone 出来（会调用 T: Clone）
            (*guard.0).clone()
        };

        let (new_local, res) = f(local).await?;

        // 将新的 Box<T> 放到已提交位置（包进 Arc）
        self.inner.write().0 = Arc::new(new_local);

        Ok(res)
    }
}
