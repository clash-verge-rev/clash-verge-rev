# Product measurement adapter

The reusable runner, collector, reports, comparator and owned-artifact cleanup
live in the separate `clash-verge-rev-harness` checkout. Its `README.md` owns the
operating guide and scenario/evidence boundaries. Pass both roots explicitly:

```sh
project=/absolute/path/to/clash-verge-rev
harness=/absolute/path/to/clash-verge-rev-harness
node "$harness/build.mjs" --project "$project" --output target/perf/build
caffeinate -di node "$harness/run.mjs" --project "$project" --binary target/perf/build/clash-verge --output target/perf/smoke --repeat 1 --seconds 5 --warmup 2
node "$harness/compare.mjs" "$project/target/perf/smoke" "$project/target/perf/smoke"
```

`--project` must be an absolute checkout path. Relative binary/output paths resolve
inside it. Outputs must be new directories below ignored `target/perf` and carry
ownership markers; the external tool's cleanup command accepts exact marked paths.
Dirty candidates are supported without commits or a dedicated hash lock.

This directory owns the isolated native entry, real Traffic/Logs/Connections
imports, initialization, JavaScript socket adapter, replay receiver and minimal DOM
layer. These evolve with product APIs. Keep product React/Tauri/Wry versions and
the explicit `perf-harness`/Vite perf gates; ordinary builds need no external tool.
No daily configuration, Core, Service, TUN, DNS or system proxy is loaded.

Changes to these adapters require reviewing whether measurement meaning changes.
The external comparator rejects changed adapter identities until an explicit
source-equivalence review is supplied; all other comparability gates remain in
force. DOM mutation/text hashes show view-input delivery, not painting or cache
ownership, and JavaScript socket replacement does not measure native plugin IPC.

The optional external `--display virtual` mode owns a temporary private macOS
virtual display; physical mode remains the default. This adapter positions only
the hidden measurement window on its exact NSScreen, preserves nonactivation,
checks complete visibleFrame containment and mode/Space flags, and exits on drift.
The tool owns helper identity, lifecycle and independent topology-restoration
checks. See its README before running either mode; do not reuse an experiment's
helper or alter existing displays.

`scripts/perf/isolation.json` owns the configuration and process watch scope for
the tool's command-boundary isolation snapshots. Keep it aligned with product
data directories and executable names. The tool records hashes/metadata only,
never restores user state, and rejects changed or unavailable observations.
Expected startup errors are reported and exit nonzero through the owned app's
normal exit path; they must not escape the Tauri setup hook as a panic.
