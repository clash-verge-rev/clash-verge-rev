# Product Measurement Adapter Guidelines

[GUIDE.md](GUIDE.md) defines the product adapter boundary and explicit tool invocation.
Keep real component imports, initialization and the isolated native entry here,
using product frontend/native build dependencies. Do not copy components into the
tool. Preserve perf build gates; ordinary builds must not require the external tool.

The adapter must not load or modify daily configuration or control the daily app,
Core, Service, TUN, DNS or system proxy. Preserve loopback isolation, owned-process
PID/start attribution, nonactivation, visibility/occlusion and source continuity.
Do not weaken gates or substitute Chrome/Vite for native WebView evidence. Label
JavaScript adapters separately from native plugin/IPC paths. Expected startup errors
must use the owned app's normal nonzero exit, never panic through Tauri setup.

Review adapter source changes, including initialization and native/build configuration,
for changed measurement meaning. Matching interfaces alone do not prove equivalence;
an adapter review cannot waive other acceptance conditions.

For implementation changes, run scoped ESLint, both perf TypeScript projects
(`tsconfig.json` and `tsconfig.node.json`), formatting and relevant production checks,
including Rust checks for native changes. Run scoped Rust Clippy before freezing
the optimized artifact. Check ordinary-build exclusion and application-entry prerequisites.

Follow the external AGENTS.md's
[measurement-validation requirements](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/AGENTS.md)
and README's
[validation order](https://github.com/clash-verge-rev/clash-verge-rev-harness/blob/main/README.md#validate-before-freezing-a-build).
These govern affected native coverage, comparison, failure cleanup and evidence reuse.
