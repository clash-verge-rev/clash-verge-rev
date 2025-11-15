#[cfg(test)]
mod tests {
    use draft::*;

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

    #[test]
    fn test_create_draft_and_apply() {
        let draft = new_test_data();

        draft.with_draft_edit_sync(|data| {
            data.number = 100;
            data.string = "Changed".to_string();
            data.boolean = false;
            data.vector.push(6);
            data.vec_string.push("four".to_string());
            data.option = None;
        });

        {
            let draft_data = draft.get_draft();
            assert_eq!(draft_data.number, 100);
            assert_eq!(draft_data.string, "Changed");
            assert!(!draft_data.boolean);
            assert_eq!(draft_data.vector, vec![1, 2, 3, 4, 5, 6]);
            assert_eq!(draft_data.vec_string, vec!["one", "two", "three", "four"]);
            assert_eq!(draft_data.option, None);
        }

        draft.apply();

        let committed = draft.get_committed();
        assert_eq!(committed.number, 100);
        assert_eq!(committed.string, "Changed");
        assert!(!committed.boolean);
        assert_eq!(committed.vector, vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(committed.vec_string, vec!["one", "two", "three", "four"]);
        assert_eq!(committed.option, None);

        assert!(!draft.has_draft());
    }

    #[test]
    fn test_discard_draft() {
        let draft = new_test_data();

        draft.with_draft_edit_sync(|data| {
            data.number = 999;
        });

        draft.discard();

        assert!(!draft.has_draft());
        let committed = draft.get_committed();
        assert_eq!(committed.number, 42);
    }

    #[test]
    fn test_edit_multiple_times() {
        let draft = new_test_data();

        draft.with_draft_edit_sync(|data| {
            data.number = 1;
        });
        draft.with_draft_edit_sync(|data| {
            data.number = 2;
        });

        let draft_data = draft.get_draft();
        assert_eq!(draft_data.number, 2);
    }

    #[test]
    fn test_get_draft_creates_lazy_copy_and_committed_unaffected() {
        let draft = new_test_data();

        let committed_before = draft.get_committed();
        assert_eq!(committed_before.number, 42);

        let draft_before = draft.get_draft();
        assert_eq!(draft_before.number, 42);
        drop(draft_before);

        draft.with_draft_edit_sync(|data| {
            data.number = 123;
        });

        let draft_after = draft.get_draft();
        assert_eq!(draft_after.number, 123);

        let committed_after = draft.get_committed();
        assert_eq!(committed_after.number, 42);
    }
}
