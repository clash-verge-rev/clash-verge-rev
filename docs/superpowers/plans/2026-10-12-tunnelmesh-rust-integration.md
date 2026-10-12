# TunnelMesh Rust Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rust-native TunnelMesh client to Clash Verge, expose its routing settings in a new left navigation page, persist the client configuration in the Clash Verge data directory, and expose local SOCKS5/HTTP proxy listeners as reusable Mihomo proxies.

**Architecture:** Build the TunnelMesh client as an internal Rust module with protocol, session, forwarding, configuration, and lifecycle boundaries. A single application manager owns one reloadable client generation. The existing enhance pipeline derives namespaced Mihomo proxy entries from validated TunnelMesh listeners without mutating user proxy groups.

**Tech Stack:** Rust/Tokio, `tokio-tungstenite` or the repository's existing WebSocket stack after dependency review, `serde_yaml_ng`, Tauri commands, React/TypeScript, Monaco, Vitest, and the existing Mihomo enhancement pipeline.

**Spec:** `docs/superpowers/specs/2026-10-12-tunnelmesh-rust-design.md`

## Global Constraints

- Reference compatibility baseline is local TunnelMesh revision `5e96c71`.
- `tunnelmesh.yaml` is stored under `dirs::app_home_dir()` and written atomically with owner-only permissions.
- TunnelMesh tokens and local proxy credentials never enter runtime Mihomo YAML, logs, notices, diagnostics, or ordinary status responses.
- Generated proxy names use the `TunnelMesh/` namespace and collisions are validation errors.
- The first release supports `socks5` and `http-proxy` listener integration; raw TCP/UDP/fixed-target HTTP remain client-only configuration.
- Do not modify user profiles or automatically add generated nodes to proxy groups.
- All command mutations use the shared configuration write boundary and return the repository's structured command failures.
- Do not commit or push unless the user explicitly requests it.

---

### Task 1: Capture the local interoperability baseline

**Files:**
- Create: `docs/superpowers/evidence/2026-10-12-tunnelmesh-baseline.md`

**Interfaces:**
- Consumes: running local Clash Verge and TunnelMesh processes, local TunnelMesh configuration shape.
- Produces: redacted listener/port/protocol evidence and a repeatable manual smoke-test procedure.

- [ ] **Step 1: Inspect process ownership and listening sockets**

Run platform-appropriate read-only commands (`ps`, `lsof`/`netstat`) and record only process names, PIDs, listener addresses, and protocol types. Do not print command lines containing the client token.

- [ ] **Step 2: Probe the existing local SOCKS5 endpoint**

Use a local loopback probe against the configured listener and record only success/failure, negotiated protocol, and target fixture. Do not include credentials or response bodies containing secrets.

- [ ] **Step 3: Record the redacted configuration contract**

Document the keys `mode`, `client.server_url`, `client.token` presence, and each tunnel's `name`, `protocol`, `listen`, and `agent_id` with token and secret values replaced by `<redacted>`.

- [ ] **Step 4: Save the evidence**

Write the redacted evidence file and verify it contains no token-like value with a targeted search.

### Task 2: Add the Rust protocol foundation

**Files:**
- Create: `src-tauri/src/tunnelmesh/mod.rs`
- Create: `src-tauri/src/tunnelmesh/protocol.rs`
- Create: `src-tauri/src/tunnelmesh/protocol_codec.rs`
- Create: `src-tauri/src/tunnelmesh/protocol_test.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: TunnelMesh frame definitions from the local reference implementation.
- Produces: bounded `Frame`, `FrameType`, stream-open, metadata, and window-update encode/decode APIs used by later session tasks.

- [ ] **Step 1: Add failing codec tests**

Cover fixed header round trips, unsupported versions, unknown frame types, truncated payloads, maximum payload enforcement, and stream ID validation.

- [ ] **Step 2: Run targeted Rust tests and verify failure**

Run `cargo test -p clash-verge -- tunnelmesh::protocol` from `src-tauri` (or the repository's actual package name). Expected: tests fail because the module and codec are absent.

- [ ] **Step 3: Implement bounded protocol types and codec**

Match the reference wire order and limits exactly. Decoder allocation must be bounded before reading a peer-controlled length.

- [ ] **Step 4: Add reference-vector tests**

Use byte vectors generated from the Go reference tests for client metadata, open stream, data, close, ping/pong, and window update frames.

- [ ] **Step 5: Run targeted tests and formatting**

Run `cargo test -p clash-verge -- tunnelmesh::protocol` and `cargo fmt -- --check`.

### Task 3: Implement WebSocket transport and one multiplexed session

**Files:**
- Create: `src-tauri/src/tunnelmesh/transport.rs`
- Create: `src-tauri/src/tunnelmesh/session.rs`
- Create: `src-tauri/src/tunnelmesh/session_test.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: Task 2 frame codec.
- Produces: `TunnelMeshTransport`, `TunnelMeshSession`, cancellation-safe frame send/receive, bearer authentication, subprotocol negotiation, ping/pong, and stream lifecycle APIs.

- [ ] **Step 1: Write fake-server transport tests**

Test authorization header placement, strict subprotocol, ping/pong, cancellation, malformed frame termination, and one bidirectional stream with flow-control credits.

- [ ] **Step 2: Run tests and verify failure**

Run `cargo test -p clash-verge -- tunnelmesh::transport tunnelmesh::session`. Expected: compile/test failure before implementation.

- [ ] **Step 3: Implement transport and session loops**

Use bounded channels, explicit cancellation, and a fair writer. Keep bearer tokens in request headers only and exclude them from error formatting.

- [ ] **Step 4: Implement flow-control accounting**

Track advertised receive windows, emit updates only after application consumption crosses the configured threshold, and reject over-credit frames.

- [ ] **Step 5: Run targeted tests**

Run the transport/session tests plus `cargo clippy -p clash-verge --all-targets -- -D warnings` for touched modules.

### Task 4: Add connection pooling and local SOCKS5/HTTP proxy forwarders

**Files:**
- Create: `src-tauri/src/tunnelmesh/pool.rs`
- Create: `src-tauri/src/tunnelmesh/forward.rs`
- Create: `src-tauri/src/tunnelmesh/forward_test.rs`
- Modify: `src-tauri/src/tunnelmesh/mod.rs`

**Interfaces:**
- Consumes: Task 3 session stream opener.
- Produces: per-Agent pools, reconnect backoff, `Socks5Forward`, `HttpProxyForward`, listener startup/shutdown, and sanitized listener errors.

- [ ] **Step 1: Add forwarding tests**

Cover SOCKS5 no-auth negotiation, password rejection/acceptance, dynamic target open, HTTP absolute-form requests, CONNECT, unsupported methods, listener bind conflicts, and non-loopback safety checks.

- [ ] **Step 2: Run tests and verify failure**

Run `cargo test -p clash-verge -- tunnelmesh::forward`. Expected: failure before implementations exist.

- [ ] **Step 3: Implement connection pool**

Select ready sessions by Agent ID, maintain bounded min/max connections, and reconnect with exponential backoff plus jitter. Preserve active streams until their session closes.

- [ ] **Step 4: Implement SOCKS5 and HTTP proxy listeners**

Use Tokio listeners and copy data through session streams. Bind loopback by default; require `allow_remote` plus the corresponding auth mode for non-loopback addresses.

- [ ] **Step 5: Run forwarding tests and inspect logs**

Run targeted tests and ensure all expected errors omit token and credential values.

### Task 5: Add configuration parsing, validation, and lifecycle manager

**Files:**
- Create: `src-tauri/src/tunnelmesh/config.rs`
- Create: `src-tauri/src/tunnelmesh/manager.rs`
- Create: `src-tauri/src/tunnelmesh/config_test.rs`
- Create: `src-tauri/src/tunnelmesh/manager_test.rs`
- Modify: `src-tauri/src/constants.rs`
- Modify: `src-tauri/src/utils/dirs.rs`
- Modify: `src-tauri/src/config/verge.rs` (or the repository's actual Verge config type)
- Modify: `src-tauri/src/config/config.rs`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `TunnelMeshConfig`, `TunnelMeshManager`, redacted snapshots, atomic persistence, reload generations, and `enable_tunnelmesh` Verge setting.

- [ ] **Step 1: Add config and manager tests**

Test missing-file defaults, YAML round trip, token write-only snapshots, invalid server URL, duplicate listeners, unsupported protocols, non-loopback auth requirements, atomic rollback, and failed candidate reload preserving the previous runtime.

- [ ] **Step 2: Run tests and verify failure**

Run `cargo test -p clash-verge -- tunnelmesh::config tunnelmesh::manager`. Expected: failure before implementation exists.

- [ ] **Step 3: Implement path and Verge setting**

Add `tunnelmesh_config_path()` and a persisted `enable_tunnelmesh` field. Do not initialize a secret-bearing file unless the user saves one.

- [ ] **Step 4: Implement parser and validator**

Preserve the TunnelMesh YAML shape, validate only supported fields, retain unknown future-compatible keys where safe, and redact token values in all display structures.

- [ ] **Step 5: Implement generation-based manager reload**

Load candidate, validate, start listeners, publish status, then stop the previous generation. On failure, remove the candidate runtime and keep the old generation.

- [ ] **Step 6: Run targeted tests**

Run config/manager tests, `cargo fmt -- --check`, and `cargo clippy -p clash-verge --all-targets -- -D warnings`.

### Task 6: Expose Tauri commands and status events

**Files:**
- Create: `src-tauri/src/cmd/tunnelmesh.rs`
- Modify: `src-tauri/src/cmd/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/services` or the existing backend event owner identified during implementation
- Create: `src-tauri/src/cmd/tunnelmesh_test.rs`

**Interfaces:**
- Consumes: Task 5 manager.
- Produces: `get_tunnelmesh_config`, `save_tunnelmesh_config`, `validate_tunnelmesh_config`, `get_tunnelmesh_status`, and `set_tunnelmesh_enabled` commands plus bus-owned status notices.

- [ ] **Step 1: Add command contract tests**

Assert redacted reads, structured failures, serialized writes through the config lock, status transitions, and stop/start behavior when enablement changes.

- [ ] **Step 2: Implement command wrappers**

Keep file and manager operations in the service boundary; components must not invoke filesystem APIs directly.

- [ ] **Step 3: Register commands and events**

Add module exports and `generate_handler!` entries. Route status events through the existing bus ownership rules.

- [ ] **Step 4: Run command tests and architecture checks**

Run the targeted Rust tests and `pnpm arch:check` from the repository root.

### Task 7: Inject TunnelMesh proxies into generated Mihomo config

**Files:**
- Create: `src-tauri/src/enhance/tunnelmesh.rs`
- Create: `src-tauri/src/enhance/tunnelmesh_test.rs`
- Modify: `src-tauri/src/enhance/mod.rs`
- Modify: `src-tauri/src/config/config.rs`

**Interfaces:**
- Consumes: validated TunnelMesh config from Task 5.
- Produces: deterministic `TunnelMesh/<name>` proxy mappings inserted before proxy-group cleanup.

- [ ] **Step 1: Add transformation tests**

Cover SOCKS5 and HTTP mapping, IPv4/IPv6 listener parsing, duplicate names, collisions with profile proxies, omission of token/Agent/auth fields, disabled configuration, and invalid listeners.

- [ ] **Step 2: Run tests and verify failure**

Run `cargo test -p clash-verge -- enhance::tunnelmesh`. Expected: failure before the transformer exists.

- [ ] **Step 3: Implement pure transformation**

Append only the generated proxy mappings to the root proxy sequence. Do not alter proxy groups, rules, or user profile files.

- [ ] **Step 4: Place transformation in the enhance pipeline**

Run it after profile merge/script processing and before cleanup so user groups can reference generated names while stale references still fail validation clearly.

- [ ] **Step 5: Run enhance tests**

Run targeted tests and existing `src-tauri` enhancement tests.

### Task 8: Add the TunnelMesh settings page and navigation item

**Files:**
- Create: `src/pages/tunnelmesh.tsx`
- Create: `src/components/tunnelmesh/tunnel-form.tsx`
- Create: `src/components/tunnelmesh/tunnel-yaml-editor.tsx`
- Modify: `src/pages/_navigation-meta.ts`
- Modify: `src/pages/_navigation.tsx`
- Modify: `src/services/cmds.ts`
- Modify: `src/services/i18n.ts` only if a new section is required
- Modify: `src/locales/en/layout.json`
- Modify: `src/locales/en/settings.json` (or a dedicated section if loader changes are justified)
- Modify: all existing locale layout/settings files as appropriate
- Modify: generated i18n files via `pnpm i18n:types`

**Interfaces:**
- Consumes: Task 6 command contracts and status events.
- Produces: a user-facing route matching the existing navigation and configuration patterns.

- [ ] **Step 1: Add frontend command wrappers and component tests**

Test redacted token display, add/remove tunnel rows, protocol-specific fields, invalid save state, and status rendering.

- [ ] **Step 2: Implement the page and form**

Use `BasePage`, existing settings controls, `useQuery`/the repository query pattern for reads, `mutate()` for writes, and `EditorViewer`/Monaco for advanced YAML.

- [ ] **Step 3: Add navigation and i18n keys**

Add a stable `/tunnelmesh` path and translated label. Keep user-facing copy in locale files; do not hard-code Chinese strings in components.

- [ ] **Step 4: Regenerate i18n types and run frontend checks**

Run `pnpm i18n:types`, `pnpm typecheck`, the targeted Vitest files, and `pnpm lint`.

### Task 9: Add backup/restore, packaging, and end-to-end smoke tests

**Files:**
- Modify: `src-tauri/src/core/backup.rs`
- Modify: `src-tauri/src/config/snapshot.rs` or the repository's restore implementation
- Modify: platform packaging configuration under `src-tauri/` and `scripts/prebuild.mjs` if required
- Create: `src-tauri/tests/tunnelmesh_e2e.rs`
- Create: `docs/superpowers/evidence/2026-10-12-tunnelmesh-smoke-test.md`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: recoverable secret-aware backups, packaged runtime support, and an end-to-end proof against the local TunnelMesh client/server.

- [ ] **Step 1: Add backup/restore tests**

Verify the configuration file is included when present, restored atomically, and never exposes the token in export logs or diagnostics.

- [ ] **Step 2: Add packaging support**

Only after the Rust implementation is stable, include any required resources or platform permissions. Avoid adding a second process unless integration tests prove the in-process manager cannot satisfy lifecycle requirements.

- [ ] **Step 3: Run local end-to-end smoke test**

With the existing local TunnelMesh server/client configuration, start Clash Verge, enable TunnelMesh, verify the configured listener, verify a generated `TunnelMesh/<name>` node in runtime YAML, route a controlled request through Mihomo, disable the feature, and verify listeners close.

- [ ] **Step 4: Run the complete verification set**

Run targeted Rust tests, `cargo test`, `cargo fmt -- --check`, `cargo clippy --all-targets -- -D warnings`, `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run`, and `pnpm arch:check` as applicable to the final diff.

- [ ] **Step 5: Record evidence**

Write only redacted commands, outcomes, and relevant error categories to the smoke-test evidence file.
