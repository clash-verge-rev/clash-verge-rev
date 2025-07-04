use parking_lot::{
    MappedRwLockReadGuard, MappedRwLockWriteGuard, RwLock, RwLockReadGuard,
    RwLockUpgradableReadGuard, RwLockWriteGuard,
};
use std::sync::Arc;

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

impl<T: Clone + ToOwned> Draft<Box<T>> {
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
            return RwLockWriteGuard::map(guard, |inner| inner.1.as_mut().unwrap());
        }
        // 已存在草稿，升级为写锁映射
        RwLockWriteGuard::map(RwLockUpgradableReadGuard::upgrade(guard), |inner| {
            inner.1.as_mut().unwrap()
        })
    }

    /// 零拷贝只读视图：返回草稿(若存在)或正式值
    pub fn latest_ref(&self) -> MappedRwLockReadGuard<'_, Box<T>> {
        RwLockReadGuard::map(self.inner.read(), |inner| {
            inner.1.as_ref().unwrap_or(&inner.0)
        })
    }

    /// 克隆出的最新视图（兼容旧接口）
    pub fn latest_cloned(&self) -> Box<T> {
        self.latest_ref().clone()
    }

    /// 提交草稿，返回旧正式数据
    pub fn apply(&self) -> Option<Box<T>> {
        let mut inner = self.inner.write();
        inner
            .1
            .take()
            .map(|draft| std::mem::replace(&mut inner.0, draft))
    }

    /// 丢弃草稿，返回被丢弃的草稿
    pub fn discard(&self) -> Option<Box<T>> {
        self.inner.write().1.take()
    }
}
