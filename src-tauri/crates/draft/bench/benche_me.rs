use criterion::{Criterion, criterion_group, criterion_main};
use draft::*;
use std::hint::black_box;

#[derive(Clone)]
struct TestData {
    number: i32,
    string: String,
    boolean: bool,
    vector: Vec<i32>,
    vec_string: Vec<String>,
    option: Option<String>,
}

fn new_test_data() -> Draft<TestData> {
    Draft::new(TestData {
        number: 42,
        string: "Hello, World!".to_string(),
        boolean: true,
        vector: vec![1, 2, 3, 4, 5],
        vec_string: vec!["one".to_string(), "two".to_string(), "three".to_string()],
        option: Some("Some value".to_string()),
    })
}

fn bench_create_and_apply(c: &mut Criterion) {
    c.bench_function("create_and_apply", |b| {
        b.iter(|| {
            let draft = new_test_data();
            draft.with_draft_edit_sync(|data| {
                data.number = black_box(100);
                data.string = "Changed".to_string();
                data.boolean = false;
                data.vector.push(6);
                data.vec_string.push("four".to_string());
                data.option = None;
            });
            draft.apply();
            black_box(());
        });
    });
}

fn bench_edit_sync(c: &mut Criterion) {
    c.bench_function("with_draft_edit_sync", |b| {
        b.iter(|| {
            let draft = new_test_data();
            draft.with_draft_edit_sync(|data| {
                data.number = black_box(data.number + 1);
            });
            black_box(draft);
        });
    });
}

fn bench_discard(c: &mut Criterion) {
    c.bench_function("discard", |b| {
        b.iter(|| {
            let draft = new_test_data();
            draft.with_draft_edit_sync(|data| {
                data.number = black_box(999);
            });
            draft.discard();
            black_box(());
        });
    });
}

fn bench_multiple_edits(c: &mut Criterion) {
    c.bench_function("multiple_edits", |b| {
        b.iter(|| {
            let draft = new_test_data();
            for i in 0..10 {
                draft.with_draft_edit_sync(|data| {
                    data.number = black_box(i);
                });
            }
            black_box(draft.get_draft().number);
        });
    });
}

fn bench_get_draft(c: &mut Criterion) {
    c.bench_function("get_draft", |b| {
        b.iter(|| {
            let draft = new_test_data();
            // call get_draft to measure lazy creation and read path
            let _ = black_box(draft.get_draft());
        });
    });
}

fn bench_get_committed(c: &mut Criterion) {
    c.bench_function("get_committed", |b| {
        b.iter(|| {
            let draft = new_test_data();
            // measure read-only access to committed
            let _ = black_box(draft.get_committed());
        });
    });
}

criterion_group!(
    benches,
    bench_create_and_apply,
    bench_edit_sync,
    bench_discard,
    bench_multiple_edits,
    bench_get_draft,
    bench_get_committed
);
criterion_main!(benches);
