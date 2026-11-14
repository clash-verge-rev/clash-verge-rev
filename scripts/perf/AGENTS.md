# Performance Harness Agent Guidelines

Use [GUIDE.md](GUIDE.md) for the explicit external tool invocation and adapter
boundary; the tool README owns scenario operation and evidence interpretation. This file governs harness changes under the repository rules.

## Isolation And Evidence

Keep measurement code behind the explicit perf build gates and out of ordinary
builds. Never touch the daily instance, configuration, Core, Service, TUN, DNS, or
system proxy. Preserve loopback isolation, owned-process PID/start attribution,
nonactivation, visibility/occlusion checks, source continuity, and failure rejection.
Do not weaken acceptance gates to make a run pass or substitute Chrome/Vite for
native WebView evidence. Label adapters separately from native plugin/IPC paths.
Preserve source, dependency, binary, and report identity. Measurement-contract
changes require a schema bump and new reports.

## Adaptation And Validation

Reuse the runner, driver, fixtures, Worker/components, attribution, and cleanup.
Add only the scenario fixture and validation needed for the requested boundary.
Before expanding a scenario or running a comparison matrix, verify the smallest
native path: isolated startup, owned WebContent attribution, expected data delivery,
native visibility and nonactivation, and owned shutdown. Validate prerequisites
normally supplied by the application entry. Expand only after this path passes,
and repeat affected checks when its dependencies change.

For implementation changes, run scoped ESLint, both perf TypeScript projects,
the external tool’s `node --test report.test.mjs`, formatting, and relevant production checks.
Run scoped Rust Clippy before freezing the optimized artifact; follow the external
README validation order. Runtime or measurement
changes also need affected-layer native three-phase smoke, three independent runs,
A/A, invalid/incomparable reports, and injected-failure cleanup. Verify ordinary
build exclusion and daily-instance isolation. For documentation-only or demonstrated
no-op changes, use proportionate checks and explain why native reruns add no
coverage; do not claim previously measured results as fresh validation.

## Delivery And Cleanup

Temporary investigation additions do not belong in a product-fix commit unless
harness maintenance is explicitly authorized. Existing user authorization suffices;
do not require renewed approval at delivery. Keep reports and manifests on ignored
paths. Retain failed evidence through diagnosis, then honor requested cleanup only
for task-owned paths using the ownership safeguards described in the guide.
