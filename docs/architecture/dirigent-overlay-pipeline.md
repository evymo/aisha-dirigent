# AISHA Dirigent — Claude Code Supervision Overlay Pipeline

> **Status (2026-05-24):** Vrstva 1 + 2 + 3 implemented end-to-end in this
> branch, tested in CI. **Production status:** migrations + svc-ai-chat route
> + n8n WFs NOT yet deployed (verified live — see § 0 in
> [deploy doc](../aisha-dirigent-supervisor-backend-deploy.md)). Branch is
> ready to merge; deploy unblocks Vrstva 2.
>
> Companion: [deploy + ops checklist](../aisha-dirigent-supervisor-backend-deploy.md),
> [n8n/workflows/README-dirigent-supervisor.md](../../n8n/workflows/README-dirigent-supervisor.md),
> [aisha/db/migrations/20260501000000_dirigent_supervisor.sql](../../aisha/db/migrations/20260501000000_dirigent_supervisor.sql),
> [aisha/db/migrations/20260524000000_claude_hook_bindings.sql](../../aisha/db/migrations/20260524000000_claude_hook_bindings.sql),
> [aisha/db/migrations/20260524010000_dirigent_drain_nudges.sql](../../aisha/db/migrations/20260524010000_dirigent_drain_nudges.sql).

## Why this exists

The VS Code AISHA Dirigent extension (`extensions/aisha-dirigent/`) provides
real-time advisory supervision inside the IDE. Claude Code agents need the
equivalent surface — hooks that fire on `PreToolUse` / `PostToolUse` /
`SessionStart` / `Stop` to inject advisory text (`additionalContext`) without
blocking the agent. The pipeline below explains how AISHA's backend rule store
flows through a generator into the `.claude/*` artifacts that Claude Code reads
at session start.

## Pipeline (current state)

```
┌─────────────────────────────────────────────────────────────────────┐
│ BACKEND (DB SoT)                                                    │
│                                                                     │
│   public.claude_hook_bindings (table)                               │
│     ↑ migrated by 20260524000000_claude_hook_bindings.sql           │
│     ↓ exposed via                                                   │
│   public.mcp_get_claude_hook_bindings(p_story_id uuid)              │
│     SECURITY DEFINER + RLS + GRANT to anon/authenticated/service    │
│                                                                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   │ (Fáze 2: extension calls live RPC)
                   │ (Today: offline JSON mirror reads from repo)
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ OFFLINE MIRROR                                                       │
│                                                                     │
│   aisha/db/seed/claude_hook_bindings.json                           │
│     ↑ kept in sync with .sql seed by                                │
│     ↓ src/tests/gates/claude-overlay-drift.gate.test.ts             │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ GENERATOR PIPELINE                                                  │
│                                                                     │
│   scripts/ide-adapters/                                             │
│     ├── registry.mjs              ← multiFile: true marker          │
│     ├── multi-file.mjs            ← AdapterOutput + mergeSettingsJson│
│     ├── adapter-claude-overlay.mjs ← CLI port                       │
│     └── templates/claude-overlay/  ← 10 static templates            │
│         ├── _aisha-advise-lib.sh                                    │
│         ├── aisha-advise-{i18n,bash-risk}.sh   (heuristic, static)  │
│         ├── regex-hook.template.sh             (dynamic, 1× per     │
│         │                                       binding)            │
│         ├── aisha-advisor.md                                        │
│         ├── aisha-supervisor.SKILL.md                               │
│         ├── cmd-aisha-{advise,supervise,cooldowns}.md               │
│         └── statusline.sh                                           │
│                                                                     │
│   extensions/aisha-dirigent/src/generators/                         │
│     ├── multi-file.ts              ← TS mirror of multi-file.mjs    │
│     ├── adapter-claude-overlay.ts  ← TS port (esbuild text loader   │
│     │                                  bundles templates at build)  │
│     └── generate-all.ts            ← orchestrates 9 adapters        │
│                                       (8 single-file + claude-overlay)│
│                                                                     │
│ Trigger:                                                            │
│   - CLI:        npm run gen:ide -- --format=claude-overlay           │
│   - Extension:  invoked by config-writer.ts on activation +         │
│                 on rule_bindings push event                         │
└──────────────────┬──────────────────────────────────────────────────┘
                   │ emits 15 files
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ COMMITTED ARTIFACTS (clone-to-ready snapshot)                       │
│                                                                     │
│   .claude/hooks/                                                    │
│     ├── _aisha-advise-lib.sh                                        │
│     ├── aisha-advise-{any,bash-risk,console,i18n,rpc,                │
│     │   select-star,ts-ignore}.sh                                   │
│   .claude/agents/aisha-advisor.md                                   │
│   .claude/skills/aisha-supervisor/SKILL.md                          │
│   .claude/commands/aisha-{advise,supervise,cooldowns}.md            │
│   .claude/statusline.sh                                             │
│   .claude/settings.json  (merge: preserves user hooks, replaces     │
│                          _aisha.managed:true entries)               │
│                                                                     │
│ Drift detection:                                                    │
│   src/tests/gates/claude-overlay-drift.gate.test.ts (30 assertions) │
│   — regenerates with current SoT, compares byte-by-byte to          │
│     committed bytes; FAILS CI on hand-edit                          │
└──────────────────┬──────────────────────────────────────────────────┘
                   │ Claude Code reads at session start
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ RUNTIME (in Claude Code session)                                    │
│                                                                     │
│   PreToolUse(Edit|Write|MultiEdit) ──┐                              │
│     for each rule binding:           │ exit 0 (advisory only)       │
│       grep -qE pattern → cat heredoc → stdout (additionalContext)   │
│       45s cooldown gate                                              │
│                                                                     │
│   PreToolUse(Bash) ─────────────────┐                               │
│     aisha-advise-bash-risk.sh       │ static heuristic              │
│       (git push --force, --no-verify, DROP TABLE, …)                │
│                                                                     │
│   /aisha-advise        slash command → invoke Task(aisha-advisor)   │
│   /aisha-supervise     show active hooks + their last fire time     │
│   /aisha-cooldowns     list /tmp/aisha-advise-* cooldown files      │
│                                                                     │
│ Runtime verification:                                               │
│   src/tests/gates/claude-overlay-runtime.gate.test.ts (18 assertions)│
│   — actually execFileSync each hook with realistic                  │
│     CLAUDE_HOOK_TOOL_INPUT; asserts fires on positive samples,      │
│     silent on negatives, cooldown works, defensive on malformed     │
└─────────────────────────────────────────────────────────────────────┘
```

## Vrstva 2 — HTTP relay → svc-ai-chat → n8n playbooks (implemented, awaits deploy)

```
Claude Code agent
     │  hook event (PreToolUse / PostToolUse / SessionStart / Stop)
     ▼
.claude/hooks/aisha-supervisor-relay.mjs           ✓ generated (Node 18+ fetch)
     │  HTTPS POST + Bearer $AISHA_MCP_TOKEN       ↘ no token → silent exit 0
     ▼
POST https://api.aisha.guru/dirigent/dispatch     ✓ services/svc-ai-chat/src/routes/
     │  verifyToken (Keycloak JWT) — cold-start fail-open
     │  dirigent_dispatch_event(event, story_id, session_id, payload)
     │    → playbook key (briefing | intent_advisor | … | goal_evaluator)
     │  dirigent_drain_nudges (atomic FOR UPDATE SKIP LOCKED)
     │  SSRF-safe fetch → https://n8n.aisha.guru/webhook/dirigent/<playbook>
     │  log_integration_action (fire-and-forget audit)
     ▼
n8n WF_DIRIGENT_{BRIEFING,INTENT_ADVISOR,COMPLIANCE_PRE_CHECK,
                  COMPLIANCE_ENFORCEMENT,GOAL_EVALUATOR}.json    ✓ in repo
     │  LLM advisory + KB lookups (Haiku via Claude Gateway)
     ▼
JSON response → relay stdout (additionalContext) → Claude Code injects
```

**Fail-open at every layer:** without `AISHA_MCP_TOKEN` env, relay no-ops.
Without route, relay sees 404 and exits 0. Without n8n WF, svc-ai-chat
returns 200/empty. Without nudges, drain returns []. Each layer adds depth;
absence does not block the agent.

**Special case — `goal_evaluator` is the only playbook permitted to return
`decision: "continue"` (loop=true)**, which the Stop hook honors to keep
the agent working toward open acceptance criteria. All other playbooks
return advisory-only (`decision: "allow"`).

**Deploy steps:** see [docs/aisha-dirigent-supervisor-backend-deploy.md](../aisha-dirigent-supervisor-backend-deploy.md).
3 migrations + svc-ai-chat redeploy + 5 n8n imports. Each layer
independently deployable.

## Vrstva 4 — Extension Error Memory / LocalDecision / EscalationPacket (REMOVED)

Original revision-1 plan called for in-extension Error Memory, LocalDecision
(strict JSON from local CPU LLM), and EscalationPacket modules. After
architectural audit on 2026-05-24 (3-agent capability survey), all three
were deleted in commit `28a14132` because they shadowed established backend
brain:

| Removed in-extension module | Backend equivalent already shipping |
|---|---|
| `error-memory.ts` (jsonl persistence + dedup) | `agent_memories` table + `fn_get_agent_memory` RPC |
| `local-decision.ts` (Qwen JSON → decision) | `governedOrchestration` + `unifiedChat` route |
| `escalation.ts` (EscalationPacket → MCP) | `fn_log_dev_signal` + `ai_trace_events` + `dirigent_nudges` |

**What was KEPT:** `rules-engine.ts` (60s in-memory cache of
`mcp_get_claude_hook_bindings` + regex evaluator) and `fetch-bindings.ts`
(defensive RPC parser). These are necessary because they map signals to
binding metadata for the toast/chat UX — strictly extension-local concern,
no backend duplication.

The thin pattern is now:

```
copilot-watcher.ts: onDidChangeTextDocument
  → debounce 1.8s
  → rules-engine.evaluate(signal, ctx)   ← cached bindings
  → 45s cooldown per rule
  → vscode toast / chat hint
  → callRpc("fn_log_dev_signal", { rule_key, ... })   ← backend composes
```

The backend (svc-ai-chat unifiedChat + governedOrchestration) decides
whether to push back via `aisha-push` based on aggregated `ai_trace_events`.
Extension stays sensor + display only.

## Test coverage

| Layer | Test | Assertions |
|---|---|---|
| SoT sync | `claude-overlay-drift.gate` | SQL ↔ JSON mirror parity, 5 expected slugs, ON CONFLICT |
| RPC contract | `claude-overlay-drift.gate` | signature, return shape, GRANTs, RLS, trigger, CHECK constraints |
| Generator output | `claude-overlay-drift.gate` | byte-identical to committed; settings.json merge invariants |
| CLI ↔ extension parity | `claude-overlay-drift.gate` | same templates, same JSON mirror, same paths, same helpers |
| Merge error handling | `claude-overlay-drift.gate` | malformed JSON throws clear error; merge idempotent |
| Hook runtime | `claude-overlay-runtime.gate` | each hook fires on positive sample, silent on negative, exits 0, cooldown 45s, defensive |
| TS adapter | `extensions/.../adapter-claude-overlay.test.ts` | multi-file output structure, payload override, executable mode |
| Rules engine (extension) | `extensions/.../rules-engine.test.ts` | 60s cache + fallback (live/null/empty/throw), force/invalidate/TTL, regex eval, severity→decision mapping (high→warn, mod/low→suggest, NEVER block/escalate), malformed regex skip, scanner_kind heuristic skip, pattern_regex null defense |
| svc-ai-chat route | `services/svc-ai-chat/.../dirigent-supervisor.unit.test.ts` | verifyToken cold-start fail-open, dispatch RPC + drain, n8n SSRF-safe POST, audit fire-and-forget, story_id null/empty handling, missing playbook, audit log structure |

**Total: ~94 assertions across 5 test files. All pass; 0 regressions vs main.**

Production-side verification (live RPC + route + n8n webhook reachability)
is documented in [the deploy doc § 0](../aisha-dirigent-supervisor-backend-deploy.md#0-live-production-verification-run-before-deploy)
as curl scripts — not in CI because production state changes outside
this repo's release cycle.

## Files

| Layer | File |
|---|---|
| **DB SoT** | `aisha/db/migrations/20260501000000_dirigent_supervisor.sql` (dirigent_nudges + story_goal_state + 5 RPCs) |
| | `aisha/db/migrations/20260524000000_claude_hook_bindings.sql` (table + RPC + seed) |
| | `aisha/db/migrations/20260524010000_dirigent_drain_nudges.sql` (atomic drain) |
| | `aisha/db/sql/tables/claude_hook_bindings.sql` |
| | `aisha/db/sql/rls/claude_hook_bindings.sql` |
| | `aisha/db/sql/grants/claude_hook_bindings.sql` |
| | `aisha/db/sql/triggers/set_claude_hook_bindings_updated_at.sql` |
| | `aisha/db/sql/functions/mcp_get_claude_hook_bindings.sql` |
| | `aisha/db/sql/functions/dirigent_drain_nudges.sql` |
| | `aisha/db/seed/claude_hook_bindings.sql` |
| **Mirror** | `aisha/db/seed/claude_hook_bindings.json` |
| **CLI generator** | `scripts/ide-adapters/adapter-claude-overlay.mjs` |
| | `scripts/ide-adapters/multi-file.mjs` |
| | `scripts/ide-adapters/templates/claude-overlay/*.{sh,md,mjs.txt}` |
| | `scripts/generate-ide-instructions.mjs` (multi-file write loop) |
| **Extension** | `extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts` |
| | `extensions/aisha-dirigent/src/generators/multi-file.ts` |
| | `extensions/aisha-dirigent/src/generators/multi-file-writer.ts` (gate-safe writer) |
| | `extensions/aisha-dirigent/src/generators/generate-all.ts` |
| | `extensions/aisha-dirigent/src/generators/fetch-bindings.ts` (live RPC + parser) |
| | `extensions/aisha-dirigent/src/rules-engine.ts` (cache + evaluate) |
| | `extensions/aisha-dirigent/src/copilot-watcher.ts` (thin sensor — post-refactor) |
| | `extensions/aisha-dirigent/esbuild.config.js` (text loader for templates) |
| | `extensions/aisha-dirigent/vitest.config.ts` (Vite plugin for tests) |
| **svc-ai-chat** | `services/svc-ai-chat/src/routes/dirigent-supervisor.ts` (Vrstva 2 relay endpoint) |
| **n8n** | `n8n/workflows/WF_DIRIGENT_BRIEFING.json` (SessionStart) |
| | `n8n/workflows/WF_DIRIGENT_INTENT_ADVISOR.json` (UserPromptSubmit) |
| | `n8n/workflows/WF_DIRIGENT_COMPLIANCE_PRE_CHECK.json` (PreToolUse) |
| | `n8n/workflows/WF_DIRIGENT_COMPLIANCE_ENFORCEMENT.json` (PostToolUse) |
| | `n8n/workflows/WF_DIRIGENT_GOAL_EVALUATOR.json` (Stop — only `decision: "continue"` source) |
| **Generated** | `.claude/hooks/aisha-advise-*.sh` (7 + lib) |
| | `.claude/agents/aisha-advisor.md` |
| | `.claude/skills/aisha-supervisor/SKILL.md` |
| | `.claude/commands/aisha-{advise,supervise,cooldowns}.md` |
| | `.claude/statusline.sh` |
| | `.claude/settings.json` (merged) |
| **Tests** | `src/tests/gates/claude-overlay-drift.gate.test.ts` (~34) |
| | `src/tests/gates/claude-overlay-runtime.gate.test.ts` (~18) |
| | `extensions/aisha-dirigent/__tests__/adapter-claude-overlay.test.ts` (~7) |
| | `extensions/aisha-dirigent/__tests__/rules-engine.test.ts` (~21) |
| | `services/svc-ai-chat/src/tests/routes/dirigent-supervisor.unit.test.ts` (~14) |
| **Docs** | this file |
| | `docs/aisha-dirigent-supervisor-backend-deploy.md` (Fáze 2 deploy + ops checklist) |
| | `n8n/workflows/README-dirigent-supervisor.md` (5 n8n playbook contracts) |

## Adding a new rule

The point of the SoT pipeline is that adding a rule should be a 3-step
process, not 14:

1. **Add row to seed:**
   ```sql
   -- aisha/db/seed/claude_hook_bindings.sql
   INSERT INTO public.claude_hook_bindings (rule_slug, hook_event, ...) VALUES
     ('no-todo', 'PreToolUse', 'Edit|Write|MultiEdit', 'regex',
      '\\bTODO[:\\s]', 'Hygiena: TODO nezůstávají v produkčním kódu...', ...)
   ON CONFLICT (rule_slug) DO UPDATE SET ...;
   ```
   Then mirror to `aisha/db/seed/claude_hook_bindings.json`.

2. **Regenerate overlay:**
   ```bash
   npm run gen:ide -- --format=claude-overlay
   ```
   New `.claude/hooks/aisha-advise-no-todo.sh` appears; `.claude/settings.json`
   gets new entry with `_aisha.managed: true`.

3. **Commit + test:**
   - `git add aisha/db/ .claude/`
   - `npm run test:gates -- src/tests/gates/claude-overlay-*.gate.test.ts`
   - drift test enforces SoT ↔ snapshot equality on every CI run

No hand-edit to bash, no hand-edit to settings.json, no skill / subagent
update needed. The SoT is the single change site.
