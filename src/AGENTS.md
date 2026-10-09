# Frontend Architecture Guardrails

These rules supplement the repository's root `AGENTS.md`.

- **Contract ownership.** Generated event and notice contracts are owned by the
  backend wire contract. Handwritten payload types are acceptable when they
  match their producers. Event names, payloads and the typed notice table stay
  aligned across backend and frontend.
- **Event ownership.** `services/bus` owns event subscriptions, emissions and
  their lifetime. Components and pages consume the bus rather than subscribing
  independently; window lifecycle remains with its owning component.
- **State ownership.** `store` owns shared event state and the snapshot reads that
  reconcile it through pure reducer actions. Query caches retain ordinary
  configuration and profile reads. Reads and live events share an ordering
  boundary so an older reply cannot replace newer authoritative state.
  Components keep local UI state.
- **Intent ownership.** Mutating commands pass through the shared intent funnel.
  Resource ownership determines serialization; distinct requests are preserved,
  and success effects follow actual command success. Bespoke error flows retain
  their handling without duplicate or suppressed errors.
- **Command ownership.** `services` owns backend command invocation and transport
  wrappers. Components and hooks use those boundaries; plugin mutations follow
  the same intent ownership as backend commands.
