<!--
Describe the final problem, approach, and evidence needed to review this change.
When updating the body, replace stale text instead of appending implementation
history or review-round summaries.

State each fact once. Omit details already clear from the diff unless they
explain a non-obvious constraint or trade-off. Describe concrete behavior instead
of self-evaluation or unsupported assurances such as "more robust" or "seamless".
Mention unchanged behavior or excluded areas only when they matter to review.
Before publishing, remove any sentence whose deletion loses no information
needed to understand the problem, approach, evidence, or material limitations.

Omit file-by-file diff summaries, internal planning scores, agent handoffs, and
routine check results such as "Clippy passed", "lint passed", or "local tests
passed". Do not add a Validation/Testing section for a command checklist.
Include concrete before/after behavior or measurements when they support the
change, and retain limitations that affect review. Link reviewer-accessible
details when needed; do not paste full scripts, logs, or test matrices into the
body, including collapsed sections.

Keep Scope only when explaining necessary changes outside the core fix, PR
dependencies, or why added tests are needed. Do not repeat Approach there.
For small changes, Problem and Approach may be combined into one short paragraph;
remove unnecessary headings instead of adding text to fill them.
-->

## Problem

What breaks or what is missing. Product bug fixes and features require a
pre-existing issue; link it here (`Fixes #123` only when this PR fully resolves
it). Maintenance work (such as chore, perf, docs, refactor, test, CI/build,
dependency, style, routine localization, or release changes) does not require
an issue link; link one when it defines the scope. For reverts, link the PR or
commit being reverted. For security-sensitive fixes that cannot be tracked
publicly, follow maintainer-approved private tracking.

## Approach

Why this change solves the problem — the reasoning behind the approach, not a restatement of the diff.

## Scope

Optional: explain necessary changes outside the core fix, PR dependencies, or
why added tests are needed. Otherwise remove this section. New tests are not
expected by default.
