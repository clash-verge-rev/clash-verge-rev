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

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use std::future::Future;
    use std::pin::Pin;
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

    #[derive(Clone, Debug, Default, PartialEq)]
    struct IVerge {
        enable_auto_launch: Option<bool>,
        enable_tun_mode: Option<bool>,
    }

    // Minimal single-threaded executor for immediately-ready futures
    fn block_on_ready<F: Future>(fut: F) -> F::Output {
        fn no_op_raw_waker() -> RawWaker {
            fn clone(_: *const ()) -> RawWaker {
                no_op_raw_waker()
            }
            fn wake(_: *const ()) {}
            fn wake_by_ref(_: *const ()) {}
            fn drop(_: *const ()) {}
            static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, wake, wake_by_ref, drop);
            RawWaker::new(std::ptr::null(), &VTABLE)
        }

        let waker = unsafe { Waker::from_raw(no_op_raw_waker()) };
        let mut cx = Context::from_waker(&waker);
        let mut fut = Box::pin(fut);
        loop {
            match Pin::as_mut(&mut fut).poll(&mut cx) {
                Poll::Ready(v) => return v,
                Poll::Pending => std::thread::yield_now(),
            }
        }
    }

    #[test]
    fn test_draft_basic_flow() {
        let verge = IVerge {
            enable_auto_launch: Some(true),
            enable_tun_mode: Some(false),
        };
        let draft = Draft::new(verge);

        // 读取正式数据（data_arc）
        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(true));
            assert_eq!(data.enable_tun_mode, Some(false));
        }

        // 修改草稿（使用 edit_draft）
        draft.edit_draft(|d| {
            d.enable_auto_launch = Some(false);
            d.enable_tun_mode = Some(true);
        });

        // 正式数据未变
        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(true));
            assert_eq!(data.enable_tun_mode, Some(false));
        }

        // 草稿已变
        {
            let latest = draft.latest_arc();
            assert_eq!(latest.enable_auto_launch, Some(false));
            assert_eq!(latest.enable_tun_mode, Some(true));
        }

        // 提交草稿
        draft.apply();

        // 正式数据已更新
        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(false));
            assert_eq!(data.enable_tun_mode, Some(true));
        }

        // 新一轮草稿并修改
        draft.edit_draft(|d| {
            d.enable_auto_launch = Some(true);
        });
        {
            let latest = draft.latest_arc();
            assert_eq!(latest.enable_auto_launch, Some(true));
            assert_eq!(latest.enable_tun_mode, Some(true));
        }

        // 丢弃草稿
        draft.discard();

        // 丢弃后再次创建草稿，会从已提交重新 clone
        {
            draft.edit_draft(|d| {
                // 原 committed 是 enable_auto_launch = Some(false)
                assert_eq!(d.enable_auto_launch, Some(false));
                // 再修改一下
                d.enable_tun_mode = Some(false);
            });
            // 草稿中值已修改，但正式数据仍是 apply 后的值
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(false));
            assert_eq!(data.enable_tun_mode, Some(true));
        }
    }

    #[test]
    fn test_arc_pointer_behavior_on_edit_and_apply() {
        let draft = Draft::new(IVerge {
            enable_auto_launch: Some(true),
            enable_tun_mode: Some(false),
        });

        // 初始 latest == committed
        let committed = draft.data_arc();
        let latest = draft.latest_arc();
        assert!(std::sync::Arc::ptr_eq(&committed, &latest));

        // 第一次 edit：由于与 committed 共享，Arc::make_mut 会克隆
        draft.edit_draft(|d| d.enable_tun_mode = Some(true));
        let committed_after_first_edit = draft.data_arc();
        let draft_after_first_edit = draft.latest_arc();
        assert!(!std::sync::Arc::ptr_eq(
            &committed_after_first_edit,
            &draft_after_first_edit
        ));
        // 提交会把 committed 指向草稿的 Arc
        let prev_draft_ptr = std::sync::Arc::as_ptr(&draft_after_first_edit);
        draft.apply();
        let committed_after_apply = draft.data_arc();
        assert_eq!(
            std::sync::Arc::as_ptr(&committed_after_apply),
            prev_draft_ptr
        );

        // 第二次编辑：此时草稿唯一持有（无其它引用），不应再克隆
        // 获取草稿 Arc 的指针并立即丢弃本地引用，避免增加 strong_count
        draft.edit_draft(|d| d.enable_auto_launch = Some(false));
        let latest1 = draft.latest_arc();
        let latest1_ptr = std::sync::Arc::as_ptr(&latest1);
        drop(latest1); // 确保只有 Draft 内部持有草稿 Arc

        // 再次编辑（unique，Arc::make_mut 不应克隆）
        draft.edit_draft(|d| d.enable_tun_mode = Some(false));
        let latest2 = draft.latest_arc();
        let latest2_ptr = std::sync::Arc::as_ptr(&latest2);

        assert_eq!(latest1_ptr, latest2_ptr, "Unique edit should not clone Arc");
        assert_eq!(latest2.enable_auto_launch, Some(false));
        assert_eq!(latest2.enable_tun_mode, Some(false));
    }

    #[test]
    fn test_discard_restores_latest_to_committed() {
        let draft = Draft::new(IVerge {
            enable_auto_launch: Some(false),
            enable_tun_mode: Some(false),
        });

        // 创建草稿并修改
        draft.edit_draft(|d| d.enable_auto_launch = Some(true));
        let committed = draft.data_arc();
        let latest = draft.latest_arc();
        assert!(!std::sync::Arc::ptr_eq(&committed, &latest));

        // 丢弃草稿后 latest 应回到 committed
        draft.discard();
        let committed2 = draft.data_arc();
        let latest2 = draft.latest_arc();
        assert!(std::sync::Arc::ptr_eq(&committed2, &latest2));
        assert_eq!(latest2.enable_auto_launch, Some(false));
    }

    #[test]
    fn test_edit_draft_returns_closure_result() {
        let draft = Draft::new(IVerge::default());
        let ret = draft.edit_draft(|d| {
            d.enable_tun_mode = Some(true);
            123usize
        });
        assert_eq!(ret, 123);
        let latest = draft.latest_arc();
        assert_eq!(latest.enable_tun_mode, Some(true));
    }

    #[test]
    fn test_with_data_modify_ok_and_replaces_committed() {
        let draft = Draft::new(IVerge {
            enable_auto_launch: Some(false),
            enable_tun_mode: Some(false),
        });

        // 使用 with_data_modify 异步（立即就绪）地更新 committed
        let res = block_on_ready(draft.with_data_modify(|mut v| async move {
            v.enable_auto_launch = Some(true);
            Ok((Box::new(*v), "done")) // Dereference v to get Box<T>
        }));
        assert_eq!(
            {
                #[allow(clippy::unwrap_used)]
                res.unwrap()
            },
            "done"
        );

        let committed = draft.data_arc();
        assert_eq!(committed.enable_auto_launch, Some(true));
        assert_eq!(committed.enable_tun_mode, Some(false));
    }

    #[test]
    fn test_with_data_modify_error_propagation() {
        let draft = Draft::new(IVerge::default());

        #[allow(clippy::unwrap_used)]
        let err = block_on_ready(draft.with_data_modify(|v| async move {
            drop(v);
            Err::<(Box<IVerge>, ()), _>(anyhow!("boom"))
        }))
        .unwrap_err();

        assert_eq!(format!("{err}"), "boom");
    }

    #[test]
    fn test_with_data_modify_does_not_touch_existing_draft() {
        let draft = Draft::new(IVerge {
            enable_auto_launch: Some(false),
            enable_tun_mode: Some(false),
        });

        // 创建草稿并修改
        draft.edit_draft(|d| {
            d.enable_auto_launch = Some(true);
            d.enable_tun_mode = Some(true);
        });
        let draft_before = draft.latest_arc();
        let draft_before_ptr = std::sync::Arc::as_ptr(&draft_before);

        // 同时通过 with_data_modify 修改 committed
        #[allow(clippy::unwrap_used)]
        block_on_ready(draft.with_data_modify(|mut v| async move {
            v.enable_auto_launch = Some(false); // 与草稿不同
            Ok((Box::new(*v), ())) // Dereference v to get Box<T>
        }))
        .unwrap();

        // 草稿应保持不变
        let draft_after = draft.latest_arc();
        assert_eq!(
            std::sync::Arc::as_ptr(&draft_after),
            draft_before_ptr,
            "Existing draft should not be replaced by with_data_modify"
        );
        assert_eq!(draft_after.enable_auto_launch, Some(true));
        assert_eq!(draft_after.enable_tun_mode, Some(true));

        // 丢弃草稿后 latest == committed，且 committed 为异步修改结果
        draft.discard();
        let latest = draft.latest_arc();
        assert_eq!(latest.enable_auto_launch, Some(false));
        assert_eq!(latest.enable_tun_mode, Some(false));
    }
}
