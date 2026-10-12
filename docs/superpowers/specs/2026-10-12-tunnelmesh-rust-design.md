# TunnelMesh Rust Integration Design

## Problem

Clash Verge needs to manage the TunnelMesh client without requiring the TunnelMesh tray application. Users should edit the same routing concepts exposed by the tray, keep the configuration in Clash Verge's application data directory, run the client from Clash Verge, and use the resulting local HTTP and SOCKS5 listeners as reusable Mihomo proxies in existing profiles.

The current repository has no TunnelMesh implementation. The reference implementation is the local `/opt/app/workspace/TunnelMesh` repository at revision `5e96c71`. Its client protocol and configuration are external compatibility contracts, so the Rust implementation must be verified against the existing Go server before it is connected to the desktop UI.

## Goals

- Implement a Rust TunnelMesh client that interoperates with the reference Server for the supported client protocols.
- Support the tray routing schema: `mode`, `client.server_url`, `client.token`, and `client.tunnels[]` with `socks5` and `http-proxy` entries in the first desktop release.
- Store the managed client configuration at `<app_home>/tunnelmesh.yaml` with owner-only permissions and atomic replacement.
- Let Clash Verge start, stop, reload, and report the TunnelMesh client state.
- Convert configured local SOCKS5 and HTTP proxy listeners into deterministic Mihomo proxy entries that profile authors can reference.
- Keep secrets out of generated Mihomo configuration, logs, notices, diagnostics, and ordinary status payloads.

## Non-goals for the first release

- Reimplementing TunnelMesh Server, Agent, tray UI, administration APIs, or VPN/TUN support.
- Supporting raw TCP, UDP, or fixed-target HTTP tunnels as Mihomo proxy entries; these remain valid client configuration but are not exposed as proxy nodes.
- Automatically adding generated nodes to existing proxy groups or changing user profile policy.
- Supporting every future TunnelMesh protocol extension before an interoperability test exists.

## Compatibility baseline

The reference baseline is `/opt/app/workspace/TunnelMesh` revision `5e96c71`. The compatibility test matrix must run against a Server built from that revision and cover:

1. WebSocket client authentication with a bearer token.
2. Client metadata and protocol subprotocol negotiation.
3. Multiplexed open/data/close frames and bounded frame decoding.
4. Flow-control windows and window updates under backpressure.
5. Reconnect with bounded exponential backoff after a dropped WebSocket.
6. SOCKS5 dynamic target forwarding.
7. HTTP proxy forwarding, including CONNECT.
8. Clean cancellation and listener shutdown.

The reference repository is Apache-2.0 licensed. Its protocol behavior remains an interoperability constraint even though the implementation is rewritten in Rust.

## Architecture

### Rust client core

Add a `src-tauri/src/tunnelmesh/` module with focused submodules:

- `protocol`: versioned frame types, fixed header codec, payload codecs, stream-open results, and protocol limits.
- `transport`: WebSocket handshake, authorization header, subprotocol negotiation, ping/pong, and bounded receive handling.
- `session`: one physical client session, stream multiplexer, fair writer, flow-control accounting, and cancellation.
- `pool`: per-Agent connection pools, capacity evaluation, reconnect scheduling, and selection of a ready session.
- `forward`: local listener abstractions, SOCKS5 server, HTTP proxy server, and stream adapters.
- `config`: YAML-compatible client settings, validation, secret redaction, and conversion to runtime options.
- `manager`: application-owned lifecycle, generation-based reload, status snapshots, and log classification.

The manager owns a cancellation token and one active runtime generation. A reload validates the candidate first, starts the candidate runtime, and only then retires the previous generation. A failed candidate leaves the previous configuration and runtime active.

### Application configuration

Add `TUNNELMESH_CONFIG` to `src-tauri/src/constants.rs::files` and `tunnelmesh_config_path()` to `src-tauri/src/utils/dirs.rs`. The file contains the TunnelMesh client shape without a Clash-specific wrapper:

```yaml
mode: local
client:
  server_url: wss://example.invalid/ws/client
  token: <write-only secret>
  tunnels:
    - name: internal-socks
      protocol: socks5
      listen: 127.0.0.1:18081
      agent_id: agent-a
      auth_mode: none
```

The enable switch belongs in the Verge configuration as `enable_tunnelmesh`. This keeps `tunnelmesh.yaml` consumable by the reference client and prevents application-only keys from entering the TunnelMesh schema. The file is created lazily on first save, written atomically with mode `0600`, and never copied into runtime Mihomo YAML.

### Clash runtime bridge

Add a pure transformation in the enhance pipeline after profile merge/script processing and before proxy-group cleanup. It reads the validated TunnelMesh snapshot and appends only `socks5` and `http-proxy` tunnels to the root `proxies` sequence:

```yaml
- name: TunnelMesh/internal-socks
  type: socks5
  server: 127.0.0.1
  port: 18081
```

For `http-proxy`, the generated type is `http`. The listener host and port are parsed with the same host:port rules as the client validator. `agent_id`, `auth_url`, client token, and local listener credentials are never copied to Mihomo. Names are prefixed with `TunnelMesh/`; duplicate tunnel names and collisions with profile proxies are validation errors. The bridge does not mutate `proxy-groups` or `rules`, so users can explicitly reference the generated names from their own profiles.

### Tauri command boundary

Add a dedicated command module and register it in `cmd/mod.rs` and `src-tauri/src/lib.rs`:

- `get_tunnelmesh_config`: returns a redacted/editable view with token presence, never the stored token.
- `save_tunnelmesh_config`: accepts a full candidate plus an optional token replacement, validates and atomically persists it.
- `validate_tunnelmesh_config`: parses and validates without writing or starting a runtime.
- `get_tunnelmesh_status`: returns lifecycle state, configured listener summaries, and sanitized last error.
- `set_tunnelmesh_enabled`: updates the Verge setting and starts or stops the manager.

All mutating commands use the shared configuration write lock and the existing command failure shape. Status events are owned by the services bus; components do not subscribe directly to backend events.

### Frontend

Add a `/tunnelmesh` route through `_navigation-meta.ts` and `_navigation.tsx`, with a dedicated page based on `BasePage`. The page has:

- enable/disable control and runtime status;
- server URL and write-only token field;
- add/remove tunnel cards for SOCKS5 and HTTP proxy entries;
- listener address, Agent ID, auth mode, remote access, and optional remote auth URL;
- an advanced YAML editor using the existing Monaco wrapper;
- save, validate, restart, and revert-to-last-known-good actions.

Commands are wrapped in `src/services/cmds.ts`; reads use the existing query pattern and writes use `services/mutate.ts`. English locale keys are the source of truth, followed by `pnpm i18n:types`; other locales may fall back to the existing language fallback until translated.

### Backup and recovery

The local and WebDAV backup archive includes `tunnelmesh.yaml` when present. Restore writes it atomically before configuration reload. Backup export redacts the TunnelMesh token in the same way Verge WebDAV credentials are redacted, or excludes the file when a secret-preserving backup is not explicitly requested. The chosen behavior must be covered by a user-visible backup contract before implementation.

## Error handling and security

- Validate server URL, token presence, tunnel protocol, listen host:port, duplicate listeners, and non-loopback authentication requirements before writing.
- Treat listener bind failure, protocol incompatibility, authentication failure, and remote Agent failure as separate status categories.
- Use bounded exponential backoff with jitter for reconnects; never retry a malformed configuration.
- Stop the client before replacing a listener set and guarantee cancellation on application shutdown.
- Redact token values from tracing fields, error strings, diagnostics, YAML previews, crash reports, and generated runtime configuration.
- Keep the existing TunnelMesh environment variable names for local proxy credentials, but never persist those values in `tunnelmesh.yaml`.

## Testing strategy

The Rust core needs focused unit tests for frame codec bounds, stream-open encoding, flow-control accounting, reconnect policy, SOCKS5 negotiation, HTTP CONNECT, and configuration validation. Integration tests use a small protocol-compatible fake Server and at least one real reference Server fixture for end-to-end SOCKS5 and HTTP proxy forwarding. Clash bridge tests assert stable names, type mapping, collision failures, and omission of secrets.

The desktop layer needs command tests for atomic save/rollback, manager reload behavior, status redaction, and backup inclusion. Frontend tests should cover navigation presence, token write-only behavior, invalid form rejection, and save/reload state. Full application verification remains `cargo test`, targeted Rust integration tests, `pnpm lint`, `pnpm typecheck`, and the relevant Vitest files.

## Delivery sequence

1. Rust protocol and data-plane core with interoperability tests.
2. Desktop configuration file, lifecycle manager, Tauri commands, and status events.
3. Clash runtime bridge, navigation/UI, i18n, backup/restore, packaging, and end-to-end smoke tests.

Each stage must leave the previous stage working and independently testable. No stage should silently fall back to an external TunnelMesh tray process.
