#[cfg(test)]
mod tests {
    use anyhow::anyhow;
    use clash_verge_draft::Draft;
    use std::future::Future;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Notify;
    use tokio::time::sleep;

    #[derive(Clone, Debug, Default, PartialEq)]
    struct IVerge {
        enable_auto_launch: Option<bool>,
        enable_tun_mode: Option<bool>,
    }

    const STRESS_LEVELS: [usize; 6] = [8, 16, 32, 64, 128, 256];

    fn verge(enable_auto_launch: bool, enable_tun_mode: bool) -> IVerge {
        IVerge {
            enable_auto_launch: Some(enable_auto_launch),
            enable_tun_mode: Some(enable_tun_mode),
        }
    }

    fn block_on_ready<F: Future>(fut: F) -> F::Output {
        tokio::runtime::Runtime::new().unwrap().block_on(fut)
    }

    #[test]
    fn test_draft_basic_flow() {
        let draft = Draft::new(verge(true, false));

        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(true));
            assert_eq!(data.enable_tun_mode, Some(false));
        }

        draft.edit_draft(|d| {
            d.enable_auto_launch = Some(false);
            d.enable_tun_mode = Some(true);
        });

        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(true));
            assert_eq!(data.enable_tun_mode, Some(false));
        }

        {
            let latest = draft.latest_arc();
            assert_eq!(latest.enable_auto_launch, Some(false));
            assert_eq!(latest.enable_tun_mode, Some(true));
        }

        draft.apply();

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

        draft.discard();

        {
            draft.edit_draft(|d| {
                assert_eq!(d.enable_auto_launch, Some(false));
                d.enable_tun_mode = Some(false);
            });
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(false));
            assert_eq!(data.enable_tun_mode, Some(true));
        }
    }

    #[test]
    fn test_arc_pointer_behavior_on_edit_and_apply() {
        let draft = Draft::new(verge(true, false));

        let committed = draft.data_arc();
        let latest = draft.latest_arc();
        assert!(Arc::ptr_eq(&committed, &latest));

        draft.edit_draft(|d| d.enable_tun_mode = Some(true));
        let committed_after_first_edit = draft.data_arc();
        let draft_after_first_edit = draft.latest_arc();
        assert!(!Arc::ptr_eq(&committed_after_first_edit, &draft_after_first_edit));
        let prev_draft_ptr = Arc::as_ptr(&draft_after_first_edit);
        draft.apply();
        let committed_after_apply = draft.data_arc();
        assert_eq!(Arc::as_ptr(&committed_after_apply), prev_draft_ptr);

        draft.edit_draft(|d| d.enable_auto_launch = Some(false));
        let latest1 = draft.latest_arc();
        let latest1_ptr = Arc::as_ptr(&latest1);
        drop(latest1);

        draft.edit_draft(|d| d.enable_tun_mode = Some(false));
        let latest2 = draft.latest_arc();
        let latest2_ptr = Arc::as_ptr(&latest2);

        assert_eq!(latest1_ptr, latest2_ptr, "Unique edit should not clone Arc");
        assert_eq!(latest2.enable_auto_launch, Some(false));
        assert_eq!(latest2.enable_tun_mode, Some(false));
    }

    #[test]
    fn test_discard_restores_latest_to_committed() {
        let draft = Draft::new(verge(false, false));

        draft.edit_draft(|d| d.enable_auto_launch = Some(true));
        let committed = draft.data_arc();
        let latest = draft.latest_arc();
        assert!(!Arc::ptr_eq(&committed, &latest));

        draft.discard();
        let committed2 = draft.data_arc();
        let latest2 = draft.latest_arc();
        assert!(Arc::ptr_eq(&committed2, &latest2));
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
        let draft = Draft::new(verge(false, false));

        let res = block_on_ready(draft.with_data_modify(|mut v| async move {
            v.enable_auto_launch = Some(true);
            Ok((v, "done"))
        }));
        assert_eq!(res.unwrap(), "done");

        let committed = draft.data_arc();
        assert_eq!(committed.enable_auto_launch, Some(true));
        assert_eq!(committed.enable_tun_mode, Some(false));
    }

    #[test]
    fn test_with_data_modify_keeps_boxed_data_shape() {
        let draft = Draft::new(Box::new(verge(false, false)));

        block_on_ready(draft.with_data_modify(|mut v| async move {
            v.enable_auto_launch = Some(true);
            Ok((v, ()))
        }))
        .unwrap();

        assert_eq!(draft.data_arc().enable_auto_launch, Some(true));
    }

    #[test]
    fn test_with_data_modify_error_releases_permit() {
        let draft = Draft::new(IVerge::default());

        #[allow(clippy::unwrap_used)]
        let err = block_on_ready(draft.with_data_modify(|_v| async move { Err::<(IVerge, ()), _>(anyhow!("boom")) }))
            .unwrap_err();

        assert_eq!(format!("{err}"), "boom");

        #[allow(clippy::unwrap_used)]
        block_on_ready(draft.with_data_modify(|mut v| async move {
            v.enable_auto_launch = Some(true);
            Ok((v, ()))
        }))
        .unwrap();

        assert_eq!(draft.data_arc().enable_auto_launch, Some(true));
    }

    #[test]
    fn test_with_data_modify_serialized_under_stress_levels() {
        for task_count in STRESS_LEVELS {
            run_with_data_modify_stress(task_count, Duration::from_millis(1));
        }
    }

    #[test]
    fn test_with_data_modify_keeps_apply_conflict_detection() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let draft = Arc::new(Draft::new(verge(false, false)));
        let started = Arc::new(Notify::new());
        let finish = Arc::new(Notify::new());

        rt.block_on(async {
            let task = {
                let draft = Arc::clone(&draft);
                let started = Arc::clone(&started);
                let finish = Arc::clone(&finish);
                tokio::spawn(async move {
                    draft
                        .with_data_modify(|mut v| async move {
                            started.notify_one();
                            finish.notified().await;
                            v.enable_auto_launch = Some(true);
                            Ok((v, ()))
                        })
                        .await
                })
            };

            started.notified().await;
            draft.edit_draft(|d| d.enable_tun_mode = Some(true));
            draft.apply();
            finish.notify_one();

            let err = task.await.expect("task panicked").unwrap_err();
            assert_eq!(
                format!("{err}"),
                "Optimistic lock failed: Committed data has changed during async operation"
            );
        });

        let committed = draft.data_arc();
        assert_eq!(committed.enable_auto_launch, Some(false));
        assert_eq!(committed.enable_tun_mode, Some(true));
    }

    fn run_with_data_modify_stress(task_count: usize, delay: Duration) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let draft = Arc::new(Draft::new(verge(false, false)));

        rt.block_on(async {
            let mut handles = Vec::with_capacity(task_count);
            for _ in 0..task_count {
                let draft = Arc::clone(&draft);
                handles.push(tokio::spawn(async move {
                    draft
                        .with_data_modify(|mut v| async move {
                            if !delay.is_zero() {
                                sleep(delay).await;
                            }
                            v.enable_auto_launch = Some(!v.enable_auto_launch.unwrap_or(false));
                            Ok((v, ()))
                        })
                        .await
                }));
            }

            for handle in handles {
                handle.await.expect("task panicked").expect("with_data_modify failed");
            }

            Ok::<(), anyhow::Error>(())
        })
        .unwrap();
    }

    #[test]
    fn test_with_data_modify_does_not_touch_existing_draft() {
        let draft = Draft::new(verge(false, false));

        draft.edit_draft(|d| {
            d.enable_auto_launch = Some(true);
            d.enable_tun_mode = Some(true);
        });
        let draft_before = draft.latest_arc();
        let draft_before_ptr = Arc::as_ptr(&draft_before);

        #[allow(clippy::unwrap_used)]
        block_on_ready(draft.with_data_modify(|mut v| async move {
            v.enable_auto_launch = Some(false);
            Ok((v, ()))
        }))
        .unwrap();

        let draft_after = draft.latest_arc();
        assert_eq!(
            Arc::as_ptr(&draft_after),
            draft_before_ptr,
            "Existing draft should not be replaced by with_data_modify"
        );
        assert_eq!(draft_after.enable_auto_launch, Some(true));
        assert_eq!(draft_after.enable_tun_mode, Some(true));

        draft.discard();
        let latest = draft.latest_arc();
        assert_eq!(latest.enable_auto_launch, Some(false));
        assert_eq!(latest.enable_tun_mode, Some(false));
    }
}
