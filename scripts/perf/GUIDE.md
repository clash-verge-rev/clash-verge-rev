# macOS Traffic Performance Harness

This guide is the operating and maintenance contract for humans and coding agents.
The only scenario is the production home traffic graph in a dedicated, optimized
Tauri WKWebView. It measures foreground updates, native hide, then restoration.
It does not initialize the complete homepage or run Mihomo, Service or networking.

## Build And Run

Use this repository's pnpm, Rust and Xcode Command Line Tools on macOS. No global
WebDriver installation is needed. Keep each binary beside its generated manifest.

```sh
pnpm install --frozen-lockfile
pnpm perf:build target/perf/baseline-build
caffeinate -di pnpm perf:run -- --binary target/perf/baseline-build/clash-verge --output target/perf/baseline --repeat 3 --seconds 20 --warmup 10
pnpm perf:compare -- target/perf/baseline target/perf/baseline
pnpm perf:test
```

`perf:build [directory]` uses release optimization, Vite `--mode perf` and the
explicit Cargo `perf-harness` feature. It preserves the binary and records HEAD,
dirty state, compiled source, lockfile, frontend, build-settings and binary hashes.
Source changes during compilation reject the manifest. Each run also hashes the
external collector and runner. Ordinary builds exclude the driver and measurement
entry; debug assertions are not the gate. Do not edit compiled inputs during builds.

Output directories must be new and Git ignored; use `target/perf/`. JSON/CSV keep
raw process samples, observations, phase markers, attribution and cleanup evidence.
`summary.json` and `report.md` provide distributions by independent run, phase and
process role. Failed runs exit nonzero and retain their evidence. The explicit
`traffic-webview-v3` schema rejects older reports instead of silently migrating them.

## Isolation And Visibility

The dedicated measurement main bypasses normal initialization and shutdown. It
does not read or write daily configuration, subscriptions, proxy, TUN or Service.
It uses a distinct app identity and incognito WebView. Both automatic services
bind loopback and are owned by the current run; never kill processes by name.

The measurement window stays above ordinary windows and covers part of the screen,
without activation or mouse capture: clicks pass through to the application behind it.
Native topmost and click-through states are verified, while native focus and application
activation must remain false. WebDriver uses the embedded WebView directly; DOM focus
is recorded but not required. Daily windows are unchanged; the topmost window exits
with its owned measurement instance. You may keep using another application.
The console must be unlocked. Lock state is checked before startup and recorded
at phase boundaries; unknown state fails and observed drift rejects comparison.
Boundary checks do not provide continuous lock monitoring or unlock the computer.

No focus does not mean no visibility: shown stages require `document.hidden=false`,
fresh Worker data, advancing Canvas draw timestamps and changed Canvas pixels.
Topmost placement avoids ordinary-window occlusion; system overlays or another Space
can still pause WebKit. Such a run fails; do not weaken Canvas assertions to make it
pass. `caffeinate -di` lasts only for the command and cannot prevent deliberate lock.
Hidden stages still require continuous input and Worker data.

## Fixed Workload

The native window is 1000 x 700 logical pixels. Verify driver dimensions against
DPR and record the actual CSS viewport; titlebar space is excluded. The graph is
920 x 360 with a ten-minute range, default bezier style and real data retention.
The measurement preload sets blur pause false without changing production defaults.

Deterministic loopback WebSocket replay enters the public traffic append boundary,
then the production Worker and Canvas. It does not cover Mihomo or network traffic.
There is no history prefill. Absolute 200 ms deadlines sustain 5 Hz without cumulative
timer drift or catch-up bursts; missing a complete period fails the source.
Warmup is at least the requested duration with a five-second readiness allowance.
Fixed input anchors reserve two seconds for each native transition; measured stages
retain their full duration. Readiness uses observable state and deadlines, not sleep.
Before the first show, wait for actual replay input and Worker data so the graph's
visibility listeners are installed; then require fresh Canvas output after showing.
Total replay, including allowances, must remain below ten minutes for raw history.
Two-input endpoint variation is 400 ms; larger differences reject comparison.

Worker snapshots are asynchronous. Count/latest-value checks verify deterministic
upload/download values at the retained point count, with a joint period of 60 and
received-minus-retained count below 60. This detects net missing/duplicate points,
not every historical element or exactly cancelling losses and duplicates.
Source age must be below 2500 ms, Worker age below 3500 ms and visible draw age below
2500 ms. Future timestamps, lost sequence, process changes and failed restore fail.

## Metrics And Comparison

The native command obtains the actual WKWebView process ID using the private
`_webProcessIdentifier` selector, with availability checking. External collection
verifies the canonical system WebContent executable and process start identity.
It handles PID reuse and exits; unsupported ownership fails closed. Main and WebView
remain separate. Mihomo is not started; shared GPU/network attribution is unavailable.

CPU is cumulative process time converted from Mach ticks; interval percentages use
adjacent valid samples, with one occupied core equal to 100%. The first difference
is unavailable. Memory is RSS bytes, not physical footprint or exclusive memory.
Reports include CPU mean/P50/P95/peak/seconds, RSS median/P95/peak/delta, sample count
and time coverage. Memory slope requires at least 60 seconds of continuous samples.
RSS growth is not proof of a leak; process statistics are not function profiles.
The embedded driver adds a 20 Hz macOS runloop timer and observation overhead.

For A/B, build the candidate separately and alternate independent instances:

```sh
pnpm perf:build target/perf/candidate-build
for i in 1 2 3; do
  caffeinate -di pnpm perf:run -- --binary target/perf/baseline-build/clash-verge --repeat 1 --output target/perf/ab-baseline/$i
  caffeinate -di pnpm perf:run -- --binary target/perf/candidate-build/clash-verge --repeat 1 --output target/perf/ab-candidate/$i
done
pnpm perf:compare -- target/perf/ab-baseline target/perf/ab-candidate
pnpm perf:run -- --binary target/perf/candidate-build/clash-verge --repeat 1 --seconds 5 --warmup 2 --fail-phase hidden --output target/perf/failed
```

Comparison accepts summary files, run directories or groups of run directories.
Build mode, toolchain, platform, host, power, WebKit, viewport and workload must match.
Invalid and incomparable reports exit 2. A/A remains inconclusive. A/B compares
independent-run summaries, not adjacent time samples. An optional third numeric
argument is a percentage floor justified by baseline noise; there is no universal
pass threshold. Fewer than three runs per group, overlapping ranges or differences
within either group's range remain inconclusive. Background load limits inference.

## Automation Delivery Boundary

When the operator is a coding agent, the final change keeps only the
performance-optimization code. Harness additions introduced during the
work — measurement entries, configs, scripts, reports, manifests — must
stay untracked by Git and out of every commit; keep them on ignored
paths or remove them before delivery. Commits remain minimal and
necessary for the optimization itself. Track or commit harness files
only when a human explicitly requests it at the end.

## Maintenance And Acceptance

Keep measurement code behind the explicit build gates. Reuse the existing driver,
Worker, graph, attribution and cleanup; do not add mock IPC or replace real WebView
acceptance with Chrome/Vite. Preserve source/binary/report hashes and every failed run.
After changes, run scoped ESLint, both perf TypeScript projects, `pnpm perf:test`,
format checks and relevant production checks. Verify a real three-phase smoke,
three independent runs, A/A, invalid/incomparable reports and injected-failure cleanup.
Verify ordinary builds exclude measurement code and daily instance state is intact.
Changes to contracts require a schema bump and new reports. Use bounded WebKit CPU
or Allocation/Heap captures for deeper diagnosis; do not infer hotspots from counters.
