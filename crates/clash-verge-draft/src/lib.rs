use parking_lot::Mutex;
use std::sync::Arc;
use std::sync::atomic::{
    AtomicBool,
    Ordering::{Acquire, Relaxed, Release},
};
use tokio::sync::Notify;

pub type SharedDraft<T> = Arc<Box<T>>;
type DraftData<T> = (SharedDraft<T>, Option<SharedDraft<T>>);
// Retry one scheduler turn before parking on Notify for long async updates.
const DATA_MODIFY_FAST_RETRY_YIELDS: usize = 1;

#[derive(Debug)]
struct DraftInner<T> {
    data: Mutex<DraftData<T>>,
    data_modifying: AtomicBool,
    data_modify_notify: Notify,
    claimed: AtomicBool,
}

struct DataModifyPermit<'a>(&'a AtomicBool, &'a Notify);

impl Drop for DataModifyPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Release);
        self.1.notify_one();
    }
}

/// Copy-on-write committed data with an optional draft.
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
                claimed: AtomicBool::new(false),
            }),
        }
    }
    /// Returns the committed snapshot without cloning `T`.
    #[inline]
    pub fn data_arc(&self) -> SharedDraft<T> {
        let guard = self.inner.data.lock();
        Arc::clone(&guard.0)
    }

    /// Returns the draft when present, otherwise the committed snapshot.
    #[inline]
    pub fn latest_arc(&self) -> SharedDraft<T> {
        let guard = self.inner.data.lock();
        guard.1.clone().unwrap_or_else(|| Arc::clone(&guard.0))
    }

    /// Edits the draft, cloning `T` only when the snapshot is shared.
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

    /// Commits and clears the draft.
    #[inline]
    pub fn apply(&self) {
        let mut guard = self.inner.data.lock();
        if let Some(d) = guard.1.take() {
            guard.0 = d;
        }
    }

    /// Discards the draft.
    #[inline]
    pub fn discard(&self) {
        let mut guard = self.inner.data.lock();
        guard.1 = None;
    }

    /// Optimistically replaces committed data after an asynchronous edit.
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

/// A draft layer that can be claimed, committed or rolled back without knowing what it holds.
///
/// Exists so a change spanning several differently-typed layers can be treated as one unit.
pub trait DraftLayer: Send + Sync {
    /// Take exclusive staging rights, or report that someone else holds them.
    fn try_claim(&self) -> bool;
    fn release(&self);
    fn apply_draft(&self);
    fn discard_draft(&self);
    /// Names the layer in a [`DraftBusy`] error. Only ever read by humans.
    fn layer_name(&self) -> &'static str;
}

impl<T: Clone + Send + Sync> DraftLayer for Draft<T> {
    #[inline]
    fn try_claim(&self) -> bool {
        self.inner
            .claimed
            .compare_exchange(false, true, Acquire, Relaxed)
            .is_ok()
    }

    #[inline]
    fn release(&self) {
        self.inner.claimed.store(false, Release);
    }

    #[inline]
    fn apply_draft(&self) {
        self.apply();
    }

    #[inline]
    fn discard_draft(&self) {
        self.discard();
    }

    #[inline]
    fn layer_name(&self) -> &'static str {
        std::any::type_name::<T>()
    }
}

/// Another transaction is already staging a change to one of the layers asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftBusy {
    /// The layer that was already claimed.
    pub layer: &'static str,
}

impl std::fmt::Display for DraftBusy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "configuration layer {} is being changed elsewhere",
            self.layer
        )
    }
}

impl std::error::Error for DraftBusy {}

/// Exclusively claims several draft layers and rolls them all back unless committed.
///
/// A layer has one draft slot, so concurrent transactions cannot be isolated and are rejected.
#[must_use = "a transaction that is dropped without committing rolls back"]
pub struct DraftTransaction<'a> {
    layers: Vec<&'a dyn DraftLayer>,
    committed: bool,
}

impl<'a> DraftTransaction<'a> {
    /// Claims all layers or releases any partial claim.
    pub fn begin(layers: Vec<&'a dyn DraftLayer>) -> Result<Self, DraftBusy> {
        for (index, layer) in layers.iter().enumerate() {
            if layer.try_claim() {
                continue;
            }
            for claimed in &layers[..index] {
                claimed.release();
            }
            return Err(DraftBusy {
                layer: layer.layer_name(),
            });
        }
        Ok(Self {
            layers,
            committed: false,
        })
    }

    /// Commits every layer in the supplied order.
    pub fn commit(mut self) {
        for layer in &self.layers {
            layer.apply_draft();
        }
        self.committed = true;
    }

    /// Rolls back immediately when recovery must read the committed layers next.
    pub fn rollback(self) {
        drop(self);
    }
}

impl Drop for DraftTransaction<'_> {
    fn drop(&mut self) {
        for layer in &self.layers {
            if !self.committed {
                layer.discard_draft();
            }
            layer.release();
        }
    }
}
