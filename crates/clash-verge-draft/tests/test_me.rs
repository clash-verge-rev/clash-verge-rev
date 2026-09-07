use std::sync::Arc;

use clash_verge_draft::{Draft, DraftTransaction};
use tokio::sync::Notify;

#[derive(Clone, Debug, Default, PartialEq)]
struct Config {
    enabled: bool,
    port: u16,
}

#[test]
fn edits_can_be_committed_or_discarded() {
    let draft = Draft::new(Config {
        enabled: false,
        port: 7897,
    });

    draft.edit_draft(|config| config.enabled = true);
    assert!(!draft.data_arc().enabled);
    assert!(draft.latest_arc().enabled);
    draft.apply();
    assert!(draft.data_arc().enabled);

    draft.edit_draft(|config| config.port = 9090);
    draft.discard();
    assert_eq!(draft.latest_arc().port, 7897);
}

#[tokio::test]
async fn async_updates_are_serialized() -> anyhow::Result<()> {
    let draft = Arc::new(Draft::new(0_u8));
    let mut updates = Vec::new();

    for _ in 0..16 {
        let draft = Arc::clone(&draft);
        updates.push(tokio::spawn(async move {
            draft.with_data_modify(|value| async move { Ok((value + 1, ())) }).await
        }));
    }
    for update in updates {
        update.await??;
    }

    assert_eq!(**draft.data_arc(), 16);
    Ok(())
}

#[tokio::test]
async fn async_update_rejects_a_changed_committed_value() -> anyhow::Result<()> {
    let draft = Arc::new(Draft::new(Config::default()));
    let started = Arc::new(Notify::new());
    let finish = Arc::new(Notify::new());
    let update = {
        let draft = Arc::clone(&draft);
        let started = Arc::clone(&started);
        let finish = Arc::clone(&finish);
        tokio::spawn(async move {
            draft
                .with_data_modify(|mut config| async move {
                    started.notify_one();
                    finish.notified().await;
                    config.enabled = true;
                    Ok((config, ()))
                })
                .await
        })
    };

    started.notified().await;
    draft.edit_draft(|config| config.port = 7897);
    draft.apply();
    finish.notify_one();

    assert!(update.await?.is_err());
    assert!(!draft.data_arc().enabled);
    assert_eq!(draft.data_arc().port, 7897);
    Ok(())
}

#[test]
fn transaction_commits_every_layer() -> anyhow::Result<()> {
    let first = Draft::new(1_u8);
    let second = Draft::new(String::from("a"));
    let transaction = DraftTransaction::begin(vec![&first, &second])?;

    first.edit_draft(|value| *value = 2);
    second.edit_draft(|value| *value = String::from("b"));
    transaction.commit();

    assert_eq!(**first.data_arc(), 2);
    assert_eq!(**second.data_arc(), "b");
    Ok(())
}

#[test]
fn dropped_transaction_rolls_every_layer_back() -> anyhow::Result<()> {
    let first = Draft::new(1_u8);
    let second = Draft::new(String::from("a"));

    {
        let _transaction = DraftTransaction::begin(vec![&first, &second])?;
        first.edit_draft(|value| *value = 2);
        second.edit_draft(|value| *value = String::from("b"));
    }

    assert_eq!(**first.latest_arc(), 1);
    assert_eq!(**second.latest_arc(), "a");
    Ok(())
}

#[test]
fn transaction_claims_are_exclusive_and_release_partial_claims() -> anyhow::Result<()> {
    let first = Draft::new(1_u8);
    let second = Draft::new(2_u8);
    let held = DraftTransaction::begin(vec![&second])?;

    assert!(DraftTransaction::begin(vec![&first, &second]).is_err());
    let available = DraftTransaction::begin(vec![&first])?;

    drop(available);
    drop(held);
    assert!(DraftTransaction::begin(vec![&second]).is_ok());
    Ok(())
}
