# Critic loop runbook — Phase 12 WP 4.1

> **Snapshot 2026-05-20**. Owner: Backend + RAG quality.
> **Status**: State machine + telemetry + audit RPC shipped (migrations
> `20260518250000_critic_loop.sql` + `20260519010000_critic_iteration_updates_ai_run.sql`).
> This runbook covers the per-profile rollout that an operator drives
> after merge.

## TL;DR — Verify → reflect → retry

For every chat turn where the active `context_profile` has
`critic_enabled = true`, AISHA scores the retrieved context's
faithfulness via an LLM-as-judge. If the score is below threshold AND
the iteration cap isn't reached, the system **re-retrieves** with a
strategy variation and tries again.

```
                   ┌──── strategy variation ←─────┐
                   ↓                              │
chat turn → retrieve → score (judge LLM) → decision?
                                              │
                                ┌─────────────┴────────────┐
                                ↓                          ↓
                          stop_threshold_met        stop_iter_cap
                          (score ≥ threshold)       (max iterations)
                                ↓                          ↓
                          best context returned        best context returned
                          to LLM for reply             (degraded — operator review)
```

This is the **"capability-applied evolution"** pattern (per
`feedback_aisha_capability_applied_not_new`):
- No new tables / RPCs (the table + 2 RPCs were shipped in migration
  20260518250000).
- Reuses existing `enrichWithAishaContext` for re-retrieval.
- Reuses existing `unifiedChat` for the judge LLM call.
- Reuses existing `aisha_resolve_clow_backend` (purpose=`rag.critic_judge`)
  for judge backend selection.
- Records every iteration via existing
  `fn_record_critic_iteration_audited`.

## §1 What's already shipped

| Layer | Artefact | Status |
|---|---|---|
| Schema | `ai_run_critic_iterations` table + 4 cols on `context_profiles` | ✅ migration 20260518250000 |
| Schema | `ai_runs.faithfulness_score_estimate` propagation on terminal decisions | ✅ migration 20260519010000 |
| RPC | `fn_get_critic_config(profile_slug)` — STABLE config lookup | ✅ |
| RPC | `fn_record_critic_iteration_audited(...)` — per-iteration log + faithfulness propagation | ✅ |
| Lib | `services/svc-ai-chat/src/lib/criticLoop.ts` — state machine (512 lines) | ✅ |
| Route | `services/svc-ai-chat/src/routes/chat.ts` invokes `runCriticLoop()` | ✅ |
| Gate | `wp-4-1-critic-loop.gate.test.ts` (this PR) | ✅ |
| Runbook | This document (this PR) | ✅ |

## §2 Strategies (in implementation)

The 4 strategies declared in `ai_run_critic_iterations.retrieval_strategy`:

| Strategy | Status | What it does |
|---|---|---|
| `expand_tags` | ✅ live | LLM-generated query expansion — appends synonyms / related-term keywords to next compose_context call |
| `switch_profile` | ✅ live | Changes `contextProfile` (e.g. `chat_default` → `evidence_strict`) to broaden ruleset + KB depth |
| `broaden_threshold` | ⚠ deferred | Needs `p_similarity_threshold_override` on `compose_context` — skipped if listed in config (recorded as `continue` with metadata note) |
| `add_kb_layer` | ⚠ deferred | Needs `story_routing_config` override — skipped same way |

The two deferred strategies degrade gracefully — the iteration still
fires + the lib logs a metadata note explaining the skip. **No runtime
error**, no infinite loop.

## §3 Cost model (per chat turn)

The plan's SLO: cost-with-loop ≤ **2.5× single-pass baseline**.

Per chat turn:

| Phase | Iterations | Cost |
|---|---|---|
| Single-pass (no critic) | 1× retrieval + 1× LLM reply | baseline |
| Critic loop, ideal case (1st iteration passes threshold) | 1× retrieval + 1× judge + 1× LLM reply | ~1.5× |
| Critic loop, worst case (3 iterations to max cap) | 3× retrieval + 3× judge + 1× LLM reply | ~2.5× |

The judge call is **smaller** than the main LLM reply — it's a
"score this context's faithfulness" classifier, ~50-100 output tokens.
That's why the cost multiplier stays at 2.5× and not 4-5×.

### Per-tenant cost cap

The critic loop's runaway-cost risk is **bounded by WP 2.3 LLM quota**.
Even if a confused critic looped 3× for every turn, the per-tenant
daily token cap (default 50K tokens / $0.50 for `free` tier — see
`llm_tier_defaults` in WP 2.3 runbook) kicks in before damage scales.
That's the belt-and-braces approach: critic loop has its own hard
iteration cap (`critic_max_iterations` ≤ 10 per CHECK constraint), AND
the per-tenant quota catches edge cases.

## §4 Per-profile rollout (operator)

The critic loop is **opt-in per `context_profile`**. To enable for a
specific profile:

```sql
UPDATE context_profiles SET
  critic_enabled = true,
  critic_threshold = 0.85,           -- score ≥ 0.85 = "good enough"
  critic_max_iterations = 3,         -- hard cap, ≤ 10 by CHECK
  critic_strategies = ARRAY['expand_tags', 'switch_profile']::text[]
WHERE slug = 'evidence_strict';
```

Recommendations:

| Profile use case | Recommended config |
|---|---|
| `evidence_strict` (legal, compliance, citations required) | `enabled=true, threshold=0.85, max=3, strategies=[expand_tags, switch_profile]` |
| `retrieval_default` (general Q&A) | `enabled=true, threshold=0.80, max=2, strategies=[expand_tags]` |
| `chat_default` (casual chat, low-stakes) | `enabled=false` (cost > value) |
| `prototype` / experimental | `enabled=true, threshold=0.75, max=1, strategies=[expand_tags]` |

### Rollout sequence (operator)

1. **Pre-flight**: pick **one** low-risk profile to pilot (suggest
   `evidence_strict` — most-measured by RAGAS nightly per WP 1.6).
2. Run the SQL above for that profile only.
3. **Wait 24 hours**. Read `WF_RAG_EVAL_NIGHTLY` regression-detection
   output (WP 1.6):
   - `severity = ok` → continue
   - `severity = warning` → investigate; look at `metadata` JSON in
     `ai_run_critic_iterations` for the iteration that judged below
     threshold
   - `severity = critical` → revert (set `critic_enabled = false`)
4. **Day 2-7**: if pilot stays green, enable on `retrieval_default` +
   2 more profiles. Continue daily monitoring until all chosen
   profiles are on or explicitly opted-out.

## §5 Observability

### Per-turn diagnostics

```sql
-- Last 50 critic loop iterations
SELECT
  ai_run_id,
  iteration,
  decision,                          -- 'continue' | 'stop_threshold_met' | 'stop_iter_cap'
  faithfulness_estimate,
  context_recall_estimate,
  retrieval_strategy,                -- 'initial' | 'expand_tags' | 'switch_profile' | ...
  judge_model,
  judge_provider_slug,
  created_at
FROM ai_run_critic_iterations
ORDER BY created_at DESC
LIMIT 50;
```

### Cost tracking

The audit RPC writes to `audit_journal` on every iteration. Cumulative
per-day judge-call cost:

```sql
SELECT
  COUNT(*) AS iterations_today,
  COUNT(*) * 0.0001 AS approx_judge_cost_usd  -- ~100 tokens output @ haiku rate
FROM ai_run_critic_iterations
WHERE created_at >= current_date;
```

### Threshold tuning

After 7 days of telemetry, decide if `critic_threshold` needs to move.
The signal:

```sql
SELECT
  retrieval_strategy,
  AVG(faithfulness_estimate) AS avg_score,
  COUNT(*) FILTER (WHERE decision = 'stop_threshold_met') AS passed,
  COUNT(*) FILTER (WHERE decision = 'stop_iter_cap') AS hit_cap,
  COUNT(*) AS total
FROM ai_run_critic_iterations
WHERE created_at >= now() - interval '7 days'
GROUP BY retrieval_strategy
ORDER BY total DESC;
```

If `stop_iter_cap / total > 30%`, the threshold may be too aggressive
(loop is doing 3 iterations and still failing). Consider lowering
`critic_threshold` from 0.85 → 0.80 for that profile.

If `stop_threshold_met / total > 95%` after 1st iteration, the
threshold may be too lenient (critic isn't catching anything).
Consider raising 0.85 → 0.90.

## §6 Rollback

### Per-profile (instant)

```sql
UPDATE context_profiles SET critic_enabled = false WHERE slug = '<profile>';
```

Effective immediately — next chat turn for that profile skips the
critic loop entirely.

### Stack-wide (nuclear)

```sql
UPDATE context_profiles SET critic_enabled = false;
```

All profiles revert to baseline single-pass retrieval. No data loss —
`ai_run_critic_iterations` history retained for forensic analysis +
re-enablement decision.

### Service-level (rare)

If the critic loop lib itself misbehaves (e.g. infinite loop bug
escapes the CHECK constraint), set the global runtime feature flag:

```bash
# In Coolify env for svc-ai-chat
CRITIC_LOOP_DISABLED=true
```

The route's `runCriticLoop()` call site should honor this env (lib
behavior). If it doesn't yet — that's a follow-up fix tracked as
WP 4.1b. Current rollback path is "set critic_enabled = false for all
profiles via SQL".

## §7 Operational guards

### Guard 1: Hard iteration cap (CHECK constraint)

`context_profiles.critic_max_iterations` has `CHECK (BETWEEN 1 AND 10)`.
Even if an operator sets `critic_max_iterations = 100` by accident,
the DB rejects the UPDATE. **Database-enforced** — not application logic.

### Guard 2: Bounded threshold

`critic_threshold` has `CHECK (BETWEEN 0 AND 1)`. Can't set it negative
(loop never terminates) or above 1 (loop always hits cap).

### Guard 3: Idempotent telemetry write

`fn_record_critic_iteration_audited` uses `ON CONFLICT (ai_run_id,
iteration) DO UPDATE`. Multiple worker retries on the same iteration
don't double-log. Cost projection in §3 stays accurate.

### Guard 4: Terminal decision propagates faithfulness

When the iteration's `p_decision LIKE 'stop_%'`, the RPC also UPDATEs
`ai_runs.faithfulness_score_estimate`. This is the data feed for the
WP 1.5 Faithfulness UI panel — operator sees the final scored value
without re-running the judge.

### Guard 5: Per-tenant quota safety net (WP 2.3)

Even if every guard above fails, **WP 2.3 LLM quota** caps damage at
the tier's daily token budget. The critic loop is one consumer of the
budget — runaway loops would burn through the user's daily allowance
in minutes and then 429-block, not bill unlimited dollars to your card.

## §8 Related WPs

- **WP 1.5** Faithfulness UI panel — reads
  `ai_runs.faithfulness_score_estimate` populated by the critic loop's
  terminal `UPDATE` on `stop_threshold_met` / `stop_iter_cap`.
- **WP 1.6** RAGAS nightly — measures the quality LIFT of the critic
  loop vs baseline single-pass retrieval. Run before enabling per
  profile + 24h after, compare composite_avg deltas.
- **WP 2.3** LLM token rate limit per JWT.sub — per-tenant safety net.
  Critical for any LLM feature that could loop (this WP) or fan out
  (RAG eval, contextual prefix backfill).
- **WP 3.2** Prompt injection guard — quarantine_status NOT IN
  ('flagged', 'quarantined') filter applies to retrieval inside every
  iteration of the critic loop, so injected chunks stay out even if
  the critic happens to find them "relevant".

## §9 References

- Plan §-1.12 §4.1 — original WP 4.1 spec
- Migration `aisha/db/migrations/20260518250000_critic_loop.sql`
  (table + 4 context_profile columns + initial RPC)
- Migration `aisha/db/migrations/20260519010000_critic_iteration_updates_ai_run.sql`
  (faithfulness propagation to ai_runs)
- Lib `services/svc-ai-chat/src/lib/criticLoop.ts` (state machine)
- Route `services/svc-ai-chat/src/routes/chat.ts` (invocation site)
- RPCs `aisha/db/sql/functions/fn_get_critic_config.sql` +
  `fn_record_critic_iteration_audited.sql`
- Gate test `src/tests/gates/wp-4-1-critic-loop.gate.test.ts`
- `feedback_aisha_capability_applied_not_new` — this runbook documents
  + locks the EXISTING capability, doesn't introduce new infrastructure
