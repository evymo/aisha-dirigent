# Delivering development discipline through Dirigent

AISHA is a **service for development**: the disciplines it upholds for its own
codebase must be *delivered to the developers who work through Dirigent* on a
connected story — not left as repo-internal CI that only this monorepo runs.

This document records how the **structural self-consistency** discipline (every
cross-component binding has both a producer and a consumer — inspired by Forge's
`forge_lint.py`, adapted, not copied) reaches a developer, and the deliberate
split between what works **offline** now and what the **backend-connected** full
solution adds later.

## The delivery chain

```
AISHA rule SoT
  ├─ scripts/ide-adapters/templates/claude-overlay/aisha-advisor.md   (subagent SoT)
  └─ extensions/aisha-dirigent/src/generators/universal-baseline.ts   (offline rule SoT, Tier-3)
        │  gen:ide  /  Dirigent extension (Tier 1 backend → 2 local-LLM → 3 baseline)
        ▼
   committed workspace artifacts
     ├─ .claude/agents/aisha-advisor.md   (read-only subagent — Read/Grep/Glob only)
     ├─ CLAUDE.md + .aisha/active-rules.json   (governing rules, extension Tier-3)
        │
        ▼
   developer's Claude Code session
     ├─ CLAUDE.md loaded directly
     ├─ SessionStart hook injects the active-rules governance block
     └─ /aisha-advise → subagent runs the structural pass → advisory findings
```

## Offline-minimal base (this layer — no backend required)

Two vehicles, both **advisory-only** and **repo-agnostic** (they grep whatever
tree they are invoked in, so they port to any consumer codebase):

1. **The `aisha-advisor` subagent** gains a *Structural self-consistency
   (broken-binding) review* step: for every referenced binding — event channel,
   route/endpoint, env var, RPC/function — it greps for **both** sides and
   reports orphans (one side missing) as best-practice deviations. Its
   `Read, Grep, Glob`-only tool grant *structurally* enforces advisory-only: it
   cannot Edit, Write, Bash, or return `block`. Invoked via `/aisha-advise`.
2. **A passive baseline rule** `baseline-structural-self-consistency`
   (architecture category) surfaces the same invariant in `CLAUDE.md` and
   `.aisha/active-rules.json`, injected into every session at SessionStart — so
   the discipline is present *systematically*, not only on demand.

A developer gets both with **zero backend**: clone/generate the overlay, and the
discipline is already there. Fail-open by construction — absent the backend, the
session simply operates at this advisory floor.

## Backend-connected full solution (deferred — after story connection)

Once a story is connected and the backend is deployed, the *same* invariant
upgrades in place (all fail-open — absent the backend it degrades to the offline
floor above):

1. **Story-scoped rule** — the invariant becomes a published `expert_rules` row
   surfaced through `get_instruction_payload`, tailored to the connected story's
   ruleset fingerprint, tech stack, and risk profile instead of the fixed
   universal baseline.
2. **Live compliance context** — the advisor's `aisha-knowledge` MCP tools go
   live (`get_compliance_context`, `get_story_context`, `search_knowledge`), so
   the structural pass is checked against the story's acceptance criteria and
   per-story KB, not just repo greps.
3. **Enforced, escalatable gate** — a generalized, repo-parameterized wiring
   scanner runs server-side as a compliance playbook; only the Stop-loop
   `goal_evaluator` may return `decision:block`, holding a session against story
   acceptance criteria when broken bindings remain.

## Invariants (do not break)

- **Advisory-only.** The offline vehicles emit findings only (severity max
  `warn`), never a patch, never `block`. `block` is backend Stop-loop territory.
  Never add `Bash`/`Edit`/`Write` to the advisor.
- **Generated artifacts.** `.claude/agents/*.md`, `CLAUDE.md`, and
  `.aisha/active-rules.json` are GENERATED. Change the SoT (the advisor template,
  `universal-baseline.ts`, or — for the online path — an `expert_rules` seed row)
  and regenerate; never hand-edit. Only `dirigent.template.json` ships from
  `.aisha/`. Parity is enforced by the `claude-overlay-drift` /
  `ide-instructions-freshness` gates.
- **Repo-agnostic + forkable.** Rule/prompt text carries only generic guidance —
  no AISHA-specific paths, no tokens/URLs/tenant names. Do **not** wire the
  AISHA-hardcoded `scripts/lib/comms-wiring.mjs` as the offline vehicle; the
  advisor's grep-the-current-tree approach is what makes it portable.
