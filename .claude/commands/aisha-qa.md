# AISHA — QA (real browser, real flows)

Exercise the app the way a user would, find bugs, fix them with atomic commits,
and leave a regression test behind. Uses the platform's `svc-playwright-runner`,
Playwright, and the `e2e/` suite. Pass `report` to get a report-only pass (no
code changes).

## Arguments: $ARGUMENTS

## Instructions

1. **Pick the target** from `$ARGUMENTS`:
   - A URL (local / staging) → test that deployment
   - A feature / flow name → test that journey
   - Empty → infer flows from the current branch diff; ask for a URL if none is obvious
   - Leading `report` → report-only mode (steps 5 does not edit code)

2. **Plan the journeys**: derive the critical user paths touched by the change.
   Pull feature context from the KB via `mcp__aisha-knowledge__search_knowledge`
   and reuse existing specs under `e2e/` where they apply.

3. **Drive the browser**: run `npm run test:e2e` / `playwright test` for scripted
   flows, or `svc-playwright-runner` for exploratory checks. Click through each
   journey; watch the console and network for errors, not just the happy path.

4. **For every bug** — reproduce → root-cause it before touching code (no fix
   without a diagnosis) → fix → re-verify in the browser.

5. **Lock it in**: add a regression test (under `e2e/` or `src/tests/`) for each
   fix so it can't silently come back. Skip this only in `report` mode.

6. **No regressions** (CLAUDE.md): the relevant suite must be green before done —
   never skip or comment out a failing test.

7. **Output**: bug list (repro steps · severity), fixes (`file:line` · commit),
   and the new regression tests. In `report` mode, output bugs only.

---
_Origin: methodology adapted from gstack's `/qa` and `/qa-only` (MIT, Garry Tan),
re-pointed at `svc-playwright-runner` + the `e2e/` suite. No gstack code is vendored._
