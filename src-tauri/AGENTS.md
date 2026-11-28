# Backend Architecture Guardrails

These rules supplement the repository's root `AGENTS.md`.

- **Configuration ownership.** `config` owns source configuration, drafts and
  persistence. The effects layer owns patch orchestration. Rollbackable
  transactions publish state after persistence and commit; already applied
  runtime and independently committed state remain authoritative even when a
  later step fails. Preserve that state, its notifications and the error.
- **Effect ownership.** The declarative registry classifies every Verge patch field,
  including fields without effects and platform-specific fields. Effects
  reconcile toward the requested state with explicit dependencies and ordering.
  Configuration rollback does not imply reversal of OS or lifecycle effects.
- **Shared wire contract.** Notifications are typed. Event names, status values
  and payload shapes stay compatible with frontend producers and consumers.
- **Synchronization ownership.** Configuration-write serialization precedes
  configuration-update ownership, which precedes Core lifecycle ownership.
  When both are held, the lifecycle lock precedes the DNS lock. Independent
  transactions retain their ownership boundaries; asynchronous work does not
  hold synchronous data guards across suspension.
- **Task ownership.** Prefer a single task to own the state and resources of a
  background operation whose start, replacement, and cleanup must be ordered.
  Use typed inputs and coalesce requests only when intermediate requests may
  be skipped. When callers depend on completion, reply with the actual outcome.
  Cancel work only at cancellation-safe boundaries. Keep issued side effects
  owned through completion or explicit reconciliation. Preserve shared
  transaction boundaries and ensure a task can reply without acquiring a lock
  held by the waiting caller.
- **Retry ownership.** Bounded retries share backend policy while preserving
  attempts, delays and terminal errors. Background monitors own their lifetime
  and cancellation separately; waiting for a condition or traversing distinct
  candidates is not a retry policy.
