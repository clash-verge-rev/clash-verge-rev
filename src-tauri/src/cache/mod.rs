use moka::future::Cache;

pub mod mihomo;

pub struct RefreshableCache<K, V> {
    inner: Cache<K, V>,
}

impl<K, V> RefreshableCache<K, V>
where
    K: Eq + std::hash::Hash + Clone + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
{
    pub fn new(inner: Cache<K, V>) -> Self {
        Self { inner }
    }

    pub fn inner(&self) -> &Cache<K, V> {
        &self.inner
    }
}
