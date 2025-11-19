use criterion::{Criterion, criterion_group, criterion_main};
use std::hint::black_box;
use std::process;
use tokio::runtime::Runtime;

use clash_verge_draft::Draft;

#[derive(Default, Clone, Debug)]
struct IVerge {
    enable_auto_launch: Option<bool>,
    enable_tun_mode: Option<bool>,
}

fn make_draft() -> Draft<IVerge> {
    let verge = IVerge {
        enable_auto_launch: Some(true),
        enable_tun_mode: Some(false),
    };
    Draft::new(verge)
}

pub fn bench_draft(c: &mut Criterion) {
    let rt = Runtime::new().unwrap_or_else(|e| {
        eprintln!("Tokio runtime init failed: {e}");
        process::exit(1);
    });

    let mut group = c.benchmark_group("draft");
    group.sample_size(100);
    group.warm_up_time(std::time::Duration::from_millis(300));
    group.measurement_time(std::time::Duration::from_secs(1));

    group.bench_function("data_mut", |b| {
        b.iter(|| {
            let draft = black_box(make_draft());
            draft.edit_draft(|d| d.enable_tun_mode = Some(true));
            black_box(&draft.latest_arc().enable_tun_mode);
        });
    });

    group.bench_function("draft_mut_first", |b| {
        b.iter(|| {
            let draft = black_box(make_draft());
            draft.edit_draft(|d| d.enable_auto_launch = Some(false));
            let latest = draft.latest_arc();
            black_box(&latest.enable_auto_launch);
        });
    });

    group.bench_function("draft_mut_existing", |b| {
        b.iter(|| {
            let draft = black_box(make_draft());
            {
                draft.edit_draft(|d| {
                    d.enable_tun_mode = Some(true);
                });
                let latest1 = draft.latest_arc();
                black_box(&latest1.enable_tun_mode);
            }
            draft.edit_draft(|d| {
                d.enable_tun_mode = Some(false);
            });
            let latest2 = draft.latest_arc();
            black_box(&latest2.enable_tun_mode);
        });
    });

    group.bench_function("latest_arc", |b| {
        b.iter(|| {
            let draft = black_box(make_draft());
            let latest = draft.latest_arc();
            black_box(&latest.enable_auto_launch);
        });
    });

    group.bench_function("apply", |b| {
        b.iter(|| {
            let draft = black_box(make_draft());
            {
                draft.edit_draft(|d| {
                    d.enable_auto_launch = Some(false);
                });
            }
            draft.apply();
            black_box(&draft);
        });
    });

    group.bench_function("discard", |b| {
        b.iter(|| {
            let draft = black_box(make_draft());
            {
                draft.edit_draft(|d| {
                    d.enable_auto_launch = Some(false);
                });
            }
            draft.discard();
            black_box(&draft);
        });
    });

    group.bench_function("with_data_modify_async", |b| {
        b.to_async(&rt).iter(|| async {
            let draft = black_box(make_draft());
            let _: Result<(), anyhow::Error> = draft
                .with_data_modify::<_, _, _>(|mut box_data| async move {
                    box_data.enable_auto_launch =
                        Some(!box_data.enable_auto_launch.unwrap_or(false));
                    Ok((box_data, ()))
                })
                .await;
        });
    });

    group.finish();
}

criterion_group!(benches, bench_draft);
criterion_main!(benches);
