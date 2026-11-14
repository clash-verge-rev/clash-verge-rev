# Product measurement adapter

This directory owns the isolated native entry, real Traffic/Logs/Connections
imports, initialization, JavaScript socket adapter, replay receiver and minimal DOM
layer. These evolve with product APIs and use the product's React/Tauri/Wry
versions. Keep the explicit perf build gates; ordinary builds need no external tool.

The external [clash-verge-rev-harness operating guide](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/README.md)
owns running, sampling, reports, comparison and owned cleanup. Follow its
[first setup and installation instructions](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/README.md#build-and-run),
reusing an existing checkout. For subsequent calls, pass both absolute roots:

```sh
project=/absolute/path/to/clash-verge-rev
harness=/absolute/path/to/clash-verge-rev-harness
node "$harness/build.mjs" --project "$project" --output target/perf/build
caffeinate -di node "$harness/run.mjs" --project "$project" --binary target/perf/build/clash-verge --output target/perf/smoke --repeat 1 --seconds 5 --warmup 2
node "$harness/compare.mjs" "$project/target/perf/smoke" "$project/target/perf/smoke"
```

JavaScript socket replacement does not measure native plugin IPC. DOM mutation/text
hashes show view-input delivery, not painting or cache ownership. Adapter changes
require reviewing measurement meaning under the external validation requirements.

For virtual display mode, this adapter places only the hidden measurement window
on the exact owned NSScreen, checks complete visibleFrame containment, mode/Space
flags and nonactivation, and exits on drift. The tool owns helper lifecycle and topology
restoration; see its
[virtual display guide](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/README.md#optional-virtual-display).

`isolation.json` owns the product configuration and process watch scope; keep it
aligned with product data directories and executable names. The tool owns
[command isolation snapshots](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/README.md#command-isolation-snapshots).
The adapter must not load daily configuration or control Core, Service, TUN, DNS
or system proxy.
