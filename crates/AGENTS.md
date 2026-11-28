# Workspace Crate Architecture

## Choose the boundary

- Extract a capability whose invariants can be owned behind a small API. Before
  creating a crate, identify its owner, what callers supply, and what can be
  verified through the crate API. Keep a module when the proposed boundary only
  relocates implementation or introduces a pass-through API.
- Keep the dependency direction from the app to the crate. Resolve app paths,
  read product settings, start app-owned tasks, and publish UI events in the app.
  Pass the values, resources, or callbacks the crate needs. For example,
  [logging](clash-verge-logging/src/lib.rs) owns its pipeline and writers while the
  app supplies directories and limits through `LoggerConfig`.
- Keep framework and platform dependencies scoped to the capability that needs
  them. Runtime-independent logic should be runnable without the desktop app.
  A platform adapter can own runtime startup when its resource lifetime requires
  it, as [signal](clash-verge-signal/src/lib.rs) does for Linux shutdown.

## Design the API

- Start with concrete types for data and outcomes. Use a trait when methods must
  cooperate under one contract, a closure for one supplied operation, and
  `impl Future` when the caller owns scheduling. Add type parameters and bounds
  where the contract needs them. Use dynamic dispatch when the API needs to hold
  heterogeneous implementations, as [draft](clash-verge-draft/src/lib.rs) does
  for the layers claimed by `DraftTransaction`.
- Keep state and its invariants with one owner. Expose snapshots, typed
  operations, or guards. Draft owns claim, commit, and rollback of its in-memory
  layers. The caller owns persistence and the recovery of external effects.
- Name product workspace libraries with the `clash-verge-` prefix and inherit
  workspace lints. Reuse workspace dependencies where available and declare
  only the features the crate needs.

## Own background work

- Give ordered start, replacement, and cleanup to one task owner. Reuse
  [`clash-verge-task`](clash-verge-task/src/lib.rs) for coalescing scheduled jobs
  and replaceable sessions. Keep domain policy, execution callbacks, and runtime
  startup at the call site. Select a driver whose delivery guarantees match the
  caller's needs.
- Use typed inputs. Coalesce only when intermediate requests may be skipped.
  Reply with the actual outcome when a caller waits for completion. Preserve
  transaction boundaries and keep the reply path free of locks held by the
  waiting caller. Cancel only at safe boundaries and own issued effects through
  completion or explicit reconciliation.

Verify the extracted contract through its public API when practical. Use
`cargo test -p <crate>` for focused tests and keep native behavior checks at the
app boundary. For timing, prefer Tokio's paused clock for task drivers or a
small clock interface where time is an input, as in
[`clash-verge-limiter`](clash-verge-limiter/src/lib.rs).
