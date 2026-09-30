# Frontend Architecture Guardrails

These rules supplement the repository's root `AGENTS.md`. They define the
layering introduced by the frontend contract flow; violating any of them is
rework, not a review note.

1. **Contract is generated, never hand-typed.** Event names, payload shapes,
   and the `NoticeStatus` union come from `src/services/contract.ts`
   (`@generated`). Regenerate with `pnpm gen:contract` after changing the
   backend wire contract, and commit the result; CI regenerates and fails on
   a diff. Adding a backend status requires updating the exhaustive notice
   table (`src/services/notice-handlers.ts`) in the same PR — the
   `Record<NoticeStatus, …>` type enforces it. No exceptions.
2. **`listen(`/`emit(` live only in the event bus.** All Tauri event
   subscriptions and emissions go through `src/services/bus/`, which mounts
   exactly once at the layout root and registers exactly one handler per
   event name. Components and pages never touch `@tauri-apps/api/event`.
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
   `src/services/cmds.ts`; mihomo-plugin mutations are governed by rule 4.
   Pages and components import the wrapper, never `@tauri-apps/api/core`. CI
   greps for this and rule 2 (`node scripts/check-architecture.mjs listen
   emit invoke` must stay clean).
