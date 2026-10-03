# AISHA — Documentation (Diataxis, from code)

Generate or refresh docs that actually match what shipped, using the Diataxis
framework (reference · how-to · tutorial · explanation). Researches the code
first, then writes — and refreshes the machine-readable inventories so the
capability catalog stays in sync.

## Arguments: $ARGUMENTS

## Instructions

1. **Scope** from `$ARGUMENTS`: a feature / dir / service, or empty → docs
   affected by the current branch (`git diff --name-only main...HEAD`).

2. **Research the code first** — read the actual implementation; never invent
   behaviour. Pull related rules/context via `mcp__aisha-knowledge__search_knowledge`.

3. **Build a Diataxis coverage map** for the scope: which of reference / how-to /
   tutorial / explanation already exist (scan `docs/` and `docs/index.md`) versus
   what's missing or stale relative to the diff.

4. **Write / refresh** the missing docs under `docs/<area>/`, matching repo
   conventions (cs / en variants where the area uses them). Cross-reference the
   diff so drifted docs are corrected, not just appended to.

5. **Refresh the inventories** so machine-readable state tracks the code:
   - `npm run gen:catalog` — re-scan the capability catalog (`docs/catalog/`)
     so new services / commands / MCP tools / plugins appear
   - `npm run gen:ide` — only if IDE-facing rules changed

6. **Output**: the coverage map (before → after), files written / updated, and
   any remaining gaps worth a follow-up.

---
_Origin: methodology adapted from gstack's `/document-generate` (Diataxis; MIT,
Garry Tan), chained into AISHA's `gen:catalog` / `gen:ide`. No gstack code is vendored._
