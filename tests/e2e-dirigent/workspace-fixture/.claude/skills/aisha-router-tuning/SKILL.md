---
name: aisha-router-tuning
description: Tune AISHA's Soulforge slot routing + Dirigent router-coach advisory + LLM Gateway profile. Use when developer wants to switch slot profile (budget/balanced/maxQuality), debug rolling cost in dev session, configure ANTHROPIC_BASE_URL for IDE proxy through gateway, or understand why a generation went to a specific slot/model. Triggers on "router config", "switch profile", "cost dashboard", "slot mapping", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "gateway.aisha.guru", "router-coach", "session cost".
---

# AISHA Router Tuning Skill

Routing v AISHA stacku má 4 nezávislé vrstvy. Tento skill je mapou kde co žije a jak se to ladí.

## Vrstvy (žádná není povinná)

```
1. Tier system     — existing, model-by-complexity   (MODEL_TIER_*)
2. Soulforge slot  — orthogonal slot×tier matrix     (ai_model_registry.slot_affinity)
3. Profile         — budget|balanced|maxQuality      (.aisha/dirigent.json routerCoach)
4. Batch routing   — sync vs deferred (50% off)      (aisha_choose_execution_strategy)
```

Vrstvy jsou **multiplikativní**: tier × slot × profile × batch určují finální model.

## Slot semantics (Soulforge konvence)

| Slot | Co | Doporučený model |
|---|---|---|
| `spark` | Read/explore, krátké dotazy | `gemini-2.5-flash` (cheap) |
| `ember` | Code edits, writes | `claude-haiku-4-*` (mid) |
| `verify` | Review, test, audit | `claude-sonnet-4-*` (premium) |
| `compact` | Summarize, condense | `gemini-2.5-flash` |
| `semantic` | Analyze, explain, evaluate | `claude-haiku-4-*` (mid) |
| `webSearch` | Lookup, search web | `gemini-2.5-flash` |
| `desloppify` | Cleanup, format, lint | `gemini-2.5-flash` |
| `default` | Fallback na existing tier logic | (resolved by tier) |

Změnit mapping per-slot: `SELECT set_slot_model_mapping('spark', 'moderate', 'gemini-2.5-flash')` (admin-only).
Číst aktuální mapping: `SELECT * FROM get_slot_routing_table()`.

## Profile mapping

| Profile | Cíl | Override |
|---|---|---|
| `budget` | Maximum úspora | force cheapest model in slot |
| `balanced` (default) | Rozumný kompromis | matrix default |
| `maxQuality` | Důvěra > cena | force premium model in slot |

Změna pro dev session: `/aisha-router-config` (slash command, interactive).
Změna pro autonomous AISHA per-task: `aisha_choose_execution_strategy` rozhoduje dynamicky podle `budget_remaining_usd` + `criticality`.

## IDE napoj — ask / Omni (governed model face)

Kanonická cesta pro IDE = **`ask.<tld>/v1`** (governed, path ①), klíč = **PAT** (`mcp_…`). NE `gateway.aisha.guru` (retired — AISHA_OMNI_GATEWAY.md §0.6).
```bash
export ANTHROPIC_BASE_URL=https://ask.aisha.guru/v1
export ANTHROPIC_AUTH_TOKEN=mcp_…
# Pro Codex / OpenAI SDK:
export OPENAI_BASE_URL=https://ask.aisha.guru/v1
export OPENAI_API_KEY=mcp_…
```
`llm-gateway` (theopenco) je interní driver (`public:false`, `http://llm-gateway:4000/v1`), ne veřejná IDE tvář.

Backend (svc-ai-chat) volá providers **přímo** (žádný gateway hop). Gateway je čistě IDE-side capability + batch endpoint passthrough.

## Dirigent router-coach

Advisory-only hook v `.claude/hooks/migration-sot-pair-check.sh` (konsolidováno — žádný separátní hook). Při každém PostToolUse:
1. Loguje tool use do `.aisha/session-cost.jsonl` (sc_log_tool)
2. Emit stderr advisory: aktuální cost vs threshold (sc_advise)
3. Pokud cost > $0.50 → suggest switch na `budget` profile

Threshold se nastavuje v `.aisha/dirigent.json`:
```json
{
  "routerCoach": {
    "enabled": true,
    "costThresholdUsd": 0.50,
    "slotProfile": "balanced"
  }
}
```

DB-side analysis pro deeper insights:
```sql
SELECT fn_advise_session_router('<session_id>', '<recent_tool_uses_jsonb>');
```
Vrátí `read_ratio`, `rolling_cost_usd`, `suggested_slot`, `suggested_profile`, `suggested_model`, `batch_eligible_count`.

## Batch routing (50% off)

AISHA dynamicky rozhoduje sync vs batch via `aisha_choose_execution_strategy`:
- `deadline_hours >= 24` && `expected_tokens >= 50000` → batch
- `criticality = critical` → vždy sync (batch blacklisted)
- Batch jde do `ai_batch_jobs` table; `WF_BATCH_POLLER` poll-uje každých 15min

Smoke check ai_batch_jobs status:
```sql
SELECT provider, status, request_count, submitted_at FROM ai_batch_jobs ORDER BY submitted_at DESC LIMIT 10;
```

## Kdy přepnout co

| Symptom | Akce |
|---|---|
| Rolling cost > $0.50 v sesion | `/aisha-router-config` → budget profile |
| Příliš pomalé generace | profile → maxQuality, nebo provider switch |
| Time-sensitive task (deadline < 1h) | nepřepínat na batch — AISHA to už blacklistuje |
| Long audit / report task | nech AISHA rozhodnout → batch automaticky 50% off |
| Want to track dev IDE cost | Set `ANTHROPIC_BASE_URL` → gateway → Langfuse trace |
| Slot routing wrong | Inspect `SELECT * FROM get_slot_routing_table()`; admin upravi přes `set_slot_model_mapping` |

## Reference

- DB: `aisha_choose_execution_strategy`, `fn_advise_session_router`, `recommend_slot_for_task`, `get_slot_routing_table`, `set_slot_model_mapping`
- TS: `services/svc-ai-chat/src/reflection/soulforge.ts` (classifier + optimizer), `lib/orchestrationBridge.ts` (autopilot decision wrapper), `lib/batchSubmitter.ts` (batch HTTP)
- Hooks: `.claude/hooks/migration-sot-pair-check.sh` (router-coach merged in), `.claude/lib/session-cost.sh` (shared lib)
- Dashboard: Langfuse (existing) — gateway forwarduje traces here, NE vlastní dashboard
- Slash cmd: `/aisha-router-config`
