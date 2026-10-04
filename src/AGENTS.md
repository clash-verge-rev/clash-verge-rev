# Frontend Architecture Guardrails

These rules supplement the repository's root `AGENTS.md` and define the
frontend's ownership and module boundaries.

1. **Contract is generated, never hand-typed.** Event names, payload shapes,
   and the `NoticeStatus` union come from `src/services/contract.ts`
   (`@generated`) from the backend wire contract. Keep backend producers,
   generated types, and the exhaustive notice table
   (`src/services/notice-handlers.ts`) aligned; `Record<NoticeStatus, …>`
   makes notice handling part of that contract.
2. **`listen(`/`emit(` live only in the event bus.** All Tauri event
   subscriptions and emissions go through `src/services/bus/`. The shared
   bus owns subscription registration and teardown at the layout root.
   Components and pages never touch `@tauri-apps/api/event`.
   Window-lifecycle helpers that do not use the event-module API may stay
   with their owning component.
3. **Event-derived state lives in the app store.** Cross-component state
   produced by events is written only through pure reducer actions dispatched
   by the bus or the funnel (`src/store/`). Handlers may perform documented
   side effects (SWR revalidation, notices) but must not write store state
   directly. New event-consumed state needs a reducer action first, not a
   local `useState` in a page.
4. **User intent funnels through `mutate`.** Every mutating backend command
   call goes through `src/services/mutate.ts` — components, hooks, and
   dialogs included. Give each intent a stable `id`; express optimistic
   writes as `optimistic`/`rollback` and success refreshes as `revalidate`/
   `onFulfilled`. Flows with bespoke error UX keep it via `errorNotice:
   false`; suppressing both the funnel's and the site's handling is a bug.
5. **`invoke(` lives only in services.** Backend commands are wrapped in
   `src/services/cmds.ts`; mihomo-plugin mutations use the same intent funnel.
   Pages and components import the wrapper, never `@tauri-apps/api/core`.
