use criterion::{Criterion, criterion_group, criterion_main};
use std::hint::black_box;
use tokio::runtime::Runtime;

// 引入业务模型 & Draft 实现
use app_lib::config::IVerge;
use app_lib::utils::Draft as DraftNew;

/// 创建测试数据
fn make_draft() -> DraftNew<Box<IVerge>> {
    let verge = Box::new(IVerge {
        enable_auto_launch: Some(true),
        enable_tun_mode: Some(false),
        ..Default::default()
    });
    DraftNew::from(verge)
}

/// 基准：只读 data_ref（正式数据）
fn bench_data_ref(c: &mut Criterion) {
    c.bench_function("draft_data_ref", |b| {
        b.iter(|| {
            let draft = make_draft();
            let data = draft.data();
            black_box(data.enable_auto_launch);
        });
    });
}

/// 基准：可写 data_mut（正式数据）
fn bench_data_mut(c: &mut Criterion) {
    c.bench_function("draft_data_mut", |b| {
        b.iter(|| {
            let draft = make_draft();
            let mut data = draft.data_mut();
            data.enable_tun_mode = Some(true);
            black_box(data.enable_tun_mode);
        });
    });
}

/// 基准：首次创建草稿（会触发 clone）
fn bench_draft_mut_first(c: &mut Criterion) {
    c.bench_function("draft_draft_mut_first", |b| {
        b.iter(|| {
            let draft = make_draft();
            let mut d = draft.draft();
            d.enable_auto_launch = Some(false);
            black_box(d.enable_auto_launch);
        });
    });
}

/// 基准：重复 draft_mut（已存在草稿，不再 clone）
fn bench_draft_mut_existing(c: &mut Criterion) {
    c.bench_function("draft_draft_mut_existing", |b| {
        b.iter(|| {
            let draft = make_draft();
            {
                let mut first = draft.draft();
                first.enable_tun_mode = Some(true);
            }
            let mut second = draft.draft();
            second.enable_tun_mode = Some(false);
            black_box(second.enable_tun_mode);
        });
    });
}

/// 基准：零拷贝读取最新视图（latest_ref）
fn bench_latest_ref(c: &mut Criterion) {
    c.bench_function("draft_latest_ref", |b| {
        b.iter(|| {
            let draft = make_draft();
            let latest = draft.latest();
            black_box(latest.enable_auto_launch);
        });
    });
}

/// 基准：apply（提交草稿）
fn bench_apply(c: &mut Criterion) {
    c.bench_function("draft_apply", |b| {
        b.iter(|| {
            let draft = make_draft();
            {
                let mut d = draft.draft();
                d.enable_auto_launch = Some(false);
            }
            let _ = draft.apply();
        });
    });
}

/// 基准：discard（丢弃草稿）
fn bench_discard(c: &mut Criterion) {
    c.bench_function("draft_discard", |b| {
        b.iter(|| {
            let draft = make_draft();
            {
                let mut d = draft.draft();
                d.enable_auto_launch = Some(false);
            }
            let _ = draft.discard();
        });
    });
}

/// 基准：异步 with_data_modify
fn bench_with_data_modify(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    c.bench_function("draft_with_data_modify", |b| {
        b.to_async(&rt).iter(|| async {
            let draft = make_draft();
            let _res: Result<(), anyhow::Error> = draft
                .with_data_modify(|mut box_data| async move {
                    box_data.enable_auto_launch =
                        Some(!box_data.enable_auto_launch.unwrap_or(false));
                    Ok((box_data, ()))
                })
                .await;
        });
    });
}

criterion_group!(
    benches,
    bench_data_ref,
    bench_data_mut,
    bench_draft_mut_first,
    bench_draft_mut_existing,
    bench_latest_ref,
    bench_apply,
    bench_discard,
    bench_with_data_modify
);
criterion_main!(benches);
