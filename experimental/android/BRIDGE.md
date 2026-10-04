# Verge Mobile host contract

The shared web UI is a mobile adaptation of Clash Verge Rev. The Android host owns profile storage, subscription download, the Mihomo engine, and VPN lifecycle. Never load a remote page into the privileged WebView.

`window.VergeNative.request(json)` accepts `{id: string, method: string, params: object}`. The host asynchronously calls `window.__vergeReceive({id, result})` or `window.__vergeReceive({id, error: string})` via its WebView controller. Validate method and parameters. Replies must use JSON serialization rather than string concatenation of user input.

Methods:

| Method | Parameters | Result |
| --- | --- | --- |
| `status` | `{}` | `{platform: "android", vpn: "stopped" or "connecting" or "running" or "error", coreReady: boolean, canTestDelay?: boolean, canChooseFile?: boolean, activeProfileId?: string, coreVersion?: string, mode?: "rule" or "global" or "direct", lastError?: string}` |
| `profiles.list` | `{}` | `[{id: string, name: string, active: boolean, updatedAt?: string, sourceHost?: string}]` |
| `profiles.import` | `{name: string, url?: string, content?: string}` | imported profile object; support YAML text or HTTPS subscription URL |
| `profiles.activate` | `{id: string}` | `null`; switch the engine's active profile, never falsely report success |
| `profiles.update` | `{id: string}` | `null`; only remote subscriptions can update |
| `vpn.start` | `{}` | `null`; ask OS permission if necessary, reject when engine/config is unavailable |
| `vpn.stop` | `{}` | `null` |
| `proxies.list` | `{}` | `[{name: string, type: string, now: string, all: [{name: string, type: string, delay?: number}]}]` |
| `proxies.select` | `{group: string, name: string}` | `null` |
| `proxies.delay` | `{name: string}` | `{delay: number}` |
| `settings.mode` | `{mode: "rule" or "global" or "direct"}` | `null` |
| `logs.list` | `{}` | `[{time: string, level: string, message: string}]`; bounded recent log list, subscription secrets masked |

Browser preview uses a separate local adapter: importing/storing YAML can work, but VPN and engine methods must explicitly report that a native mobile host is required. Do not return simulated running status or fake traffic.

UI assets live in `web/dist`. Copy them into the Android host's packaged local resources after each web build. The host must also support a payload string to `__vergeReceive` if their JavaScript proxy cannot pass structured objects.

## Design brief

Preserve Clash Verge Rev's clean blue-violet accent, neutral surfaces, rounded controls, and profile/proxy/log organization. Replace the desktop sidebar with a four-item bottom bar: Home, Proxies, Profiles, Settings. The Home primary control shows actual VPN state. A missing profile leads to import, an absent engine prevents start, and permission denial remains an explicit error. Dark mode follows the user's system and can be overridden locally. Use >=48 px touch targets, safe-area padding, readable long names and clear selected nodes. Logs are an in-app page reached from Home and Settings. Empty states must be useful without sample nodes or invented metrics.

## Scope

Experimental GPL-3.0 Android contribution, not an official upstream release. Mobile VPN services must be validated separately.
