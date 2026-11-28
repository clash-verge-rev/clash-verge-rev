# Backend Architecture Guardrails

Use [Workspace Crate Architecture](../crates/AGENTS.md) when extracting backend
capabilities or changing background task ownership.

- **Configuration and effects.** `config` owns source configuration, drafts, and
  persistence. The effects layer classifies every Verge patch field, including
  fields without effects and platform-specific fields, and reconciles requested
  state in dependency order. Publish rollbackable state after persistence and
  commit. On failure, preserve already applied runtime effects, independently
  committed state, their notifications, and the error.
- **Wire contract.** Use typed notifications and preserve event names, status
  values, and payload compatibility with frontend consumers.
- **Lock order.** Acquire configuration-write, configuration-update, Core
  lifecycle, and DNS ownership in that order when needed. Preserve independent
  transaction boundaries and release synchronous guards before suspension.
- **Retries.** Reuse the backend retry policy and preserve attempts, delays, and
  terminal errors. Keep monitor lifetime, condition waits, and candidate fallback
  under their own contracts.
