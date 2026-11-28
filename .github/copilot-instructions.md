# GitHub Copilot Instructions

Read and follow [AGENTS.md](../AGENTS.md) before working in this repository. It
is the shared instruction contract used by the existing Claude and Gemini entry
points; keep repository-wide rules there rather than duplicating them here.

## Task-specific guidance

- Development and bug fixes: follow
  [CONTRIBUTING.md](../CONTRIBUTING.md#development-workflow), including its
  setup and validation guidance.
- Frontend changes: read [src/AGENTS.md](../src/AGENTS.md).
- Backend changes: read [src-tauri/AGENTS.md](../src-tauri/AGENTS.md).
- Reviews and verification of review fixes: follow
  [REVIEW.md](../REVIEW.md).
- Issue and PR work, including CLI/API operations: read
  [.github/AGENTS.md](AGENTS.md).
- macOS frontend performance or WebView memory investigations: follow
  [scripts/perf/AGENTS.md](../scripts/perf/AGENTS.md).
- User-visible changelog entries: follow
  [template/Changelog.md](../template/Changelog.md).

## Build, test, and lint commands

Run from the repository root. Use the toolchain pins and Corepack setup
described in [CONTRIBUTING.md](../CONTRIBUTING.md#development-setup);
`corepack pnpm` can also be used in place of `pnpm`.

| Purpose                                   | Command                                                                           |
| :---------------------------------------- | :-------------------------------------------------------------------------------- |
| Install dependencies                      | `pnpm install --frozen-lockfile`                                                  |
| Download Mihomo and service binaries      | `pnpm run prebuild`                                                               |
| Desktop development                       | `pnpm dev`                                                                        |
| Desktop development with devtools feature | `pnpm dev:tauri`                                                                  |
| Frontend-only development                 | `pnpm web:dev`                                                                    |
| Desktop build / fast build                | `pnpm build` / `pnpm build:fast`                                                  |
| Frontend build                            | `pnpm web:build`                                                                  |
| Frontend lint / type check                | `pnpm lint` / `pnpm typecheck`                                                    |
| Frontend tests                            | `pnpm test`                                                                       |
| One frontend test file                    | `pnpm test src/services/mutate.test.ts`                                           |
| One named frontend test                   | `pnpm test src/services/mutate.test.ts -t "<test name>"`                          |
| Rust lint                                 | `cargo clippy-all`                                                                |
| Rust workspace tests                      | `cargo test --workspace`                                                          |
| One Rust package / matching test          | `cargo test -p clash-verge-draft` / `cargo test -p clash-verge-draft <test_name>` |
| Formatting checks                         | `pnpm format:check` / `cargo fmt --check`                                         |
| Apply formatting                          | `pnpm format` / `cargo fmt`                                                       |
| Check generated IPC contracts             | `pnpm gen:contract --check`                                                       |
| Check frontend IPC/event boundaries       | `pnpm arch:check`                                                                 |

Frontend tests use Vitest's Node environment, not a browser. Select checks
using the [validation guidance](../CONTRIBUTING.md#choosing-validation).

## Architecture and conventions

- Clash Verge Rev is a Tauri 2 desktop GUI for the Mihomo core. React runs in
  the native WebView; Rust manages configuration, Core/Service lifecycle and OS
  integration. Use `tauri-plugin-mihomo` for core interaction. A Vite-only
  preview does not validate native networking or lifecycle behavior.
- Frontend query reads use the SWR-backed
  [query-client wrapper](../src/services/query-client.ts). Shared event state
  belongs to `store`; `services/bus` owns subscriptions and their lifetime.
  Backend invocations belong to `services`, and mutations use the shared intent
  funnel. Preserve ordering between snapshot reads and live events.
- Backend `config` owns drafts and persistence; the effects layer orchestrates
  patches. Preserve committed/runtime state after partial failure and follow
  the lock ordering in [backend guardrails](../src-tauri/AGENTS.md).
- The backend owns the generated wire contract. Regenerate
  [bindings.ts](../src/services/bindings.ts) with `pnpm gen:contract` when
  changing contracts, keeping frontend consumers and backend producers aligned.
- Locale maintenance uses `pnpm i18n:check`, `pnpm i18n:format` and
  `pnpm i18n:types`; follow the shared instructions for localization.
