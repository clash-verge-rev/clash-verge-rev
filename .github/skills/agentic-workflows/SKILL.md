---
name: agentic-workflows
description: Route requests to design, create, update, debug, or upgrade GitHub Agentic Workflows (gh-aw), including workflow cost audits. Use for workflow infrastructure, not ordinary product development or code review.
---

# Agentic Workflows Router

Choose one primary route below. Fetch its reference from
`https://raw.githubusercontent.com/github/gh-aw/v1.0.1/.github/aw/`.
This version matches the repository's workflow lock and Copilot setup. Before
using another version, check the target lock's `compiler_version`; upgrades must
align the compiler, setup, and references together.

| Task | Reference |
| --- | --- |
| Design from requirements | `designer.md` |
| Create a workflow | `create-agentic-workflow.md` |
| Update a workflow | `update-agentic-workflow.md` |
| Debug or audit a run | `debug-agentic-workflow.md` |
| Upgrade or fix deprecations | `upgrade-agentic-workflows.md` |
| Reduce or measure token cost | `token-optimization.md` |
| Configure an engine | `configure-agentic-engine.md` |
| Create shared components or MCP wrappers | `create-shared-agentic-workflow.md` |
| Choose architecture | `patterns.md` |
| CLI commands or MCP equivalents | `cli-commands.md` |

Read the matched guide, then only the supporting sections needed for the task.
Do not preload the reference catalog or full manuals. Add `report.md` for report
design, `test-coverage.md` for coverage data, `dependabot.md` for generated
manifest updates, or `skills.md` for requested skill/plugin integration. For
OTEL/OTLP analysis, use upstream `skills/otel-queries/SKILL.md` at the same tag.
If `.github/aw/instructions.md` exists locally, read it as the repository overlay.
User scope and repository instructions take precedence over upstream defaults.

Edit workflow `.md` sources and run `gh aw compile <workflow>` with the matching
compiler; include the generated lock in the change. Never edit locks directly.
Keep permissions and data reads scoped to the workflow's purpose. A request to
edit or audit a workflow does not authorize dispatching runs or posting to GitHub.
For cost audits, distinguish prompt size from measured run usage, including cache
reads/writes; a shorter prompt alone does not prove lower credits or better review.
