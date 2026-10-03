# AISHA — Staff Engineer Review

Find the bugs that pass CI but blow up in production. The companion to
`/aisha-advise` (read-only advisor posudek) and `/aisha-quality` (rule scan):
this command is **allowed to fix** — it auto-fixes the obvious, proposes the
risky, and flags completeness gaps.

## Arguments: $ARGUMENTS

## Instructions

1. **Determine scope** from `$ARGUMENTS` (same convention as `/aisha-advise`):
   - Empty → uncommitted changes (`git diff` + dirty files)
   - File path(s) → those files
   - `branch` → whole branch vs main (`git diff main...HEAD`)
   - `staged` → staged changes only

2. **Load context**: read `.aisha/story.json` for the active story, then pull
   relevant patterns from the KB via `mcp__aisha-knowledge__search_knowledge`
   and cite concrete rules with `get_expert_rule`.

3. **Review for production-grade defects** (not style — `/aisha-quality` owns that):
   - Correctness & edge cases (empty / null / boundary / large inputs)
   - Error & exception paths, partial failure, retries / idempotency
   - Async races, ordering, unawaited promises, leaked handles / connections
   - Input validation at every boundary (CLAUDE.md → *Validate All Input*)
   - API / contract or migration breaks (CLAUDE.md → *document public API contracts*)
   - Missing tests for new code (CLAUDE.md → *Test All New Code*)
   - Security smell → defer the deep pass to `/aisha-security`

4. **Classify every finding**:
   - `[AUTO-FIX]` trivial + safe → apply, show the diff
   - `[ASK]` non-trivial → propose the change, get approval before editing
   - `[FLAG]` completeness gap or missing test → call out, don't paper over

5. **No regressions** (CLAUDE.md): run `npx tsc --noEmit`, `npm run lint`, and
   the relevant `npm run test:run` before declaring done. Never skip or comment
   out a failing test to go green.

6. **Compliance**: run `mcp__aisha-knowledge__validate_compliance` on changed
   snippets and fold the result into the report.

7. **Output** — per finding: severity · confidence · `file:line` · what changed
   (or what to change). End with a one-line verdict: ship / fix-first / needs-review.

---
_Origin: methodology adapted from gstack's `/review` (MIT, Garry Tan) into
AISHA-native tooling. No gstack code or branding is vendored._
