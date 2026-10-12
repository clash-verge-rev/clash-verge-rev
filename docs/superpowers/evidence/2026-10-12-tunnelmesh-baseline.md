# TunnelMesh / Clash Verge interoperability baseline

Captured: 2026-10-12 (local macOS workstation)

## Running processes and listeners

Process inspection was limited to process names and PIDs. Socket inspection was limited to listener address, port, and transport protocol.

| Process | PID | Listener | Transport / observed role |
|---|---:|---|---|
| `tunnelmesh-client-tray` | 5378 | `127.0.0.1:53700` | TCP; local control/UI endpoint (HTTP probe returned 200) |
| `tunnelmesh-client-tray` | 5378 | `127.0.0.1:18081` | TCP; configured tunnel listener (SOCKS5 probe target) |
| `clash-verge` | 15267 | `127.0.0.1:49493` | TCP; desktop application listener |
| `verge-mihomo` | 15273 | `127.0.0.1:7897` | TCP; Clash mixed proxy listener |

## Existing local SOCKS5 probe

- Listener: `127.0.0.1:18081`
- Target fixture: `www.baidu.com:443`
- Negotiated protocol: SOCKS5 hostname mode through the configured listener.
- Result: **success** (`curl` HTTP status 200).
- A plain HTTP request to the same port was reset, consistent with a non-HTTP proxy listener.

Repeatable smoke probe (does not send credentials):

```sh
curl --proxy socks5h://127.0.0.1:18081 \
  --connect-timeout 2 --max-time 4 \
  -sS -o /dev/null \
  -w 'exit=%{exitcode} http=%{http_code} remote=%{remote_ip}\\n' \
  http://example.com/
```

## Redacted TunnelMesh configuration contract

Source: `~/.config/tunnelmesh/client.yaml` (values copied as shape only; secrets redacted).

```yaml
mode: local
client:
  server_url: wss://tunnelmesh.claw.qihoo.net/ws/client
  token: <redacted>
  tunnels:
    - name: sk-inner-360
      protocol: socks5
      listen: 127.0.0.1:18081
      agent_id: <redacted>
      auth_mode: none
```

The `client.token` key is present. Secret-bearing values are represented by `<redacted>`.

## Notes for integration

The configured TunnelMesh SOCKS5 endpoint is present as a local TCP listener and successfully forwarded the follow-up HTTPS probe. The Clash Verge mixed proxy remains on `127.0.0.1:7897`; no changes were made to either application.
