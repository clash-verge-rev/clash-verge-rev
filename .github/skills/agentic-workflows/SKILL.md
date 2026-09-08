---
name: agentic-workflows
description: Route gh-aw workflow design/create/debug/upgrade requests to the right prompts.
---

# Agentic Workflows Router

Use this skill when a user asks to design, create, update, debug, or upgrade GitHub Agentic Workflows in this repository.

This skill is a dispatcher: identify the task type, load the matching workflow prompt/skill file, and follow it directly. Keep responses concise and ask a clarifying question if the correct prompt is unclear.

Repository overlay (optional):
- If `.github/aw/instructions.md` exists, load it with `@.github/aw/instructions.md` after loading the matched prompt/skill.
- Precedence: repository overlay instructions override upstream defaults when they conflict.

Read only the files you need:
Load these files from `github/gh-aw` (they are not available locally).
- `.github/aw/action-container-substitutions.md`
- `.github/aw/agent-runtime-instructions.md`
- `.github/aw/agentic-chat.md`
- `.github/aw/agentic-workflows-mcp.md`
- `.github/aw/asciicharts.md`
- `.github/aw/campaign.md`
- `.github/aw/charts-trending.md`
- `.github/aw/charts.md`
- `.github/aw/cli-commands.md`
- `.github/aw/compat.md`
- `.github/aw/configure-agentic-engine.md`
- `.github/aw/context.md`
- `.github/aw/create-agentic-workflow-trigger-details.md`
- `.github/aw/create-agentic-workflow.md`
- `.github/aw/create-shared-agentic-workflow.md`
- `.github/aw/debug-agentic-workflow.md`
- `.github/aw/dependabot.md`
- `.github/aw/deployment-status.md`
- `.github/aw/designer-mappings.md`
- `.github/aw/designer.md`
- `.github/aw/drive-memory.md`
- `.github/aw/enclaves.md`
- `.github/aw/evals.md`
- `.github/aw/experiments.md`
- `.github/aw/github-agentic-workflows.md`
- `.github/aw/github-mcp-server-pagination.md`
- `.github/aw/github-mcp-server-tools.md`
- `.github/aw/github-mcp-server.md`
- `.github/aw/instructions.md`
- `.github/aw/intent.md`
- `.github/aw/jobs.md`
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
- `.github/aw/patterns.md`
- `.github/aw/playwright.md`
- `.github/aw/pr-reviewer.md`
- `.github/aw/release-workflow.md`
- `.github/aw/report.md`
- `.github/aw/reuse.md`
- `.github/aw/safe-outputs-automation.md`
- `.github/aw/safe-outputs-content.md`
- `.github/aw/safe-outputs-management.md`
- `.github/aw/safe-outputs-runtime.md`
- `.github/aw/safe-outputs.md`
- `.github/aw/serena-tool.md`
- `.github/aw/shared-safe-jobs.md`
- `.github/aw/skills.md`
- `.github/aw/subagents.md`
- `.github/aw/syntax-agentic.md`
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
- `.github/aw/workflow-constraints.md`
- `.github/aw/workflow-editing.md`
- `.github/aw/workflow-patterns.md`

After loading the matching workflow prompt or skill, follow it directly:
- Design workflows from scratch via interview: `.github/aw/designer.md`
- Create new workflows: `.github/aw/create-agentic-workflow.md`
- Configure or add declarative engines: `.github/aw/configure-agentic-engine.md`
- Update existing workflows: `.github/aw/update-agentic-workflow.md`
- Debug, audit, or investigate workflows: `.github/aw/debug-agentic-workflow.md`
- Upgrade workflows and fix deprecations: `.github/aw/upgrade-agentic-workflows.md`
- Create shared components or MCP wrappers: `.github/aw/create-shared-agentic-workflow.md`
- Create report-generating workflows: `.github/aw/report.md`
- Fix Dependabot manifest PRs: `.github/aw/dependabot.md`
- Analyze coverage workflows: `.github/aw/test-coverage.md`
- Render compact markdown charts: `.github/aw/asciicharts.md`
- Map CLI commands to MCP usage: `.github/aw/cli-commands.md`
- Choose workflow architecture and patterns: `.github/aw/patterns.md`
- Optimize token usage and cost: `.github/aw/token-optimization.md`
- Design long-running multi-agent research workflows: `.github/aw/multi-agent-research.md`
- Add skills or agent plugins requested by the user (`skills:` / `plugins:` frontmatter, never on-the-fly installs): `.github/aw/skills.md`

When the task involves OTEL, OTLP, traces, observability backends, or telemetry-driven analysis, also read and follow `skills/otel-queries/SKILL.md` after loading the matching workflow prompt or skill.
