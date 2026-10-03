# Dirigent Supervisor — n8n Playbook Deploy Guide

> Companion docs for [aisha/db/migrations/20260501000000_dirigent_supervisor.sql](../../aisha/db/migrations/20260501000000_dirigent_supervisor.sql)
> and [services/svc-ai-chat/src/routes/dirigent-supervisor.ts](../../services/svc-ai-chat/src/routes/dirigent-supervisor.ts).
>
> **Audience:** n8n admin deploying the runtime-supervision overlay for Claude Code.
>
> **Updated 2026-05-31 (svc-era):** the edge fn migrated Supabase → `services/svc-ai-chat/src/routes/dirigent-supervisor.ts`; the relay hook is `aisha-supervisor-relay.mjs` (Node fetch, not bash). Paths below reflect the current stack. Dispatch endpoint is `POST https://api.aisha.guru/dirigent/dispatch`.

## Architecture recap

```
Claude Code agent
     │  (hook event)
     ▼
.claude/hooks/aisha-supervisor-relay.mjs
     │  (HTTPS POST + bearer)
     ▼
services/svc-ai-chat/src/routes/dirigent-supervisor.ts
     │  (1) RPC dirigent_dispatch_event → playbook key + session_id
     │  (2) drainNudges (dirigent_nudges)
     │  (3) HTTPS POST /webhook/dirigent/<playbook>
     ▼
n8n WF_DIRIGENT_<PLAYBOOK> workflows
     │  (LLM advisory + KB lookups)
     ▼
JSON response → relay → Claude Code stdout (additionalContext)
```

The principle is **advisory-only** — every playbook returns `{advisory: "..."}`
that becomes additionalContext for the agent. The single exception is the
`goal_evaluator` playbook for the `stop` event, which may return
`{decision: "block", reason: "..."}` to force loop continuation when story
acceptance criteria are not yet met.

## Required playbooks

The edge fn maps each Claude Code hook event to one playbook (see
`dirigent_dispatch_event` SQL function for the canonical mapping):

| Event | Playbook | Webhook path | Loop intervention |
|---|---|---|---|
| `session_start` | `briefing` | `/webhook/dirigent/briefing` | none |
| `prompt_submit` | `intent_advisor` | `/webhook/dirigent/intent_advisor` | none |
| `pre_tool` | `compliance_pre_check` | `/webhook/dirigent/compliance_pre_check` | none |
| `post_tool` | `compliance_enforcement` | `/webhook/dirigent/compliance_enforcement` | none |
| `stop` | `goal_evaluator` | `/webhook/dirigent/goal_evaluator` | `decision: "block"` allowed |

All playbooks SHOULD respond within **3 seconds** (edge fn timeouts at 4s,
hook total budget is 8s). Playbooks that take longer must return early with
a placeholder advisory and queue a follow-up nudge into `dirigent_nudges`
for the next Stop event to drain.

## Playbook contracts

Each playbook receives a JSON POST body with this shape (set by the edge fn):

```jsonc
{
  "event": "session_start" | "prompt_submit" | "post_tool" | "stop",
  "story_id": "uuid|null",
  "session_id": "uuid (moderation_sessions.id from dispatch RPC)",
  "tool_input": { /* claude code hook payload */ },
  "tool_output": { /* if post_tool */ },
  "user_prompt": "string (if prompt_submit)",
  "transcript_excerpt": "string (if stop)"
}
```

Each playbook MUST return JSON of this shape:

```jsonc
{
  "advisory": "string (becomes additionalContext)",
  "decision": "allow" | "block" | "ask",   // only goal_evaluator may use block/ask
  "reason": "string (when decision != allow)"
}
```

### 1. `briefing` (SessionStart)

**Input signal:** session is starting. `story_id` may or may not be set.

**Behavior:**
1. Call existing RPC `mcp_get_story_context(story_id)` → load story, ruleset
   (rule slugs + fingerprint), tech_stack, risk_profile, acceptance_criteria.
2. Optional: `mcp_search_knowledge_v2` for top 3 highest-priority rules
   matching tech_stack tags.
3. Build markdown brief:
   - Story title + delivery_status
   - Active ruleset fingerprint
   - 3 top-risk rules (slug + 1-line summary)
   - Acceptance criteria list (`[ ]` checkbox style)
4. Return `{advisory: "<markdown brief>", decision: "allow"}`.

If no `story_id`: return short "no active story — set .aisha/story.json" hint.

### 2. `intent_advisor` (UserPromptSubmit)

**Input signal:** user just submitted a prompt to the agent.

**Behavior:**
1. Quick LLM check (cheap model, e.g. Haiku 4.5 via `aishaLlmRouter`):
   "Does this prompt suggest a non-best-practice approach? (e.g. quick hack,
   skip tests, ignore RLS)" → boolean + 1-line note.
2. If yes: return `{advisory: "⚠️ AISHA Advisor: <note>. Tvoje rozhodnutí.", decision: "allow"}`.
3. If no: return `{advisory: "", decision: "allow"}` (silent — no flooding).

**Never** return decision != allow on user prompts — user has priority.

### 3. `compliance_pre_check` (PreToolUse)

Optional — primary defense is local Vrstva 1 hooks (`aisha-advise-*.sh`).
Backend pre-check is for cases that need DB context (e.g. checking if a file
path the agent wants to edit is referenced by a published rule binding).

**Behavior:**
1. Inspect `tool_input` (file_path for Edit/Write, command for Bash).
2. Optional: query `expert_rules` JOIN `expert_rule_subscriptions` for any
   rule subscribed to this story that flags the target.
3. Return advisory if flagged; otherwise silent.

### 4. `compliance_enforcement` (PostToolUse)

**Input signal:** agent just finished a tool call (Edit / Write / MultiEdit / Bash).

**Behavior:**
1. Inspect `tool_output` for failure signals (TS errors, test failures).
2. If `tool_input.file_path` matches story scope: run a deeper diff check
   against ruleset:
   - For each rule in `story_rulesets.rule_ids`, evaluate ai_instructions vs
     the new content (LLM scoring, low temperature).
   - Detected violations → assemble advisory with rule slugs + file:line.
3. Return `{advisory: "<advisory text>", decision: "allow"}`.
4. Optional: insert into `dirigent_nudges` with severity='warn' so the next
   Stop event also surfaces this.

### 5. `goal_evaluator` (Stop) ⭐ Critical

**Input signal:** Claude Code agent thinks it's done with the turn.

**This is the ONLY playbook that may return `decision: "block"` or `"ask"`.**

**Behavior:**
1. Load `story_goal_state` for the story:
   ```sql
   SELECT acceptance_criteria, loop_iterations, loop_max
   FROM story_goal_state WHERE story_id = $1;
   ```
2. If `loop_iterations >= loop_max`: return
   `{decision: "ask", reason: "Story autonomous loop reached cap (12 iterations). Please review manually.", advisory: "..."}`.
3. Compare transcript_excerpt + recent moderation_decisions (milestone_logs)
   against acceptance_criteria. Use LLM (mid-tier model, e.g. Sonnet) to
   score each criterion: met / partial / missing, with evidence quote.
4. **Persist** the evaluation:
   ```sql
   UPDATE story_goal_state SET
     last_evaluated_at = now(),
     loop_iterations = loop_iterations + 1,
     fingerprint = <new hash>,
     last_evaluator_output = <jsonb>
   WHERE story_id = $1;
   ```
5. **Decide**:
   - All criteria met → `{decision: "allow", advisory: "✅ Goal reached."}`.
   - One or more missing → `{decision: "block", reason: "Story criterion <X>/N not met: <text>. Doporučený směr: <action>. Toto není pokyn — popřemýšlej a pokračuj."}`.
6. **Loop budget guard:** if same criterion has been "missing" 3 evaluations
   in a row without progress evidence, escalate to `decision: "ask"` instead
   of "block" — prevents infinite loops on stuck criteria.

**Output for the agent**: the `reason` text becomes the next instruction
the agent reasons about. Phrase it as expert observation, NOT as a code
patch. Examples:

✅ Good: "Acceptance criterion 4/5 (RLS policy) chybí. Tabulka mcp_evidence
   nemá CREATE POLICY. Zvažte přidání policy_member_read; mcp_get_story_context
   ti vrátí story.tech_stack pokud je třeba scope."

❌ Bad: "Run `CREATE POLICY policy_member_read ON mcp_evidence ...` then
   commit." (This crosses into prescription — keep at expert observation.)

## Adding a new playbook

1. Add a new branch in `dirigent_dispatch_event` SQL function (`CASE p_event_name`).
2. Update the `Required playbooks` table above.
3. Create the n8n workflow `WF_DIRIGENT_<PLAYBOOK>.json`:
   - Webhook trigger at `/webhook/dirigent/<playbook>` (path is what edge fn calls).
   - Authentication: header `X-N8N-API-Key` (read from edge fn env `N8N_API_KEY`).
   - Sub-workflow that does the work; respond in <3s.
   - Final node: respond with the contract JSON.
4. Test with `curl -X POST https://n8n.aisha.guru/webhook/dirigent/<playbook> -H 'X-N8N-API-Key: ...' -d '{"event":"...","story_id":"..."}'`.

## Cold-start parity (per [feedback_cold_start.md](../../docs/))

When the n8n webhook URL is empty or unreachable, the edge fn returns 200
with `{}`. The relay hook then exits silently and the agent proceeds without
advisory. Vrstva 1 local hooks remain active and provide the regex-based
safety net.

This means the supervisor stack is **fail-open** by design:
1. Local hooks (no network) — always work.
2. Edge fn (Supabase) — works without n8n.
3. n8n playbooks — additive deep advisory; their absence does not block work.

Each layer can be deployed and tested independently. n8n playbooks SHOULD
be enabled last, after edge fn + DB schema are stable.

## Verification

Before declaring deploy complete:

1. **Edge fn smoke test** (no n8n):
   ```bash
   curl -X POST https://api.aisha.guru/dirigent/dispatch \
     -H "Authorization: Bearer $AISHA_MCP_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"event":"session_start","session_id":"test"}'
   # Expect: 200 {} or {"additionalContext": "..."}
   ```

2. **Hook relay smoke test** (no token = cold start):
   ```bash
   AISHA_MCP_TOKEN= node .claude/hooks/aisha-supervisor-relay.mjs session_start
   echo "exit=$?"  # expect 0, no output
   ```

3. **End-to-end pilot** (story with explicit acceptance_criteria):
   - Start a Claude Code session in this repo with `.aisha/story.json` set.
   - Watch SessionStart additionalContext for the briefing.
   - Make a small change that violates RPC-only law → see local advisory.
   - Run a Stop → see goal_evaluator decision (block if criteria unmet).

## Related files

- Edge fn: [services/svc-ai-chat/src/routes/dirigent-supervisor.ts](../../services/svc-ai-chat/src/routes/dirigent-supervisor.ts)
- Migration: [aisha/db/migrations/20260501000000_dirigent_supervisor.sql](../../aisha/db/migrations/20260501000000_dirigent_supervisor.sql)
- Local advisory hooks: [.claude/hooks/aisha-advise-*.sh](../../.claude/hooks/)
- Tests: [src/tests/architecture/aisha-advisory-hooks.test.ts](../../src/tests/architecture/aisha-advisory-hooks.test.ts)
- Subagent: [.claude/agents/aisha-advisor.md](../../.claude/agents/aisha-advisor.md)
- Plan: `~/.claude/plans/dukladn-emi-prosim-zanalyzuj-splendid-pizza.md`
