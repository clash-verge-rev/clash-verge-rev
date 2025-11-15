use parking_lot::{
    RwLock, RwLockReadGuard, RwLockUpgradableReadGuard,
    lock_api::{MappedRwLockReadGuard, RwLockWriteGuard},
};

pub struct Draft<T> {
    committed: RwLock<Box<T>>,
    draft: RwLock<Option<Box<T>>>,
}

impl<T: Clone> Draft<T> {
    #[inline]
    pub fn new(initial: T) -> Self {
        Self {
            committed: RwLock::new(Box::new(initial)),
            draft: RwLock::new(None),
        }
    }

    #[inline]
    pub fn apply(&self) {
        let maybe_draft = {
            let mut draft_w = self.draft.write();
            draft_w.take()
        };

        if let Some(draft) = maybe_draft {
            let mut committed_w = self.committed.write();
            *committed_w = draft;
        }
    }

    #[inline]
    pub fn discard(&self) {
        let _ = self.draft.write().take();
    }

    #[inline]
    pub fn get_committed(&self) -> MappedRwLockReadGuard<'_, parking_lot::RawRwLock, Box<T>> {
        RwLockReadGuard::map(self.committed.read(), |b| b)
    }

    #[inline]
    pub fn get_draft(&self) -> MappedRwLockReadGuard<'_, parking_lot::RawRwLock, Box<T>> {
        let draft_guard = self.draft.upgradable_read();
        if draft_guard.is_some() {
            let draft_guard = RwLockUpgradableReadGuard::downgrade(draft_guard);
            return RwLockReadGuard::map(draft_guard, |opt| opt.as_ref().unwrap());
        }
        let mut write = RwLockUpgradableReadGuard::upgrade(draft_guard);
        let committed_guard = self.committed.read();
        *write = Some(Box::new((**committed_guard).clone()));
        drop(committed_guard);
        let draft_guard = RwLockWriteGuard::downgrade(write);
        RwLockReadGuard::map(draft_guard, |opt| opt.as_ref().unwrap())
    }

    #[inline]
    pub fn with_draft_edit_sync<F>(&self, f: F)
    where
        F: FnOnce(&mut T),
    {
        drop(self.get_draft());
        let mut write_guard = self.draft.write();
        let draft_write = write_guard.as_mut().unwrap().as_mut();
        f(&mut *draft_write);
    }

    #[inline]
    pub async fn with_committed_edit_async<F, Fut, R>(&self, f: F) -> Result<R, anyhow::Error>
    where
        F: FnOnce(&T) -> Fut,
        Fut: std::future::Future<Output = Result<R, anyhow::Error>>,
    {
        let guard = self.get_committed();
        let write_guard = guard.as_ref();
        f(write_guard).await
    }
}

impl<T: Clone> Draft<T> {
    #[cfg(debug_assertions)]
    #[inline]
    pub fn has_draft(&self) -> bool {
        self.draft.read().is_some()
    }
}
