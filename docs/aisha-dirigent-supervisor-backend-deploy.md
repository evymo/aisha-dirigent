# AISHA Dirigent Supervisor — Backend Deploy & Ops Checklist

> Companion to the in-repo Claude Code overlay (Phase A + B + C-thin) and to
> [docs/architecture/dirigent-overlay-pipeline.md](architecture/dirigent-overlay-pipeline.md).
> Lists exactly what needs to happen on AISHA's production backend (DB,
> svc-ai-chat, n8n) for the supervisor's full functionality to come online.
>
> **Audience:** AISHA Dirigent admin / DevOps. The Claude Code overlay side is
> deploy-free — clone the repo, open it, advisory hooks fire immediately. This
> document covers Vrstva 2 (HTTP advisory relay → svc-ai-chat → n8n playbooks)
> and the autonomous Stop-loop continuation.

---

## 0. Live production verification (run before deploy)

The deploy steps below assume nothing is wired up yet. Verify by curling
production:

```bash
# Should respond {"status":"ok"} (svc-ai-chat health, always wired)
curl -sf https://api.aisha.guru/health

# All 3 should return 404 BEFORE deploy, 200/400 AFTER:
curl -s -X POST https://db.aisha.guru/rpc/mcp_consult_dirigent \
  -H "Content-Type: application/json" -d '{"p_situation":"smoke"}'
curl -s -X POST https://db.aisha.guru/rpc/mcp_get_claude_hook_bindings \
  -H "Content-Type: application/json" -d '{}'
curl -s -X POST https://db.aisha.guru/rpc/dirigent_drain_nudges \
  -H "Content-Type: application/json" -d '{}'

# Should return 404 BEFORE deploy, 200/401 AFTER:
curl -s -X POST https://api.aisha.guru/dirigent/dispatch \
  -H "Content-Type: application/json" -d '{"event":"session_start"}'

# Should return 404 BEFORE deploy, 200 AFTER n8n import:
curl -s -X POST https://n8n.aisha.guru/webhook/dirigent/briefing \
  -H "Content-Type: application/json" -d '{"event":"session_start"}'
```

**Status as of 2026-05-24** (verified live):
- `api.aisha.guru/health` → 200 ✅ (svc-ai-chat running)
- 3 RPCs above → **404** (migrations NOT deployed)
- `/dirigent/dispatch` → **404** (route built in branch, not yet deployed)
- n8n webhooks → **404** (WF JSON files in repo, not yet imported)

Until the steps below execute, the Claude Code overlay still works
(Vrstva 1 advisory hooks fail-open; no backend round-trip needed for the 5
seeded regex rules).

---

## 1. Status matrix — what works today vs. what needs deploy

| Capability | Layer | Status today (clean clone) | What's needed |
|---|---|---|---|
| **Real-time regex advisory** (5 rules: rpc-only, no-console, no-any, ts-ignore, select-star + 2 static heuristics: i18n, bash-risk) | Vrstva 1 local hooks | ✅ **WORKS** clone-to-ready | none |
| **Cooldown** (45s per rule per session) | Vrstva 1 local | ✅ WORKS | none |
| **Read-only review subagent** (`aisha-advisor`) | Vrstva 3 (Task tool) | ✅ WORKS | none |
| **Statusline** (branch + story + supervisor mode) | Claude Code | ✅ WORKS | none |
| **Skill** `aisha-supervisor` + 3 slash commands (`/aisha-advise`, `/aisha-supervise`, `/aisha-cooldowns`) | Claude Code | ✅ WORKS | none |
| **VS Code extension copilot watcher** (live `mcp_get_claude_hook_bindings` cache → regex eval → toast/chat hint) | Vrstva 1 in-extension | ⚠️ FALLS BACK to bundled JSON mirror | DB migration (Step 1) |
| **HTTP relay SessionStart brief** | Vrstva 2 (svc-ai-chat route → n8n) | ❌ FAIL-OPEN (404 ATM) | Steps 1 + 2 + 3a |
| **HTTP relay PostToolUse semantic check** | Vrstva 2 + n8n | ❌ FAIL-OPEN | Steps 1 + 2 + 3c |
| **Stop hook autonomous loop continuation** ⭐ | Vrstva 2 + n8n `goal_evaluator` | ❌ NOT YET | Steps 1 + 2 + 3e |
| **Async nudges from backend → agent** | DB + svc-ai-chat drain | ❌ NOT YET | Steps 1 + 2 |
| **`mcp_consult_dirigent`, `_request_unblock`, `_report_milestone`, `_propose_improvement` RPCs** | DB (callable directly via PostgREST) | ❌ NOT YET (404) | Step 1 |

**Cold-start parity:** when nothing in the right column is deployed, the
Claude Code overlay still works in advisory-only mode (Vrstva 1 hooks +
bundled JSON binding mirror). Advanced behaviors degrade silently to no-op.

---

## 2. Architecture diff vs. original 2026-05-23 plan

The original `docs/architecture/dirigent-overlay-pipeline.md` (rev 1) listed
Vrstva 2 as a Supabase Edge Function (`supabase/functions/dirigent-supervisor`).
**This branch implements it differently** — as a Fastify route inside the
existing `svc-ai-chat` service, mounted at `POST /dirigent/dispatch`. Rationale:

- Shares the existing Fastify infrastructure (verifyToken, SSRF guard,
  audit log, structured logging) instead of duplicating in Deno
- No separate Supabase function deploy needed — rides on the
  `svc-ai-chat` Docker image redeploy
- Same auth chain (Keycloak JWT via `verifyToken`) used elsewhere

Original Vrstva 4 (Error Memory / LocalDecision / EscalationPacket in
extension) was **removed via commit 28a14132** because audit showed all 3
modules duplicated backend brain (`agent_memories`, `governedOrchestration`,
`unifiedChat`, `fn_log_dev_signal`, `ai_trace_events`, `dirigent_nudges`).
Extension now stays thin: sensor → rules-engine cache → fn_log_dev_signal
emit. Backend composes decisions.

---

## 3. Deploy steps (in order)

### Step 1 — Apply 3 DB migrations to Dirigent Postgres

Three migrations are required:

| File | Adds |
|---|---|
| `aisha/db/migrations/20260501000000_dirigent_supervisor.sql` | `dirigent_nudges`, `story_goal_state` tables + 5 RPCs (`mcp_consult_dirigent`, `_request_unblock`, `_report_milestone`, `_propose_improvement`, `dirigent_dispatch_event`) |
| `aisha/db/migrations/20260524000000_claude_hook_bindings.sql` | `claude_hook_bindings` table + `mcp_get_claude_hook_bindings` RPC + seed of 5 regex rules |
| `aisha/db/migrations/20260524010000_dirigent_drain_nudges.sql` | `dirigent_drain_nudges` RPC (atomic `FOR UPDATE SKIP LOCKED` queue drain) |

Use the project's standard tooling:

```bash
# Local first (cold-start parity test):
npm run db:migrate:local
npm run db:types:gen:local

# Verify locally:
psql "$LOCAL_DB_URL" -c "
  SELECT proname FROM pg_proc
  WHERE proname IN (
    'mcp_consult_dirigent','mcp_request_unblock','mcp_report_milestone',
    'mcp_propose_improvement','dirigent_dispatch_event',
    'mcp_get_claude_hook_bindings','dirigent_drain_nudges'
  ) ORDER BY proname;
"   # expect 7 rows

psql "$LOCAL_DB_URL" -c "
  SELECT rule_slug, hook_event, severity FROM public.claude_hook_bindings
  ORDER BY rule_slug;
"   # expect 5 rows: no-any, no-console, rpc-only, select-star, ts-ignore

# Production: apply via the project's deploy pipeline
#   (n8n WF_AISHA_DB_MIGRATIONS_APPLY or manual psql against db.aisha.guru
#   service_role). DO NOT skip table-level checks below.
```

**Post-deploy production verification** (curl against `db.aisha.guru`):

```bash
# Anonymous read of bindings (RPC is SECURITY DEFINER, GRANTed to anon):
curl -sf -X POST https://db.aisha.guru/rpc/mcp_get_claude_hook_bindings \
  -H "Content-Type: application/json" -d '{}' | jq 'length'
# expect: 5

# Service-role consult (any-team, no story scope):
curl -sf -X POST https://db.aisha.guru/rpc/mcp_consult_dirigent \
  -H "Authorization: Bearer $AISHA_PG_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_situation":"smoke after deploy"}' | jq .

# Drain (should return empty array; 200 OK):
curl -sf -X POST https://db.aisha.guru/rpc/dirigent_drain_nudges \
  -H "Authorization: Bearer $AISHA_PG_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_conversation_id":null,"p_limit":10,"p_story_id":null}' | jq .
```

**Dependency check:** `dirigent_dispatch_event` calls `public.get_jwt_role()`
which is established baseline (used by `fn_build_ragnarok_document`, etc.).
Verify with `SELECT proname FROM pg_proc WHERE proname = 'get_jwt_role'`.

### Step 2 — Redeploy `svc-ai-chat` for `/dirigent/dispatch` route

The route lives at
[services/svc-ai-chat/src/routes/dirigent-supervisor.ts](../services/svc-ai-chat/src/routes/dirigent-supervisor.ts).
It is registered in `services/svc-ai-chat/src/server.ts` and ships with the
existing Docker image.

```bash
# Build + push container (standard svc-ai-chat release flow):
docker build -t aisha/svc-ai-chat:dirigent-supervisor services/svc-ai-chat
docker push aisha/svc-ai-chat:dirigent-supervisor

# In Coolify: bump svc-ai-chat image tag → redeploy.
# Or via n8n: trigger WF_DEPLOY_SVC_AI_CHAT with new tag.
```

**Required env** (already in `.env.coolify.example`, just confirm):
- `AISHA_GATEWAY_URL` — e.g. `https://n8n.aisha.guru`
- `AISHA_MCP_TOKEN` — bearer the relay sends in `Authorization: Bearer …`
- `AISHA_POSTGREST_URL` + `AISHA_POSTGREST_SERVICE_KEY` — already wired
- Keycloak JWKS env — already wired (verifyToken)

**Post-deploy smoke** (no auth → should return 401, not 404):

```bash
curl -i -X POST https://api.aisha.guru/dirigent/dispatch \
  -H "Content-Type: application/json" \
  -d '{"event":"session_start","session_id":"smoke"}'
# HTTP/1.1 401 Unauthorized  ← good: route exists, auth required

# With valid token:
curl -i -X POST https://api.aisha.guru/dirigent/dispatch \
  -H "Authorization: Bearer $AISHA_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"session_start","session_id":"smoke"}'
# HTTP/1.1 200 OK
# {"additionalContext":""} or {"additionalContext":"<brief from n8n>"}
```

### Step 3 — Import 5 n8n playbooks

JSON files are committed in [n8n/workflows/](../n8n/workflows/):

| Workflow | Triggers on event | Priority |
|---|---|---|
| `WF_DIRIGENT_BRIEFING.json` | `session_start` | 1 (UX) |
| `WF_DIRIGENT_INTENT_ADVISOR.json` | `pre_prompt` | 4 |
| `WF_DIRIGENT_COMPLIANCE_PRE_CHECK.json` | `pre_tool` | 5 (optional) |
| `WF_DIRIGENT_COMPLIANCE_ENFORCEMENT.json` | `post_tool` | 3 |
| `WF_DIRIGENT_GOAL_EVALUATOR.json` | `stop` | 2 ⭐ unique value |

**Suggested rollout order:** 1 → 2 → 3 → 4 → 5. Goal evaluator first because
it's the unique value-add (autonomous goal pursuit). Other playbooks are
incremental improvements.

```bash
# Import via n8n CLI from a workstation that has gateway access:
for f in n8n/workflows/WF_DIRIGENT_*.json; do
  curl -fsS -X POST https://n8n.aisha.guru/api/v1/workflows/import \
    -H "X-N8N-API-Key: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary "@$f"
done

# Activate each in the n8n UI (idempotency: re-import overwrites).
```

**Each playbook MUST be activated** (status: Active) after import — webhook
trigger only listens when active.

**Post-import smoke** (no auth on the relay path — bearer is svc-ai-chat
internal):

```bash
# Each of the 5 webhook endpoints should respond 200 (with body, even if
# scaffold returns empty advisory):
for ev in briefing intent_advisor compliance_pre_check compliance_enforcement goal_evaluator; do
  echo -n "$ev: "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    "https://n8n.aisha.guru/webhook/dirigent/$ev" \
    -H "Content-Type: application/json" \
    -d '{"event":"smoke"}'
done
# expect: 200, 200, 200, 200, 200
```

### Step 4 — Set extension env on dev machines

The VS Code extension reads `AISHA_MCP_TOKEN` from process env. Without it,
relay no-ops (Vrstva 1 still works). With it, the extension can call
`mcp_get_claude_hook_bindings` live (instead of falling back to bundled
JSON mirror).

```bash
# Per-developer .zshrc / .bashrc:
export AISHA_MCP_TOKEN="<bearer-from-keycloak-service-account>"
export AISHA_GATEWAY_URL="https://api.aisha.guru"
```

The relay hook `.claude/hooks/aisha-supervisor-relay.mjs` reads the same env
when invoked by Claude Code agents. If unset → silent exit 0 (cold-start
parity preserved).

---

## 4. Smoke test the full chain (post-deploy)

```bash
# 1. Bindings cache (extension or CLI):
curl -s -X POST https://db.aisha.guru/rpc/mcp_get_claude_hook_bindings \
  -H "Content-Type: application/json" -d '{}' | jq '.[].rule_slug'
# expect 5 slugs: no-any, no-console, rpc-only, select-star, ts-ignore

# 2. Edge route end-to-end via svc-ai-chat:
curl -s -X POST https://api.aisha.guru/dirigent/dispatch \
  -H "Authorization: Bearer $AISHA_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"session_start","session_id":"smoke-e2e","story_id":null}' \
  | jq .
# expect: {"additionalContext":"..."} (could be empty if briefing returns null)

# 3. n8n goal_evaluator direct (bypassing svc-ai-chat):
curl -s -X POST https://n8n.aisha.guru/webhook/dirigent/goal_evaluator \
  -H "Content-Type: application/json" \
  -d '{"event":"stop","story_id":null,"transcript":"smoke"}' | jq .

# 4. Local Claude Code session:
AISHA_MCP_TOKEN=$TOKEN AISHA_GATEWAY_URL=https://api.aisha.guru claude
# In session: open this repo, run /aisha-supervise → should show 7 hooks
#   + relay active; SessionStart should print "additionalContext" if
#   briefing playbook returns one.

# 5. Hook fires (write a violation in editor):
#   const x: any = supabase.from("users").select("*")
#   → expect: 4 stderr lines from PreToolUse hooks (no-any, rpc-only,
#     select-star) — each ≤45s after the last fire (cooldown).
```

---

## 5. Optimization recommendations (post-deploy tuning)

### `mcp_get_claude_hook_bindings` caching

- Extension caches 60s in `rules-engine.ts` (in-memory LRU keyed by story_id).
- DB-side: RPC is read-only and SECURITY DEFINER; pg_stat_statements should
  show low cost. If hot path → add `pg_cron` to refresh a `materialized
  view mv_claude_hook_bindings_active` every 60s, point RPC at the MV.

### n8n `goal_evaluator` playbook (the critical one)

- **Model choice:** Use Haiku 4.5 (~500ms typical) for criterion scoring.
  Sonnet only if a criterion needs deep reasoning (rare).
- **Cache last evaluation by transcript hash** — skip LLM call if transcript
  hasn't changed since last Stop (agent looped without new actions).
- **Loop budget guard:** escalate `decision: "ask"` after 3 consecutive
  "missing" verdicts on the same criterion. Prevents runaway loops.
- **Response time budget:** target P95 < 2s (svc-ai-chat timeout is 4s,
  hook total is 8s). If LLM slow → return placeholder + queue follow-up
  nudge in `dirigent_nudges` for next Stop.
- **Acceptance criteria** in `story_goal_state.acceptance_criteria` should
  be structured, e.g.:
  ```jsonc
  [{ "id": "C1", "text": "RPC has SECURITY DEFINER", "met": false, "evidence": null }]
  ```
  Avoid free-text — LLM scoring is stable only with structured criteria.

### `svc-ai-chat /dirigent/dispatch` route

- **Parallelize:** `drainNudges()` and `callN8nPlaybook()` are independent.
  `Promise.all([])` instead of sequential. Saves ~50–200ms per Stop.
- **Connection pool:** module-level singleton PostgREST client (already
  the case in current implementation — verify on review).
- **Rate limiting:** Cap at 60 events/minute per `session_id` to prevent
  hook-storms (agent in tight Edit loop). Exceed → return 200 `{}` fail-open.

### `dirigent_nudges` table TTL cleanup

```sql
SELECT cron.schedule('dirigent-nudges-gc', '*/15 * * * *', $$
  DELETE FROM dirigent_nudges
  WHERE expires_at < now() AND consumed_at IS NULL;
$$);
```

### `moderation_sessions.metadata.hook_event_log`

- Current: jsonb ring buffer of last 50 events per session.
- Spin off a separate `hook_event_log` table once daily volume justifies
  it (analytics queries like "all session_start events last week").

---

## 6. What we DO NOT need on the backend (resist scope creep)

- **Real-time push to local Claude Code** — backend can't push to a CLI
  client. Use `dirigent_nudges` queue + Stop hook drain instead.
- **Per-tool-use deep checks beyond regex** — Vrstva 1 local hooks already
  cover the top rules. Backend semantic check (Vrstva 2 PostToolUse) is for
  cases that truly need DB context.
- **Block any decision beyond Stop loop continuation** — violates the
  advisory-only principle. Don't add `decision: "deny"` to any playbook
  except `goal_evaluator` returning `"continue"` (loop=true).
- **Duplicate brain in the extension** — `error-memory`, `local-decision`,
  `escalation-packet` modules were removed in commit 28a14132 because they
  shadowed `agent_memories`, `governedOrchestration`, `fn_log_dev_signal`
  + `ai_trace_events` + `dirigent_nudges`. Extension stays thin.

---

## 7. Rollback

| What to rollback | How |
|---|---|
| svc-ai-chat route | Coolify: previous image tag → redeploy |
| 5 n8n workflows | Deactivate in n8n UI (no DELETE needed; webhooks stop accepting traffic) |
| `dirigent_drain_nudges` RPC | `DROP FUNCTION public.dirigent_drain_nudges` (table-only deploy keeps queue rows) |
| `claude_hook_bindings` table + RPC | `DROP TABLE public.claude_hook_bindings CASCADE` — extension falls back to bundled JSON mirror automatically |
| `dirigent_nudges` + `story_goal_state` + 5 RPCs (20260501) | DROP TABLE + DROP FUNCTION; relay hook gets 404 → fail-open silent exit 0 |

Each layer is fail-open. Rollback is non-blocking for the agent surface;
worst case Vrstva 1 hooks remain active (already the case today).

---

## 8. Sequencing decision

**If you only have time for ONE migration window**, deploy in this order:

1. **Migrations** (Step 1) — unlocks live RPC + extension live binding fetch
2. **n8n WFs import** (Step 3) — they answer 200/empty until svc-ai-chat
   wires them; harmless to import before route lands
3. **svc-ai-chat redeploy** (Step 2) — this is the moment Vrstva 2 goes hot

Each independent. Goal evaluator (step 3e) is the unique-value moment.

---

## 9. References

- [Architecture pipeline](architecture/dirigent-overlay-pipeline.md) — single-page map
- [n8n playbook contracts](../n8n/workflows/README-dirigent-supervisor.md) — per-WF spec
- Migrations:
  - [20260501000000_dirigent_supervisor.sql](../aisha/db/migrations/20260501000000_dirigent_supervisor.sql)
  - [20260524000000_claude_hook_bindings.sql](../aisha/db/migrations/20260524000000_claude_hook_bindings.sql)
  - [20260524010000_dirigent_drain_nudges.sql](../aisha/db/migrations/20260524010000_dirigent_drain_nudges.sql)
- Route:
  - [services/svc-ai-chat/src/routes/dirigent-supervisor.ts](../services/svc-ai-chat/src/routes/dirigent-supervisor.ts)
  - Unit test: [dirigent-supervisor.unit.test.ts](../services/svc-ai-chat/src/tests/routes/dirigent-supervisor.unit.test.ts)
- Extension:
  - [rules-engine.ts](../extensions/aisha-dirigent/src/rules-engine.ts) (cache + evaluator)
  - [fetch-bindings.ts](../extensions/aisha-dirigent/src/generators/fetch-bindings.ts) (RPC + parse)
  - [copilot-watcher.ts](../extensions/aisha-dirigent/src/copilot-watcher.ts) (thin sensor)
- Hooks: `.claude/hooks/aisha-supervisor-relay.mjs` (template: [aisha-supervisor-relay.mjs.txt](../scripts/ide-adapters/templates/claude-overlay/aisha-supervisor-relay.mjs.txt))
