use std::sync::Arc;

use parking_lot::{MappedRwLockReadGuard, MappedRwLockWriteGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

use super::{IClashConfig, IProfiles, IRuntime, IVerge};

#[derive(Debug, Clone)]
pub struct Draft<T: Clone + ToOwned> {
    inner: Arc<RwLock<(T, Option<T>)>>,
}

macro_rules! draft_define {
    ($id: ident) => {
        impl Draft<$id> {
            #[allow(unused)]
            pub fn data(&self) -> MappedRwLockReadGuard<'_, $id> {
                RwLockReadGuard::map(self.inner.read(), |guard| &guard.0)
            }

            #[allow(unused)]
            pub fn data_mut(&self) -> MappedRwLockWriteGuard<'_, $id> {
                RwLockWriteGuard::map(self.inner.write(), |guard| &mut guard.0)
            }

            pub fn latest(&self) -> MappedRwLockReadGuard<'_, $id> {
                RwLockReadGuard::map(self.inner.read(), |inner| {
                    if inner.1.is_none() {
                        &inner.0
                    } else {
                        inner.1.as_ref().unwrap()
                    }
                })
            }

            pub fn latest_mut(&self) -> MappedRwLockWriteGuard<'_, $id> {
                RwLockWriteGuard::map(self.inner.write(), |inner| {
                    if inner.1.is_none() {
                        &mut inner.0
                    } else {
                        inner.1.as_mut().unwrap()
                    }
                })
            }

            pub fn draft(&self) -> MappedRwLockWriteGuard<'_, $id> {
                RwLockWriteGuard::map(self.inner.write(), |inner| {
                    if inner.1.is_none() {
                        inner.1 = Some(inner.0.clone());
                    }

                    inner.1.as_mut().unwrap()
                })
            }

            pub fn apply(&self) -> Option<$id> {
                let mut inner = self.inner.write();

                match inner.1.take() {
                    Some(draft) => {
                        let old_value = inner.0.to_owned();
                        inner.0 = draft.to_owned();
                        Some(old_value)
                    }
                    None => None,
                }
            }

            pub fn discard(&self) -> Option<$id> {
                let mut inner = self.inner.write();
                inner.1.take()
            }

            pub fn clear_and_replace(&self, data: $id) {
                let mut inner = self.inner.write();
                inner.1.take();
                inner.0 = data;
            }
        }

        impl From<$id> for Draft<$id> {
            fn from(data: $id) -> Self {
                Draft {
                    inner: Arc::new(RwLock::new((data, None))),
                }
            }
        }
    };
}

// draft_define!(IClash);
draft_define!(IClashConfig);
draft_define!(IProfiles);
draft_define!(IRuntime);
draft_define!(IVerge);

#[test]
fn test_draft() {
    let verge = IVerge {
        enable_auto_launch: Some(true),
        ..IVerge::default()
    };
    let draft = Draft::from(verge);

    assert_eq!(draft.data().enable_auto_launch, Some(true));
    assert_eq!(draft.draft().enable_auto_launch, Some(true));

    let mut d = draft.draft();
    d.enable_auto_launch = Some(false);
    drop(d);

    assert_eq!(draft.data().enable_auto_launch, Some(true));
    assert_eq!(draft.draft().enable_auto_launch, Some(false));
    assert_eq!(draft.latest().enable_auto_launch, Some(false));

    assert!(draft.apply().is_some());
    assert!(draft.apply().is_none());

    assert_eq!(draft.data().enable_auto_launch, Some(false));
    assert_eq!(draft.draft().enable_auto_launch, Some(false));

    let mut d = draft.draft();
    d.enable_auto_launch = Some(true);
    drop(d);

    assert_eq!(draft.data().enable_auto_launch, Some(false));
    assert_eq!(draft.draft().enable_auto_launch, Some(true));
    assert!(draft.discard().is_some());

    assert_eq!(draft.data().enable_auto_launch, Some(false));
    assert!(draft.discard().is_none());
    assert_eq!(draft.draft().enable_auto_launch, Some(false));
}
