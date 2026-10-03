# Backend Architecture Guardrails

These rules supplement the repository's root `AGENTS.md`.

1. **Keep configuration ownership in `config`.** Configuration writes must use
   its draft and persistence APIs. Patch orchestration must use
   `feat/effects.rs` and `feat/executor.rs`; refresh notifications must use
   `core::notify::announce` after successful persistence and commit. This keeps
   failed transactions from publishing state. Independent transactions retain
   their boundaries and announce via `after_commit`; runtime-only profile
   activation announces after successful application. New cross-layer
   exceptions require a rationale in the PR and an update to this file.
2. **Register every new `IVerge` field.** Add one row, including an explicit
   `NoEffect` where appropriate, to the exhaustive registry and preserve its
   platform attributes. Keep the serialized-field coverage test passing. Manual
   field-to-flag chains hide missing effects and are forbidden. No exceptions.
3. **Use `utils::retry` for bounded retries.** Do not introduce handwritten retry
   loops, including `loop` plus `sleep`; preserve attempt budgets, delays and
   terminal errors. Permanent watchers are the exception and must document
   their exit conditions. Traversal of distinct data or port candidates is not
   a retry policy.
4. **Keep notifications typed.** Send notice statuses through `NoticeStatus` and
   use `Arc<str>` for notice message payloads. Preserve the event names and
   status strings pinned by the golden tests. Status additions or changes
   require frontend and backend changes in the same PR and an updated golden
   list; this protects the wire contract. No exceptions.
5. **Preserve lock order.** The order is `config_write` before
   `config_update_in_progress` before `lifecycle_lock`. Patch callers must use
   the executor's guarded claim instead of independently combining these locks;
   this preserves Busy rejection and prevents inverted acquisition. Existing
   lifecycle and independent port transactions keep their established locking
   boundaries. A new lock requires registering its position in this rule before
   introducing acquisition sites.
6. **Prefer reconciliation.** Express new effects as idempotent `ensure`
   operations in `EFFECT_ORDER` so repeated application converges on the same
   state. A trigger chain is an exception only with a code comment explaining
   why the operation cannot be idempotent. Configuration rollback does not
   authorize reverse OS effects.
