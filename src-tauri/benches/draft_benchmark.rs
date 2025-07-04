use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

// 业务模型 & Draft
use app_lib::config::Draft as DraftNew;
use app_lib::config::IVerge;

// fn bench_apply_old(c: &mut Criterion) {
//     c.bench_function("apply_draft_old", |b| {
//         b.iter(|| {
//             let verge = Box::new(IVerge {
//                 enable_auto_launch: Some(true),
//                 enable_tun_mode: Some(false),
//                 ..Default::default()
//             });

//             let draft = DraftOld::from(black_box(verge));

//             {
//                 let mut d = draft.draft_mut();
//                 d.enable_auto_launch = Some(false);
//             }

//             let _ = draft.apply();
//         });
//     });
// }

// fn bench_discard_old(c: &mut Criterion) {
//     c.bench_function("discard_draft_old", |b| {
//         b.iter(|| {
//             let verge = Box::new(IVerge::default());
//             let draft = DraftOld::from(black_box(verge));

//             {
//                 let mut d = draft.draft_mut();
//                 d.enable_auto_launch = Some(false);
//             }

//             let _ = draft.discard();
//         });
//     });
// }

/// 基准：修改草稿并 apply()
fn bench_apply_new(c: &mut Criterion) {
    c.bench_function("apply_draft_new", |b| {
        b.iter(|| {
            let verge = Box::new(IVerge {
                enable_auto_launch: Some(true),
                enable_tun_mode: Some(false),
                ..Default::default()
            });

            let draft = DraftNew::from(black_box(verge));

            {
                let mut d = draft.draft_mut();
                d.enable_auto_launch = Some(false);
            }

            let _ = draft.apply();
        });
    });
}

/// 基准：修改草稿并 discard()
fn bench_discard_new(c: &mut Criterion) {
    c.bench_function("discard_draft_new", |b| {
        b.iter(|| {
            let verge = Box::new(IVerge::default());
            let draft = DraftNew::from(black_box(verge));

            {
                let mut d = draft.draft_mut();
                d.enable_auto_launch = Some(false);
            }

            let _ = draft.discard();
        });
    });
}

criterion_group!(
    benches,
    // bench_apply_old,
    // bench_discard_old,
    bench_apply_new,
    bench_discard_new
);
criterion_main!(benches);
