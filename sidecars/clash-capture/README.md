# Clash Capture

A local capture module integrated into this Clash Verge Rev fork. It runs as a Go sidecar and does not require Python or mitmproxy.

The modified client adds a Capture page, owns the sidecar lifetime, and routes the system HTTP/SOCKS proxy through it while retaining Mihomo as the upstream. TUN must be disabled before starting capture. System Proxy is optional: with it enabled, disable PAC and the client routes system traffic automatically; with it disabled, configure a browser or other client to use HTTP/SOCKS5 `127.0.0.1:17891`. Manual mode leaves OS proxy settings untouched. Stopping capture restores the Mihomo port. An unexpected module exit also restores that route. If the Mihomo mixed port changes during capture, the client detects it on the next monitor tick (normally within two seconds), stops capture, and restores the normal system-proxy route. Start capture again to use the new upstream port.

## Standalone module

Build or run the module directly with Go. It binds only loopback addresses.

```sh
go run . --upstream http://127.0.0.1:7890
```

The default proxy is `127.0.0.1:17891`, the management API is `127.0.0.1:17892`, and persistent data is stored in the platform user configuration directory under `clash-capture`. `--data` selects another directory. The `api-token` file has mode 600 and changes on each start. Open the management page with `http://127.0.0.1:17892/?token=TOKEN`, substituting that local token. It is a local credential; do not share the URL.

Capturing starts disabled. With it off, HTTPS uses a CONNECT tunnel and is not decrypted. With capturing enabled, selected hosts are decrypted (the equivalent of Fiddler's Decrypt HTTPS) and matching requests are captured. Disabling capturing affects new requests and new TLS connections; already established TLS sessions may remain decrypted until closed. Filter rules restrict which requests are captured; unmatched requests are forwarded without capturing.

HTTPS decryption requires trusting the module CA, downloadable from the Capture page (or `GET /certificate` on the management port). To reuse an existing CA, stop the module and place its combined PEM certificate/private-key bundle at `DATA/ca.pem`. This file is never included in the public certificate download. Preserve the data directory across upgrades.

The module captures request/response headers and up to 1 MiB of each body, forwarding the remainder without truncating network traffic. Body capture is streamed; a body is saved on completion or close. Binary bodies use Base64. Captured sessions can be filtered by method, status class, and content type, and copied as curl commands. WebSocket handshakes can be captured, but WebSocket messages and UDP/HTTP3 traffic are not captured. Certificate-pinned applications may reject HTTPS interception. The latest 1000 sessions are retained; older sessions are automatically evicted from memory and disk. Captured sessions persist as individual JSON files; deletion removes them permanently.

## Buffered recording and live updates

Proxy callbacks enqueue immutable snapshots without disk I/O. One writer coalesces snapshots by flow ID and flushes every 500 ms. The queue is bounded to 64 entries and approximately 32 MiB of payload. When saturated, recording updates are dropped while network forwarding continues; the UI reports the drop count. Unflushed snapshots remain available through the detail API. Explicit deletion and flushing share disk ownership so a late body callback cannot recreate a cleared record. Normal shutdown drains the writer; a forced kill or crash can still lose pending updates.

Authenticated long polling publishes only a revision and batches changes over 50 ms. The desktop refreshes its selected page on changes, retaining status polling as a restart fallback. This avoids introducing another frontend event bus or exposing the API token to browser-only callers.

## Inspector copying and replay

Each request and response inspector has a copy action at the right of its tab bar. It copies only the active tab: headers, decoded query parameters, cookies, text, formatted JSON, or raw content. If clipboard access is unavailable, a selectable text dialog provides a manual fallback.

Replay is available from request details and always requires confirmation because the original credentials and body can repeat a state-changing operation. The replay window allows editing URL query parameters and UTF-8 text bodies without changing the original capture, and displays the response in the same window. Binary bodies keep their original bytes. The desktop backend sends the saved or explicitly edited bytes once through the local capture proxy, verifies TLS using the local CA, and disables redirects and automatic retries. HTTP error statuses are reported as returned by the server. Incomplete, truncated, older captures without completion metadata, CONNECT tunnels, and protocol upgrades cannot be replayed. Capture the request again to obtain replayable completion metadata. The replayed request is recorded only if the current capture settings and rules match it.

## Clash Verge integration

The desktop Capture page uses the generated Tauri IPC contract in `src-tauri/src/ipc.rs`. The Rust controller owns the child process, authenticated management calls, certificate export, request replay, and system-proxy routing. The frontend session hook serializes mutations and discards obsolete snapshots.

Install the Go version declared in `go.mod`, alongside the repository's Node.js and Rust toolchains. From the repository root, the normal prebuild also compiles this sidecar for the requested target:

```sh
pnpm install --frozen-lockfile
pnpm prebuild aarch64-apple-darwin
pnpm build
```

For sidecar-only development:

```sh
node scripts/capture-sidecar.mjs aarch64-apple-darwin
cd sidecars/clash-capture
go test -race ./...
```

The binary is generated under `src-tauri/sidecar` and bundled by Tauri; it is not committed. Runtime CA keys, API tokens, settings, and captured traffic belong in the application data directory and must not be added to the repository. Close other Clash Verge instances before running this build because they share the application identifier and configuration directory.
