# Contextual retrieval runbook — Phase 12 WP 1.4

> **Snapshot 2026-05-20**. Owner: Backend + RAG quality.
> **Status**: Lib + RPC + schema shipped (migration 20260518210000).
> This runbook covers the cost-aware backfill rollout that an operator
> drives after merge.

## TL;DR — The Anthropic contextual chunking pattern

For each chunk in `knowledge_chunks`, ask a small LLM to produce a
1–2 sentence "context" about how the chunk sits within the parent
document. Prepend that prefix to the chunk text BEFORE embedding:

```
embedding_input = `${contextual_prefix} ${chunk_text}`
```

Anthropic measured **−67% retrieval failure rate** vs. embedding chunks
in isolation. The reason: a chunk like
`"Lhůta je 14 dní od převzetí."` in isolation gives no signal that it
belongs to contract CS-2024-082 with client Acme; the prefix carries
that signal into the embedding space, so semantic search disambiguates
between similarly-worded chunks across documents.

## §1 What's already shipped

| Layer | Artefact | Status |
|---|---|---|
| Schema | `knowledge_chunks` 5 contextual_prefix_* columns | ✅ migration 20260518210000 |
| RPC | `fn_enrich_chunk_context_audited` (SECURITY DEFINER, service-role-only, audit_journal write) | ✅ |
| Lib | `services/svc-mcp-knowledge/src/lib/contextual-prefix.ts` (generateContextualPrefix) | ✅ |
| Tests | `contextual-prefix.unit.test.ts` (happy + degradation paths) | ✅ |
| Route | `routes/knowledge-embeddings.ts` invokes generator + audit RPC | ✅ |
| Gate | `wp-1-4-contextual-retrieval.gate.test.ts` (this PR) | ✅ |
| Runbook | This document (this PR) | ✅ |

## §2 Cost model (per chunk)

| Phase | Tokens (typical) | Provider | Cost / chunk |
|---|---|---|---|
| Context-gen prompt | ~200 in + 50 out (haiku/qwen3-30b) | LLM | **$0.0003** |
| Re-embedding | ~200 in (Qwen3 self-host after WP 3.1, or OpenAI today) | Embedding | **$0.00002** |
| **Total per chunk** | | | **~$0.00032** |

Practical examples:

| Corpus size | One-time backfill cost | Walltime @ 5 chunks/sec |
|---|---|---|
| 10k chunks | ~$3 | 33 min |
| 100k chunks | ~$32 | 5.5 h |
| 1M chunks | ~$320 | 55 h (2.3 days) |

## §3 Budget gates (operator approval workflow)

Before backfill:

```sql
-- Count chunks needing prefix
SELECT COUNT(*) FROM knowledge_chunks WHERE contextual_prefix IS NULL;
```

Multiply by $0.00032 to estimate the dollar cost.

| Projected cost | Approval gate |
|---|---|
| < $50 | None — operator's discretion |
| $50 – $500 | Explicit cost approval from stack admin |
| > $500 | Cost-vs-quality review with RAGAS baseline measurement first (WP 1.6) |

The cost projection MUST be filed in `audit_journal` with action
`knowledge.contextual_backfill.budget_approved` before starting the
worker — this prevents the "I'll just kick it off and see" failure
mode that has cost orgs > $10k in surprise LLM bills.

## §4 Rate limit + walltime

The lib enforces no global rate limit — the ingestion route invokes it
per-batch. Operator-side rate control is via the **batch size** the
worker picks up:

- Default: 5 chunks / sec (single worker, default LLM provider)
- Burst: 20 chunks / sec (parallel workers, only if LLM provider
  rate-limit allows — most cloud LLMs cap at 50 RPS for the budget tier)
- During business hours: cap at 2 chunks/sec to leave headroom for
  interactive chat traffic

`knowledge_chunks.contextual_prefix_generated_at` is set on each
successful write — operator monitors progress via:

```sql
SELECT
  COUNT(*) FILTER (WHERE contextual_prefix IS NULL) AS pending,
  COUNT(*) FILTER (WHERE contextual_prefix IS NOT NULL) AS done,
  MAX(contextual_prefix_generated_at) AS last_write
FROM knowledge_chunks;
```

## §5 Rollout sequence (operator)

### Step 1: Pre-flight cost check (in `psql` against prod replica)

```sql
SELECT
  COUNT(*) AS chunks_needing_prefix,
  COUNT(*) * 0.00032 AS estimated_cost_usd,
  COUNT(*) / 5.0 / 60.0 AS estimated_walltime_minutes
FROM knowledge_chunks
WHERE contextual_prefix IS NULL;
```

### Step 2: File the budget approval (if cost > $50)

```sql
INSERT INTO audit_journal (user_id, action, metadata)
VALUES (
  auth.uid(),
  'knowledge.contextual_backfill.budget_approved',
  jsonb_build_object(
    'estimated_cost_usd', <number>,
    'chunks_to_process', <number>,
    'approved_by', '<stack-admin-email>',
    'rationale', '<one-sentence-why>'
  )
);
```

### Step 3: Kick off the worker

Worker is invoked by the existing ingestion route — no separate daemon.
For BACKFILL specifically (vs new-chunk ingest), the worker pattern is:

```sql
-- Mark a batch as in-flight (1000 chunks)
UPDATE knowledge_chunks
   SET contextual_prefix = '__IN_FLIGHT__'  -- sentinel
 WHERE id IN (
   SELECT id FROM knowledge_chunks
    WHERE contextual_prefix IS NULL
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
 );
```

Then the worker (running as the `svc-mcp-knowledge` container) picks
those up via the ingestion route's per-batch contextual-prefix loop.

Alternative: implement a dedicated `knowledge.contextual_backfill`
cron in n8n. See §-1.12 §1.6 R8 plan for the n8n RAGAS pattern that can
be adapted.

### Step 4: Monitor

Watch in real time:

```bash
watch -n 30 'psql -c "SELECT
  COUNT(*) FILTER (WHERE contextual_prefix IS NULL) AS pending,
  COUNT(*) FILTER (WHERE contextual_prefix IS NOT NULL AND contextual_prefix != '\'__IN_FLIGHT__'\'') AS done,
  COUNT(*) FILTER (WHERE contextual_prefix = '\'__IN_FLIGHT__'\'') AS in_flight
FROM knowledge_chunks;"'
```

Cost monitoring (cumulative from audit_journal — audit row written per
enrichment in `fn_enrich_chunk_context_audited`):

```sql
SELECT
  count(*) AS chunks_enriched_today,
  count(*) * 0.00032 AS cost_today_usd
FROM audit_journal
WHERE action = 'knowledge.chunk_context_enriched'
  AND created_at >= current_date;
```

## §6 Quality measurement

The backfill's purpose is to improve retrieval recall. The validation
pipeline:

1. **Before backfill**: run `WF_RAG_EVAL_NIGHTLY` (WP 1.6) to capture
   baseline `evidence_strict` faithfulness + answer_relevancy +
   context_precision + context_recall.
2. **After backfill**: re-run the nightly. Expected lift per Anthropic
   paper: **+0.05 composite_avg** (their measured 67% failure-rate
   reduction translates to ~5pp composite score).
3. **If lift < +0.03**: investigate. Possible causes:
   - LLM provider drift (qwen3-30b vs haiku output different)
   - Prefix prompt over-generic (tighten the prompt template)
   - Chunks already had sufficient context (less common; corpus-specific)

## §7 Rollback

### Per-chunk (cheap, surgical)

```sql
UPDATE knowledge_chunks SET
  contextual_prefix = NULL,
  contextual_prefix_model = NULL,
  contextual_prefix_model_version = NULL,
  contextual_prefix_generated_at = NULL,
  contextual_prefix_token_count = NULL
WHERE knowledge_item_id IN (<problematic items>);
```

Next embedding-worker pass re-embeds the chunks WITHOUT prefix
(baseline). No data loss — the embeddings still match the chunks, just
without the contextual signal.

### Per-profile (semantic rollback)

A `context_profile` row can opt out by setting
`use_contextual_prefix = false` (column to be added in WP 1.4b — NOT
in this PR; per-profile granular rollout is a follow-up).

### Stack-wide (nuclear)

```sql
UPDATE knowledge_chunks SET contextual_prefix = NULL
WHERE contextual_prefix IS NOT NULL;
```

Then trigger a full embedding-worker re-pass. ~5.5 h walltime for 100k
chunks but **NO LLM cost** — embedding-only. This is the safe "if
contextual prefix is hurting retrieval, kill it and embed baseline"
escape hatch.

## §8 Operational guards

### Guard 1: Per-chunk failure → null return, NEVER throw

The lib's contract (`graceful degradation`, per its module docstring):
if the prefix LLM call fails after retries, returns `null` and the
caller embeds the chunk WITHOUT prefix. This degrades to baseline, not
to a stuck batch.

Gate test asserts this contract is documented in the lib.

### Guard 2: Body excerpt bounded to ~6000 chars

`DEFAULT_BODY_EXCERPT_CHARS = 6000` in the lib. Without this, a 1MB
parent document would pay 10× the per-chunk cost. Gate test asserts
the constant exists.

### Guard 3: Completion tokens bounded to 120

`DEFAULT_MAX_TOKENS = 120` in the lib. Without this, a confused LLM
producing 2000-token essays would explode cost on a per-chunk basis.
Gate test asserts the constant exists.

### Guard 4: Audit-on-write, NOT audit-on-success

`fn_enrich_chunk_context_audited` writes to `audit_journal` on every
successful enrichment. This is the cost-tracking surface — the cost
projection in §3 is computed off this audit row count.

## §9 Related WPs

- **WP 3.1** Qwen3-Embedding-4B self-host — when shipped, the
  re-embedding cost drops from $0.00002 to ~$0 (self-hosted GPU, no
  egress). Re-run the cost model in §2 after WP 3.1.
- **WP 3.2** Prompt injection guard — quarantine_status NOT IN
  ('flagged', 'quarantined') filter applies to retrieval AFTER
  contextual prefix re-embedding. Quarantined chunks stay out of the
  index regardless of prefix.
- **WP 1.6** RAGAS nightly — measures the quality lift (or regression)
  per §6.
- **WP 13.4** IDE bridge backend WS — unrelated, but uses the same
  realtime fabric as the contextual-prefix backfill audit events
  (`audit_journal` INSERTs trigger `ws:db_changes`).

## §10 References

- Anthropic blog: "Introducing Contextual Retrieval"
  https://www.anthropic.com/news/contextual-retrieval
- Plan §-1.12 §1.4 — original WP spec
- Migration `aisha/db/migrations/20260518210000_contextual_retrieval.sql`
- Lib `services/svc-mcp-knowledge/src/lib/contextual-prefix.ts`
- RPC `aisha/db/sql/functions/fn_enrich_chunk_context_audited.sql`
- Gate test `src/tests/gates/wp-1-4-contextual-retrieval.gate.test.ts`
- `feedback_aisha_capability_applied_not_new` — this runbook documents
  + locks the EXISTING capability, doesn't introduce new infrastructure
