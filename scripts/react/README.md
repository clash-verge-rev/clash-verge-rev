# React diagnostics

`pnpm dev:profile` runs the usual development launcher with a root React
Profiler. In WebView DevTools, `window.__CVR_REACT_PROFILER__.read()` returns
copies of the latest 1,000 standard Profiler callback records; `.clear()` drops
them. Records contain timing and commit metadata, never business props. Normal
development and production builds do not load the collector.

`pnpm dev:wdyr` instead initializes why-did-you-render before loading the app
and uses its development JSX runtime. It reports avoidable renders for
`ProxyItem`, `ProxyItemMini` and `ProxyTunCard` in the console. The modes are
mutually exclusive; `CVR_REACT_DIAGNOSTICS` accepts only `profiler` or `wdyr` on
the development server. Each mode uses its own Vite cache. Production builds
ignore this variable and include neither diagnostic entry nor runtime.

Install the browser explicitly with `pnpm exec playwright install chromium`.
Then run `pnpm react:ab --base <ref> --head <ref>`. Both Git trees run against
one installed dependency set and the same fixed DNS, delay-hook and proxy-tab
fixtures. The command never installs a browser or changes either checkout.
It retains source hashes, dependency identity, browser/environment information,
behavior assertions, render observations and profiles under `/tmp/cvr-react-ab-*`.
Each version and mode has separate Vite caches and output. Three pairs alternate
order in ordinary development, Strict Mode and production. A behavior failure
returns a nonzero exit status. DNS stale serialization and same-value renders
are observations so a known baseline can be compared with its fix.

The fixtures execute the actual selected components and hook. IPC, data,
editor and UI rendering boundaries are replaced, and outgoing network requests
are rejected. DNS serialization is observed at `js-yaml.dump`; tab execution is
observed at the Material Paper boundary. These are component results, not native
Tauri integration, real DNS/proxy/TUN writes, or whole-application CPU/RSS gains.
Production React does not emit Profiler callbacks. Timing is diagnostic and has
no hard acceptance threshold; measure native release CPU/RSS separately and
calibrate A/A before claiming a performance gain. Keep raw reports out of Git.
