# CONTRIBUTING

Thank you for your interest in contributing to **Clash Verge Rev**! This guide provides instructions to help you set up your development environment and start contributing effectively.

## Internationalization (i18n)

We welcome translations and improvements to existing locales. For details on contributing translations, please see [CONTRIBUTING_i18n.md](docs/CONTRIBUTING_i18n.md).

## Contribution Expectations

We welcome AI-assisted contributions — AI assistance itself is not a problem. What we require is **ownership**: every pull request must show that the stated problem is understood and that the change deliberately solves it. Incoming pull requests from contributors without write access are screened by an automated review ([`pr-ai-slop-review`](.github/workflows/pr-ai-slop-review.md)) that evaluates this ownership evidence and may label high-risk submissions `ai-slop:med` or `ai-slop:high`. The policy is maintained in that file and compiled into `pr-ai-slop-review.lock.yml` (`gh aw compile`); never edit the lock file by hand. If you want to adjust the review policy, the easiest path is directing an AI coding agent to make the change — the workflow is documented in [AGENTS.md](AGENTS.md).

To make sure your contribution is assessed fairly:

- **Link a pre-existing issue.** Product bug fixes and features require one; self-scoped maintenance does not. Follow the [PR template](.github/PULL_REQUEST_TEMPLATE.md) for scope, linkage, and revert references. If a required issue is missing, ask maintainers to open or approve one before implementing. Use maintainer-approved private tracking for security-sensitive fixes that cannot be reported publicly.
- **Keep the diff mapped to the scope.** Every changed area should be explainable from the linked issue or stated maintenance scope. Unrelated refactors, formatting churn, or dependency bumps belong in separate pull requests with their own motivation.
- **Describe the problem in your own words.** A short statement of what breaks or what is needed, and why this approach fixes it, is worth more than a long generated report.
- **Validate against the reported behavior.** Show how the reported problem was reproduced and confirmed fixed. Generic checklists and raw tool output are not verification.
- **Do not pad with tests or defensive code.** New tests are not expected by default. Add a minimal test when the issue or task requires it, it reproduces the reported regression, or it guards behavior whose breakage would otherwise go unnoticed. Explain why it is needed; speculative error handling and coverage of hypothetical failure modes inflate the diff without adding value.
- **Disclose AI automation.** If an AI agent produced or co-produced the change, end the pull request body with the model and effort level (for example, `Assisted by: GPT-5.6 High`; effort is optional when your tool does not report it). The PR template intentionally omits this footer; agents add it themselves. Disclosure is transparency only — it does not affect how the change is assessed.

If your pull request receives an `ai-slop` label, the fastest way to clear it is substantive: link (or ask us to create) the underlying issue, narrow the scope, or push implementation changes that respond to review feedback. Editing the pull request description alone does not change the assessment.

## Development Setup

Before contributing, you need to set up your development environment. Follow the steps below carefully.

### Prerequisites

1. **Install Rust and Node.js**  
   Follow the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your operating system. Use the Node.js version in [`.tool-versions`](.tool-versions); [`rust-toolchain.toml`](rust-toolchain.toml) selects the Rust version and required components when you run Cargo from this repository.

### Windows Users

> [!NOTE]  
> **Windows ARM users must also install [LLVM](https://github.com/llvm/llvm-project/releases) (including clang) and set the corresponding environment variables.**  
> The `ring` crate depends on `clang` when building on Windows ARM.

Additional steps for Windows:

- Ensure Rust and Node.js are added to your system `PATH`.

- Install the GNU `patch` tool.

- Use the MSVC toolchain for Rust:

```bash
rustup target add x86_64-pc-windows-msvc
rustup set default-host x86_64-pc-windows-msvc
```

### Install Node.js Package Manager

[Corepack is no longer bundled with Node.js starting with Node.js 25](https://nodejs.org/api/corepack.html). Install it globally if it is not already available, then enable it:

```bash
npm install --global corepack
corepack enable
```

Run pnpm from this repository so Corepack selects the version pinned by `packageManager` in [`package.json`](package.json).

### Install Project Dependencies

Node.js dependencies:

```bash
pnpm install --frozen-lockfile
```

Ubuntu-only system packages:

```bash
sudo apt-get install -y libxslt1.1 libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

### Download the Mihomo Core Binary (Automatic)

```bash
pnpm run prebuild
pnpm run prebuild --force  # Re-download and overwrite Mihomo core and service binaries
```

### Prepare the Development Service Source

`pnpm dev` builds the development service from a sibling checkout of [`clash-verge-service-ipc`](https://github.com/clash-verge-rev/clash-verge-service-ipc). The binaries downloaded by `pnpm prebuild` do not replace this source checkout.

Check the `clash_verge_service_ipc` dependency in [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml), then clone the service repository alongside `clash-verge-rev` and check out the matching tag. If the sibling directory already exists, reuse it and check its version rather than overwriting it. Without this checkout, `pnpm dev` fails when it tries to access `../clash-verge-service-ipc/Cargo.toml`.

### Run the Development Server

Run these commands from the root of `clash-verge-rev`:

```bash
pnpm dev           # Build the development service and start the desktop app
pnpm dev:diff      # Alias of pnpm dev
pnpm dev:tauri     # Run Tauri directly with the tauri-dev feature
```

For frontend-only development, use `pnpm web:dev`. It does not start the Rust backend or build the development service.

### Build the Project

Standard build:

```bash
pnpm build
```

Fast build for testing:

```bash
pnpm build:fast
```

### Clean Build

```bash
pnpm clean
```

### Portable Version (Windows Only)

```bash
pnpm portable
```

## Contributing Your Changes

### Development Workflow

Scale the work to the change. A wording fix needs a focused diff check; a change
to configuration persistence, asynchronous state, or system networking needs
evidence for the affected behavior.

1. **Define the outcome.** Identify the triggering action, relevant platform and
   configuration, and actual versus expected behavior. For a bug fix, separate
   the reported symptom from the suspected cause. State what remains unknown.
2. **Trace the affected path.** Read the relevant callers, state owners, and
   failure paths before editing. Follow the module rules in
   [src/AGENTS.md](src/AGENTS.md) or [src-tauri/AGENTS.md](src-tauri/AGENTS.md)
   where applicable. Choose a reproduction or observable check that can
   distinguish the old behavior from the intended result.
3. **Make the smallest complete change.** Address the confirmed cause and its
   affected instances within scope. Keep unrelated cleanup separate. Add a test
   only when justified by the contribution expectations above.
4. **Verify the result.** Use the checks below that cover the changed behavior.
   If reproduction is unavailable, explain the alternative evidence and its
   limits rather than claiming the reported problem is confirmed fixed.
5. **Review and resolve findings.** Follow [REVIEW.md](REVIEW.md). For changes
   altering concurrency, persistence, system networking, or shared-contract behavior,
   seek an independent review with fresh context. Check each finding against
   the code before changing it; return fixes to the implementer when working
   with a separate reviewer.

### Choosing Validation

Use existing checks appropriate to the affected paths; this is not a requirement
to run every command for every change. Run commands from the repository root.

| Changed behavior | Relevant checks and evidence |
| --- | --- |
| Frontend logic or state | `pnpm lint`, `pnpm typecheck`, and existing focused tests via `pnpm test <path>`; exercise the affected user interaction. |
| Rust logic | `cargo clippy-all`, relevant Cargo tests, and the affected failure or recovery path. Platform-specific branches require checks on those platforms. |
| IPC or event contracts | `pnpm gen:contract --check`, frontend type checking, and inspection of both producers and consumers. |
| UI or native integration | Exercise the changed flow; use a screenshot for visual changes and the native app for window, Service/Core, DNS, or system-proxy behavior. |
| Documentation | Check wording, relative links, referenced commands, and consistency with the authoritative rule or implementation. |

Tie results to the code reviewed: identify the base/head commits for branch
comparisons and include task-relevant staged, unstaged, and untracked files in a
local review. Report
the command or interaction, observed result, and material gaps in the existing
conversation or PR; no separate verification report is required. Static checks,
mocks, browser previews, native runs, and remote CI establish different things.
When code changes after verification, repeat affected checks. Attribute a failure
to the baseline only after comparing the same check on the base revision.

### Before Committing

Run the applicable checks from the validation guidance above. After formatting
or generation, inspect the final diff and stage only the intended changes.

**Code quality checks:**

```bash
# Rust backend
cargo clippy-all
# Frontend
pnpm lint
```

**Code formatting:**

```bash
# Rust backend
cargo fmt
# Frontend
pnpm format
```

### Signing your commit

Signed commits are required to verify authorship and ensure your contributions can be merged. Reference signing-commits [here](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

### Submitting Your Changes

1. Fork the repository.

2. Create a new branch for your feature or bug fix.

3. Commit your changes with clear messages and make sure it's signed.

4. Push your branch and submit a pull request.

We appreciate your contributions and look forward to your participation!
