---
name: agentic-workflows
description: Route gh-aw design, creation, diagnosis, patching, active debugging, upgrades, and local SDLC issue requests to the right strategies.
---

# Agentic Workflows Router

Use this skill when a user asks to design, create, update, debug, or upgrade GitHub Agentic Workflows in this repository, or prepare a substantial issue for a local, self-contained SDLC.

This skill is a dispatcher: identify the task type, load the matching workflow prompt/skill file, and follow it directly. Keep responses concise and ask a clarifying question if the correct prompt is unclear.

For debugging sessions needing CLI setup or run-URL scoping, first load
`https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/debug-bootstrap.md`; it bootstraps
the same shared strategy used by the debugging routes below.

Debugging, incident, health, and failure-related optimization requests use the
bootstrap's intent routing before generic update, upgrade, or optimization routes,
even when the CLI is installed. Preserve the supplied guidance repository/ref
for all debugging links and public raw fallbacks; URLs showing `main` below are
defaults only when no guidance revision is supplied. Reuse already-loaded guides.
The intent index is `.github/aw/debug-scenarios.md`; load only the selected
specialized route, not every debugging reference.

Repository overlay (optional):
- Load the target repository's `.github/aw/instructions.md`, if present, after the matched prompt/skill. Use `@.github/aw/instructions.md` only in a matching checkout; do not substitute a guidance-repository overlay.
- Precedence: repository overlay instructions override upstream defaults when they conflict.

## Load and route

Read only the files needed for the selected task.
Use a local guidance checkout only when its repository/ref matches the requested guidance; otherwise use the resolved guidance repository/ref (default `github/gh-aw`).
If GitHub API, `gh api`, or GitHub MCP downloads return HTTP 403 (including a token SAML-authorized for a different organization), do not retry with the same token. Fetch the public file without authentication from `https://raw.githubusercontent.com/github/gh-aw/main/<path>` instead, preserving its repository-relative path (including `.github/`). For example: `curl --fail --silent --show-error --location 'https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/create-agentic-workflow.md'`. Use the same fallback for referenced instructions and `SKILL.md` files; never send an Authorization header or token to the raw URL. If the public download fails, report that error rather than proceeding without the required instructions. This fallback is for public `github/gh-aw` content only, not private or enterprise repositories.
After loading the matching workflow prompt or skill, follow it directly:
- Design workflows from scratch via interview: `.github/aw/designer.md`
- Create new workflows: `.github/aw/create-agentic-workflow.md`
- Configure scheduled dreaming or consolidate persistent memory: `.github/aw/create-agentic-workflow.md`, then `.github/aw/memory.md#scheduled-dreaming`; load `.github/aw/dreaming.md` only when the decision and input scope justify implementation
- Configure or add declarative engines: `.github/aw/configure-agentic-engine.md`
- Consume, author, or document third-party connectors: `.github/aw/connectors.md`
- Create a new connector: `.github/aw/connectors.md#author-or-extend-a-declaration`, then the repository's `.github/skills/create-connector/SKILL.md` when available
- Update existing workflows: `.github/aw/update-agentic-workflow.md`
- Diagnose, patch, audit, or actively debug workflows: `.github/aw/debug-agentic-workflow.md` (local-first strategy, evidence triage and live gates)
- Analyze existing runs, logs, or recurring failures: `.github/aw/analyzing-runs.md`. General repository-wide debugging or optimization requests start here with failure clustering before selecting a workflow.
- AWF model/endpoint 400s, silent cross-family sub-agent failures, `model: auto` failures, install-step 404s after a version pin, or questions about version fields: go directly to `.github/aw/debug-agentic-workflow.md#model-and-engine-misconfiguration` before suggesting model changes.
- Upgrade workflows and fix deprecations: `.github/aw/upgrade-agentic-workflows.md`
- Create shared components or MCP wrappers: `.github/aw/create-shared-agentic-workflow.md`
- Create report-generating workflows: `.github/aw/report.md`
- Fix Dependabot manifest PRs: `.github/aw/dependabot.md`
- Analyze coverage workflows: `.github/aw/test-coverage.md`
- Render compact markdown charts: `.github/aw/asciicharts.md`
- Map CLI commands to MCP usage: `.github/aw/cli-commands.md`
- Choose workflow architecture and patterns: `.github/aw/patterns.md`
- Design, deploy, inspect or recover a Git-backed work queue: `.github/aw/work-queue.md`
- Optimize token usage and cost: `.github/aw/token-optimization.md`
- Advanced cost controls without native settings (custom AIC allowances by server size or shared organization budget policies): read `docs/src/content/docs/reference/cost-management.md#configure-advanced-cost-controls-with-admission` ([published guidance](https://github.github.com/gh-aw/reference/cost-management/#configure-advanced-cost-controls-with-admission)). Explain the external authority requirement and cooperative limits; do not invent frontmatter fields or promise hard caps, reservations, or mid-run cancellation.
- Design long-running multi-agent research workflows: `.github/aw/multi-agent-research.md`
- Add skills or agent plugins requested by the user (`skills:` / `plugins:` frontmatter, never on-the-fly installs): `.github/aw/skills.md`
- Local SDLC issue bootstrap: `.github/aw/squad.md`

When the task involves OTEL, OTLP, traces, observability backends, or telemetry-driven analysis, also read and follow `skills/otel-queries/SKILL.md` after loading the matching workflow prompt or skill.

When creating, updating, diagnosing or upgrading a workflow that uses `tools.work-queue`, also load `.github/aw/work-queue.md` after the primary prompt. Load deployment docs, operator reference or specification only when that task needs them.

For repository initialization or configuration involving third-party integrations,
use `.github/aw/connectors.md` and the selected editable declaration's
`import-schema` and `connector-documentation` metadata. Discover local declarations,
normal local/pinned imports and matching `*-golden.md` consumers; do not invent a
built-in provider catalog. Use `gh aw connector <id> setup --file PATH` for
phase-specific credential names/scopes and acquisition/renewal guidance.
Bind exact approved resources through `with`; secret NAMES only, never values.
Select reads/native methods and staged safe outputs independently. Importing must
not enable capabilities, write credentials, broad grants or live webhook ingress.
Derive network hosts from the selected contract, not provider-name guesses.
Token acquisition/refresh, consent and real provider permissions remain external.

When editing instructions, skills or their generators, keep the complete task
contract within the first 7,500 UTF-8 bytes (8,000-byte query limit). Front-load
constraints, routes, verification and stop conditions; defer examples and
inventories. Preserve safety and exact schema/command names.

<!-- instruction-prefix-end -->

## Optional reference inventory

<details>
<summary>Guidance file catalog</summary>

Use the task routes above first. This inventory is not required startup context.

- `.github/aw/action-container-substitutions.md`
- `.github/aw/agent-runtime-instructions.md`
- `.github/aw/agentic-chat.md`
- `.github/aw/agentic-engine.md`
- `.github/aw/agentic-workflows-mcp.md`
- `.github/aw/analyzing-runs.md`
- `.github/aw/asciicharts.md`
- `.github/aw/campaign.md`
- `.github/aw/charts-trending.md`
- `.github/aw/charts.md`
- `.github/aw/cli-commands.md`
- `.github/aw/compat.md`
- `.github/aw/connectors.md`
- `.github/aw/context.md`
- `.github/aw/create-agentic-workflow-design.md`
- `.github/aw/create-agentic-workflow-evaluation.md`
- `.github/aw/create-agentic-workflow-trigger-details.md`
- `.github/aw/create-agentic-workflow-validation.md`
- `.github/aw/create-agentic-workflow.md`
- `.github/aw/create-shared-agentic-workflow.md`
- `.github/aw/custom-declarative-agentic-engine.md`
- `.github/aw/debug-agentic-workflow.md`
- `.github/aw/debug-bootstrap.md`
- `.github/aw/debug-compilation.md`
- `.github/aw/debug-live-testing.md`
- `.github/aw/debug-model-engine-misconfiguration.md`
- `.github/aw/debug-playbook.md`
- `.github/aw/debug-scenarios.md`
- `.github/aw/debug-security-review.md`
- `.github/aw/debug-workflow-evidence.md`
- `.github/aw/debug-workflow-health.md`
- `.github/aw/dependabot.md`
- `.github/aw/deployment-status.md`
- `.github/aw/designer-mappings.md`
- `.github/aw/designer.md`
- `.github/aw/doctor.md`
- `.github/aw/documentation-workflows.md`
- `.github/aw/dreaming.md`
- `.github/aw/drive-memory.md`
- `.github/aw/enclaves.md`
- `.github/aw/evals.md`
- `.github/aw/experiments.md`
- `.github/aw/formal-methods.md`
- `.github/aw/github-agentic-workflows.md`
- `.github/aw/github-mcp-server-pagination.md`
- `.github/aw/github-mcp-server-tools.md`
- `.github/aw/github-mcp-server.md`
- `.github/aw/harbor.md`
- `.github/aw/index-search.md`
- `.github/aw/instructions.md`
- `.github/aw/intent.md`
- `.github/aw/jobs.md`
- `.github/aw/ledger.md`
- `.github/aw/linter-workflows.md`
- `.github/aw/llms.md`
- `.github/aw/loop.md`
- `.github/aw/lsp.md`
- `.github/aw/maintainer.md`
- `.github/aw/mcp-clis.md`
- `.github/aw/memory-stateful-patterns.md`
- `.github/aw/memory.md`
- `.github/aw/messages.md`
- `.github/aw/multi-agent-research.md`
- `.github/aw/network.md`
- `.github/aw/optimize-agentic-workflow.md`
- `.github/aw/otel.md`
- `.github/aw/patterns.md`
- `.github/aw/playwright.md`
- `.github/aw/pr-reviewer.md`
- `.github/aw/release-workflow.md`
- `.github/aw/repo-factory.md`
- `.github/aw/report.md`
- `.github/aw/responsible-ai.md`
- `.github/aw/reuse.md`
- `.github/aw/safe-outputs-automation.md`
- `.github/aw/safe-outputs-content.md`
- `.github/aw/safe-outputs-management.md`
- `.github/aw/safe-outputs-runtime.md`
- `.github/aw/safe-outputs.md`
- `.github/aw/serena-tool.md`
- `.github/aw/shared-safe-jobs.md`
- `.github/aw/skills.md`
- `.github/aw/squad.md`
- `.github/aw/subagents.md`
- `.github/aw/syntax-agentic.md`
- `.github/aw/syntax-checkout.md`
- `.github/aw/syntax-core.md`
- `.github/aw/syntax-engine.md`
- `.github/aw/syntax-tools-imports.md`
- `.github/aw/syntax.md`
- `.github/aw/test-coverage.md`
- `.github/aw/test-expression.md`
- `.github/aw/token-optimization-caching-budgets.md`
- `.github/aw/token-optimization-observability.md`
- `.github/aw/token-optimization.md`
- `.github/aw/triggers.md`
- `.github/aw/update-agentic-workflow.md`
- `.github/aw/upgrade-agentic-workflows.md`
- `.github/aw/visual-regression.md`
- `.github/aw/work-queue.md`
- `.github/aw/workflow-constraints.md`
- `.github/aw/workflow-editing.md`
- `.github/aw/workflow-patterns.md`

</details>
