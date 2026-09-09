# Privacy Policy

**Applies to:** the Clash Verge Rev desktop application for Windows, macOS and
Linux, distributed from
<https://github.com/clash-verge-rev/clash-verge-rev/releases>.

**Last updated:** 2026-09-09

Clash Verge Rev is a free and open-source graphical client for the
[mihomo](https://github.com/MetaCubeX/mihomo) proxy core, maintained by
volunteers. The project has no company behind it, no user accounts, and no
server of its own that the application talks to.

## 1. Summary

- The project **collects nothing**. There is no telemetry, no analytics, no
  crash or usage reporting, no advertising or tracking SDK, and no registration.
  No data of any kind is sent to the maintainers or to infrastructure operated
  by this project.
- Your configuration, credentials and logs are stored **only on your own
  device**, in plain files you can read, back up or delete at any time
  (Section 3).
- The application connects only to endpoints that you configure (proxy servers,
  subscription URLs, backup server) or to the third-party services listed in
  Section 4. None of them are operated by this project.
- Two connections are enabled by default and are not part of your own proxy
  configuration: the **application update check** (Section 4.3) and the **IP
  information card** on the Home page (Section 4.5). Both are described below,
  and Section 6 explains how to turn them off.

## 2. Who is responsible

The Clash Verge Rev maintainers, reachable through the project's issue tracker
at <https://github.com/clash-verge-rev/clash-verge-rev/issues>. Because the
application performs no data collection, there is no data controller
relationship, no processing agreement, and no data to request or erase from us.

## 3. Data stored on your device

All application data lives in a single directory:

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\io.github.clash-verge-rev.clash-verge-rev` |
| macOS | `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev` |
| Linux | `$XDG_DATA_HOME/io.github.clash-verge-rev.clash-verge-rev` (usually `~/.local/share/…`) |

It contains:

- `verge.yaml` — application settings. If you configure WebDAV backup, the
  server URL, user name and password are stored here **in plain text**.
- `config.yaml`, `profiles.yaml` and `profiles/` — your proxy configuration and
  downloaded subscriptions. These normally contain **subscription URLs (which
  often embed a personal token), proxy server addresses, ports, passwords and
  UUIDs**.
- `logs/` and `service-logs/` — application and privileged-service logs. Core
  logs can contain requested domain names, IP addresses and connection metadata,
  depending on the log level you select.
- Core runtime files (for example mihomo's `cache.db` and GeoIP/GeoSite
  databases) used by the proxy core.

None of this leaves your device unless you enable WebDAV backup (Section 4.9),
export a backup yourself, or attach these files to a bug report.

Application logs are deleted automatically after a retention period you choose
in *Settings → Miscellaneous → Auto Log Clean* (default: 7 days; `Never Clean` keeps
them indefinitely). Uninstalling the application and removing the directory
above deletes everything else.

**When reporting a bug**, review logs and configuration before attaching them:
they may reveal your proxy servers, subscription tokens and browsing
destinations.

## 4. Network connections the application makes

### 4.1 Proxy traffic

Traffic you route through the application is handled by the bundled mihomo core
and goes to the proxy servers **you** configured. It is not inspected, recorded
or forwarded anywhere by this project. Your proxy provider can see this traffic
to the extent any proxy operator can; their privacy policy applies.

### 4.2 Subscription (profile) updates

When you add a remote profile, the application downloads it from the URL you
supplied, sending a `User-Agent` of `clash-verge/v<version>` unless you set a
different one for that profile. If you enable automatic updates for a profile,
this request repeats on the interval you choose. The subscription provider sees
your IP address and this request; it is the same request your browser would
make. Requests can be sent directly, through the system proxy, or through the
application's own proxy port, as configured per profile.

### 4.3 Application update check — *enabled by default*

On startup the application asks whether a newer release exists, in order, from:

- `https://update.hwdns.net/…` and `https://gh-proxy.org/…` (third-party GitHub
  mirrors, used for reachability in restricted networks)
- `https://github.com/clash-verge-rev/clash-verge-rev/releases/…`

The request carries only what any HTTP request carries: your IP address, the
`User-Agent` and the requested file. No identifier is generated or sent, and no
result is reported back to the project. Downloaded updates are verified against
a Minisign public key compiled into the application.

Disable it in *Settings → Miscellaneous → Auto Check Update*.

### 4.4 Proxy core update — *user-initiated*

Updating the mihomo core downloads it from GitHub Releases
(`https://github.com/MetaCubeX/mihomo/releases/…`) only when you start the
update.

### 4.5 IP information card — *enabled by default*

The Home page shows your apparent public IP address and its geolocation. To do
this it queries one randomly chosen service from:
`api.ip.sb`, `ipapi.co`, `api.ipapi.is`, `ipwho.is`, `ip.api.skk.moe`,
`get.geojs.io`. The query is refreshed about every 5 minutes while the card is
visible and the window is shown; it is not sent while the window is hidden or
the Home page is not in view.

By design these services see and return the IP address the request came from —
that is the feature. If a proxy is active, they see the proxy's address.
Each service is operated by an independent third party under its own privacy
policy; the project has no agreement with any of them. Keep the Home page
closed (or the application minimised) if you do not want these requests.

### 4.6 Latency tests — *user-initiated*

Testing a proxy or group sends an HTTP request through that proxy to
`http://cp.cloudflare.com/generate_204`, or to the test URL you configure.

### 4.7 Streaming availability test — *user-initiated*

The unlock test sends requests through your local proxy port to the streaming
and AI services being tested (Netflix, Disney+, YouTube, Spotify, OpenAI and
similar). It runs only when you start it, and only through the proxy you have
selected.

### 4.8 DNS

The generated core configuration uses public DoH resolvers by default
(`doh.pub`, `dns.alidns.com`), and your proxy configuration may define others.
Resolvers see the domain names being resolved. You can change or replace them in
the DNS settings and in your own configuration.

### 4.9 WebDAV backup — *disabled until you configure it*

If you set up backup, the application uploads a ZIP archive to the WebDAV server
you specify. The archive contains your profiles, `profiles.yaml`, `config.yaml`,
the DNS configuration and `verge.yaml`; **WebDAV credentials are stripped from
`verge.yaml` before upload, but proxy servers, passwords and subscription URLs
inside your profiles are not**. Treat a backup as sensitive and use a server you
trust. Backups are only transferred to that server.

### 4.10 Local listeners

The proxy ports and the internal control port bind to `127.0.0.1` only. They are
not exposed to your network unless you deliberately configure the core to allow
LAN access.

## 5. Third-party components and services

The application bundles or depends on software with its own behaviour and
policies:

- **mihomo (Clash.Meta) core** — <https://github.com/MetaCubeX/mihomo>.
  Performs the actual proxying and DNS resolution.
- **Tauri and the system WebView** — the user interface renders in the
  operating system's web engine: Microsoft Edge WebView2 on Windows (subject to
  the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)),
  WKWebView on macOS, WebKitGTK on Linux.
- **External dashboards** — opening a web dashboard (metacubexd, Yacd, Zash
  Board) loads a third-party site in your browser; it then talks to your local
  core.
- **GitHub** — hosts the source, releases and update metadata; it sees download
  requests, and anything you post in issues is public.
- **Your proxy and subscription providers**, and any WebDAV or DNS provider you
  configure, are independent of this project and govern their own data handling.

## 6. Your controls

- *Settings → Miscellaneous → Auto Check Update* — turn off the update check.
- *Settings → Miscellaneous → Auto Log Clean* — set log retention, or `Never Clean`.
- Per-profile update interval — turn off automatic subscription refresh.
- WebDAV backup is inactive until you enter server details, and can be cleared
  at any time.
- The IP information card only queries while the Home page is visible
  (Section 4.5).
- Everything else is a plain file on your disk: delete the application data
  directory to remove all stored data.

## 7. Children

The application is a network tool with no content directed at children and no
data collection of any kind.

## 8. Changes

Changes to this policy are made in the repository and are visible in its Git
history. The date at the top reflects the most recent change.

## 9. Contact

Open an issue at
<https://github.com/clash-verge-rev/clash-verge-rev/issues>. Please do not
include logs or configuration files containing credentials in public issues.
