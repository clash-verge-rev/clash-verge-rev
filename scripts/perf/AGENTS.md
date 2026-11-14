# Product Measurement Adapter Guidelines

[GUIDE.md](GUIDE.md) owns the explicit external-tool invocation and the product
adapter boundary. Tool implementation rules live in the external
[AGENTS.md](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/AGENTS.md);
its [README](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/README.md)
owns running, sampling, report interpretation, comparison and owned cleanup.

## Adapter Boundary And Isolation

Keep real product component imports, initialization and the isolated native entry
in this checkout. Reuse the product's frontend/native build dependencies and
environment; the tool owns its automation dependencies. Do not copy components
into the tool. Keep measurement code behind the explicit perf build gates. Ordinary product builds must not load or require the external tool.

The adapter must not load or modify daily configuration or start/control the daily
app, Core, Service, TUN, DNS or system proxy. Preserve loopback isolation, owned-process
PID/start attribution, nonactivation, visibility/occlusion checks and source
continuity. The tool owns read-only isolation snapshots and owned cleanup.
Do not weaken acceptance gates or substitute Chrome/Vite for native WebView evidence.
Label JavaScript adapters separately from native plugin/IPC paths.

Adapter changes require reviewing the actual source diff, including native entry,
initialization and build configuration, for changed measurement meaning. Matching
interfaces alone do not prove equivalence. Preserve source, dependency and binary
identity; coordinate measurement-contract changes with the external tool's schema
and fresh reports. An adapter review cannot waive other acceptance conditions.

## Validation

For adapter implementation changes, run scoped ESLint, both perf TypeScript projects
(`tsconfig.json` and `tsconfig.node.json`), formatting and relevant production
checks, including relevant Rust checks for native changes. Run scoped Rust Clippy
before freezing the optimized artifact. Check ordinary-build exclusion and
prerequisites normally supplied by the application entry.

Follow the external AGENTS.md's
[measurement-validation requirements](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/AGENTS.md)
and the README's
[validation order](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/README.md#validate-before-freezing-a-build)
for affected native coverage, from the smallest native path through comparison and
failure cleanup. Keep the tested source and binary fixed. Documentation-only or
demonstrated no-op changes need proportionate checks; explain evidence reuse and
do not present previous native results as fresh validation.
