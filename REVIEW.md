# Code Review Guidelines

Use these guidelines for technical review and verification of review fixes.
Read the sections relevant to the change; follow behavior across boundaries
instead of limiting review to the directories in the diff. Contribution scope
and test expectations remain in [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md#contribution-expectations).

## Scope and Evidence

- Identify the intended outcome and the candidate being reviewed: base/head
  commits, plus task-relevant staged, unstaged, and untracked files for local
  work. Inspect the actual changes and necessary callers; an author's summary
  is context, not proof that the implementation works.
- Check that the change solves the reported problem without breaking adjacent
  behavior. For fixes, trace the cause and confirm that the verification would
  expose the original failure. Use the
  [validation guidance](CONTRIBUTING.md#choosing-validation) for evidence limits.
- Separate newly introduced regressions, existing defects, intentional changes,
  and unresolved hypotheses. Verify a suspected finding against reachable code
  and supported configurations before presenting it as a defect.
- Prioritize correctness and user impact. Omit formatting already enforced by
  tools, personal style preferences, and speculative future requirements.
  Suggest simplification only when a concrete duplicate state, side effect, or
  unnecessary abstraction can be removed while preserving required behavior.

## Frontend

Apply [frontend architecture rules](src/AGENTS.md). Where affected, check:

- Whether an older response or event can overwrite newer authoritative state,
  including after a profile, subscription, or credential change.
- Whether navigation, mode switching, remount, reload, and application restart
  preserve or reset the intended state. Check pending edits and debounced writes.
- Whether one user action duplicates commands or refreshes, and whether timers,
  subscriptions, and cache entries retain the correct lifetime and identity.

## Backend

Apply [backend architecture rules](src-tauri/AGENTS.md). Where affected, check:

- What remains persisted or active after partial success, failure, or rollback,
  and whether returned errors and notifications describe that actual state.
- Lock ordering, cancellation, retries, and ownership of Service/Core processes
  and OS settings through startup, shutdown, disconnection, and recovery.
- Platform-specific control flow after conditional compilation. A check on one
  platform does not establish correctness on the others.

## Cross-boundary Behavior

- Trace changed commands and events from producer to consumer, including
  generated bindings, payload semantics, ordering, and success/error handling.
- Check that UI state follows backend outcomes, including failed mutations and
  stale cache reads. Do not treat an optimistic display as proof of success.
- For DNS, proxy, updater, or service changes, inspect the affected external
  state and failure path; source or mock evidence alone cannot establish native
  behavior. Keep unexercised cases explicit.

## Findings and Re-review

- Report each actionable finding with a file and line, triggering conditions,
  impact, supporting evidence, and whether this change introduced it. Severity
  follows impact and reachability. Keep optional simplifications separate from
  defects; do not turn existing issues into unrelated required fixes.
- State plainly when no actionable findings remain, together with material
  verification gaps. This is a conclusion about the reviewed candidate, not a
  guarantee that every runtime or platform was exercised.
- For each finding, verify the fix or explain why it is incorrect, intentional,
  or outside scope. Fix confirmed instances of the same defect within the task's
  scope, then recheck affected behavior.
- On re-review, compare the new candidate with the previously reviewed version.
  Focus on finding closure, the repair diff, and its consequences. Expand only
  when changes or new evidence affect another boundary. Keep finding identities
  stable and do not repost resolved findings without new evidence.
- Stop when actionable findings are resolved and relevant checks pass; do not
  require a fixed number of passes. After three rounds without convergence,
  summarize the remaining evidence or disagreement and reconsider the cause,
  scope, or approach before continuing. An unresolved finding is not a pass.

## AI Context Sharing

Agents own context transfer between implementation, review, repair, and re-review.
The issue supplies the human-facing problem, scope, and acceptance criteria;
maintenance without an issue uses the authorized task. Humans do not need to
prepare agent handoffs or relay findings between agents.

- Pass the task reference, candidate revision and scope, relevant source locations
  and constraints, verification results, and unresolved findings. Keep this in the
  working session or agent handoff; do not publish internal transcripts or require
  another repository document.
- Separate observations from assumptions. Refresh stale context from source and
  independently verify the relevant paths instead of inheriting another agent's
  verdict. Retrieve missing code context within the authorized scope.
- The repairing agent maps each repair or non-fix rationale to its original
  finding and passes the updated revision and verification results to the reviewer.
- Escalate missing requirements, unavailable external evidence, or decisions that
  need human input; do not ask humans to reconstruct the implementation.
