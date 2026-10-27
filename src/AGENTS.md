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
- **State liveness.** Every `useState`/`useRef` member has a reachable write
  that differs from its initial value and a read that observes the difference.
  A value that can only ever hold its initial value is a constant: declare the
  constant and delete the state. A ref nothing reads is deleted, not kept.
- **Surface liveness.** Anything a module exposes — props, parameters, context
  members, imperative-handle methods — ships with at least one external caller
  in the same change. "Reserved for future use" fields, `_`-prefixed params
  that callers still pass, and error or callback channels that every receiver
  ignores are removed, not maintained.
- **Path liveness.** A fallback or branch names the concrete runtime condition
  that reaches it. If no supported runtime can reach it, the branch is not
  added — or it replaces the primary path. Constant subexpressions and cleanup
  of resources that cannot exist yet are simplified away.
- **Effect economy.** One user interaction produces one state write and one
  command. A handler does not re-apply a value its wrapper already applied,
  and an effect does not re-run a refresh another branch of the same effect
  just ran.
- **Mount economy.** Components that issue commands or subscriptions on mount
  are mounted only where their UI is reachable. A dialog no rendered control
  can open stays unmounted, not mounted-and-idle.
- **Resource bounds.** Every cache key, timer and subscription a feature
  allocates is reused or released on refresh; refresh never allocates an
  unbounded sequence of new keys. Retries re-create per-attempt resources so
  a retry can actually succeed.
