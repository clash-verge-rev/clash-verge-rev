use std::sync::Arc;

use parking_lot::{
    MappedRwLockReadGuard, MappedRwLockWriteGuard, RwLock, RwLockReadGuard,
    RwLockUpgradableReadGuard, RwLockWriteGuard,
};

#[derive(Debug, Clone)]
pub struct Draft<T: Clone + ToOwned> {
    inner: Arc<RwLock<(T, Option<T>)>>,
}

impl<T: Clone + ToOwned> From<T> for Draft<T> {
    fn from(data: T) -> Self {
        Self {
            inner: Arc::new(RwLock::new((data, None))),
        }
    }
}

/// Implements draft management for `Box<T>`, allowing for safe concurrent editing and committing of draft data.
/// # Type Parameters
/// - `T`: The underlying data type, which must implement `Clone` and `ToOwned`.
///
/// # Methods
/// - `data_mut`: Returns a mutable reference to the committed data.
/// - `draft_mut`: Creates or retrieves a mutable reference to the draft data, cloning the committed data if no draft exists.
/// - `latest_ref`: Returns an immutable reference to the draft data if it exists, otherwise to the committed data.
/// - `apply`: Commits the draft data, replacing the committed data and returning the old committed value if a draft existed.
/// - `discard`: Discards the draft data and returns it if it existed.
impl<T: Clone + ToOwned> Draft<Box<T>> {
    /// 正式数据视图
    pub fn data_ref(&self) -> MappedRwLockReadGuard<'_, Box<T>> {
        RwLockReadGuard::map(self.inner.read(), |inner| &inner.0)
    }

    /// 可写正式数据
    pub fn data_mut(&self) -> MappedRwLockWriteGuard<'_, Box<T>> {
        RwLockWriteGuard::map(self.inner.write(), |inner| &mut inner.0)
    }

    /// 创建或获取草稿并返回可写引用
    pub fn draft_mut(&self) -> MappedRwLockWriteGuard<'_, Box<T>> {
        let guard = self.inner.upgradable_read();
        if guard.1.is_none() {
            let mut guard = RwLockUpgradableReadGuard::upgrade(guard);
            guard.1 = Some(guard.0.clone());
            return RwLockWriteGuard::map(guard, |inner| {
                inner.1.as_mut().unwrap_or_else(|| {
                    unreachable!("Draft was just created above, this should never fail")
                })
            });
        }
        // 已存在草稿，升级为写锁映射
        RwLockWriteGuard::map(RwLockUpgradableReadGuard::upgrade(guard), |inner| {
            inner
                .1
                .as_mut()
                .unwrap_or_else(|| unreachable!("Draft should exist when guard.1.is_some()"))
        })
    }

    /// 零拷贝只读视图：返回草稿(若存在)或正式值
    pub fn latest_ref(&self) -> MappedRwLockReadGuard<'_, Box<T>> {
        RwLockReadGuard::map(self.inner.read(), |inner| {
            inner.1.as_ref().unwrap_or(&inner.0)
        })
    }

    /// 提交草稿，返回旧正式数据
    pub fn apply(&self) {
        let guard = self.inner.upgradable_read();
        if guard.1.is_none() {
            return;
        }

        let mut guard = RwLockUpgradableReadGuard::upgrade(guard);
        if let Some(draft) = guard.1.take() {
            guard.0 = draft;
        }
    }

    /// 丢弃草稿，返回被丢弃的草稿
    pub fn discard(&self) {
        self.inner.write().1.take();
    }

    /// 异步修改正式数据，闭包直接获得 Box<T> 所有权
    pub async fn with_data_modify<F, Fut, R, E>(&self, f: F) -> Result<R, E>
    where
        T: Send + Sync + 'static,
        F: FnOnce(Box<T>) -> Fut + Send,
        Fut: std::future::Future<Output = Result<(Box<T>, R), E>> + Send,
        E: From<anyhow::Error>,
    {
        // 克隆正式数据
        let local = {
            let guard = self.inner.read();
            guard.0.clone()
        };

        // 异步闭包执行，返回修改后的 Box<T> 和业务结果 R
        let (new_local, res) = f(local).await?;

        // 写回正式数据
        let mut guard = self.inner.write();
        guard.0 = new_local;

        Ok(res)
    }
}

#[test]
fn test_draft_box() {
    use crate::config::IVerge;

    // 1. 创建 Draft<Box<IVerge>>
    let verge = Box::new(IVerge {
        enable_auto_launch: Some(true),
        enable_tun_mode: Some(false),
        ..IVerge::default()
    });
    let draft = Draft::from(verge);

    // 2. 读取正式数据（data_mut）
    {
        let data = draft.data_mut();
        assert_eq!(data.enable_auto_launch, Some(true));
        assert_eq!(data.enable_tun_mode, Some(false));
    }

    // 3. 初次获取草稿（draft_mut 会自动 clone 一份）
    {
        let draft_view = draft.draft_mut();
        assert_eq!(draft_view.enable_auto_launch, Some(true));
        assert_eq!(draft_view.enable_tun_mode, Some(false));
    }

    // 4. 修改草稿
    {
        let mut d = draft.draft_mut();
        d.enable_auto_launch = Some(false);
        d.enable_tun_mode = Some(true);
    }

    // 正式数据未变
    assert_eq!(draft.data_mut().enable_auto_launch, Some(true));
    assert_eq!(draft.data_mut().enable_tun_mode, Some(false));

    // 草稿已变
    {
        let latest = draft.latest_ref();
        assert_eq!(latest.enable_auto_launch, Some(false));
        assert_eq!(latest.enable_tun_mode, Some(true));
    }

    // 5. 提交草稿
    draft.apply();

    // 正式数据已更新
    {
        let data = draft.data_mut();
        assert_eq!(data.enable_auto_launch, Some(false));
        assert_eq!(data.enable_tun_mode, Some(true));
    }

    // 6. 新建并修改下一轮草稿
    {
        let mut d = draft.draft_mut();
        d.enable_auto_launch = Some(true);
    }
    assert_eq!(draft.draft_mut().enable_auto_launch, Some(true));

    // 7. 丢弃草稿
    draft.discard();

    // 8. 草稿已被丢弃，新的 draft_mut() 会重新 clone
    assert_eq!(draft.draft_mut().enable_auto_launch, Some(false));
}
