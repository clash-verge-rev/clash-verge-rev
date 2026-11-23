# Issue and PR Guidelines

These rules apply to Issue and PR work, including operations through `gh` or an
API. The root [AGENTS.md](../AGENTS.md) defines the repository-wide contract.

## Issues

When creating, drafting, triaging, splitting, or implementing from a community
issue, follow [ISSUE_GUIDELINES.md](ISSUE_GUIDELINES.md). Do not create or modify
GitHub issues without explicit authorization.

## PR Descriptions

When creating or updating a PR body, follow the
[PR template](PULL_REQUEST_TEMPLATE.md). Describe the final change; replace stale
text instead of appending work history. Omit routine check-pass declarations,
including Clippy, lint, and local tests. Keep only evidence and limitations that
help reviewers assess the change; the template defines what belongs in the body
and when Scope is needed.

Before publishing or updating a PR body, remove repetition, self-evaluation, and
details already clear from the diff. Keep only sentences that help review the
change.

## AI Disclosure

When an agent creates or co-creates a PR or Issue, append a final body line with
the model and effort used (e.g. `Assisted by: GPT-5.6 High`). Effort may be omitted
when the runtime does not report it. Human contributors are not asked to disclose
AI assistance. Disclosure is transparency only and carries no positive or
negative weight.
