# vLLM reranker runbook — Phase 12 WP 4.3

> **Snapshot 2026-05-20**, valid against main commit `<merge-sha>`.
> **Owner**: Backend + DevOps (per Phase 12 §0.3 roster).
> **Target**: Stage-2 rerank rollout per `RAG_STEP_6_1_PREFLIGHT.md` (Phase 10
> PR-E). Adds `bge-reranker-v2-m3` as 3rd vLLM profile, reusing existing GPU
> stack + model cache volume per §-1.12 R4.

## TL;DR

| Before this PR | After |
|---|---|
| Stage-2 rerank not wired (only `fn_record_rerank_event_audited` + capability resolver shape) | `BAAI/bge-reranker-v2-m3` running as 3rd vLLM profile, registered in `ai_provider_registry` |
| `context_profiles` has no rerank column | New `rerank_provider` column (NULL by default → no behavior change) |
| Per-profile rerank choice ambiguous | Explicit enum: `vllm_local` / `cohere` / `capability_resolver` |

**This PR ships the infrastructure**. The per-profile enablement (Step 3 below) is the **operator action** post-merge — no profile is auto-flipped to use rerank.

## §1 What this PR ships

### 1.1 Compose

`docker-compose.local.yml` adds `vllm-reranker` service under `--profile vllm`. Reuses existing `vllm-models` volume (no duplicate model download), shares the same GPU partition.

GPU budget audit:

| Service | utilisation | VRAM (16 GB GPU) |
|---|---|---|
| `vllm-generation` (Qwen3-30B-A3B MoE) | 0.70 | ~11.2 GB |
| `vllm-embedding` (Qwen3-Embedding-0.6B) | 0.10 | ~1.6 GB |
| `vllm-reranker` (bge-reranker-v2-m3) | **0.15** | ~2.4 GB |
| **Total** | **0.95** | ~15.2 GB |
| Free headroom | 0.05 | ~0.8 GB (KV cache spikes) |

If your GPU is smaller than 16 GB you must either:
- Drop `vllm-generation` to a smaller model (Qwen3-1.7B), or
- Run reranker on a dedicated host (still cheaper than building a separate
  Docker image).

### 1.2 Provider registry

Migration `20260521040000_bge_reranker_provider.sql` seeds two rows in
`ai_provider_registry`:

| slug | backend_kind | is_enabled | cost_class |
|---|---|---|---|
| `bge_reranker_local` | `local_vllm` | true | budget |
| `cohere_rerank` | `direct_cloud` | **false** | premium |

Cohere stays disabled by default — admins enable it per premium-tier
customer via `update_provider_admin` RPC. AISHA's `capability_resolver`
will pick `bge_reranker_local` when a profile says
`rerank_provider='capability_resolver'` and the local reranker is healthy.

### 1.3 Context profiles column

`context_profiles.rerank_provider` is nullable (default → behaviour
identical to today, no rerank). Operator sets it per profile:

```sql
UPDATE context_profiles SET rerank_provider = 'vllm_local'
WHERE slug = 'evidence_strict';
```

## §2 Why bge-reranker-v2-m3

| Criterion | bge-reranker-v2-m3 | Cohere v3 | ColBERT v2 |
|---|---|---|---|
| Multilingual (cs/de/fr/ru/th + en) | ✅ (100+ langs trained) | ✅ | ⚠️ (en-leaning) |
| On-prem self-host | ✅ | ❌ (SaaS only) | ✅ |
| vLLM v0.6+ supports `--task=score` | ✅ | n/a | ⚠️ (manual wiring) |
| Params / VRAM | 568M / ~1.2 GB FP16 | n/a | ~330M |
| Recall@10 lift over BM25 (BEIR avg) | +9.2 pp | +9.5 pp | +8.4 pp |
| Per-query cost | GPU power only | $1/1k queries | GPU power only |
| Adds new infrastructure | ❌ (3rd vLLM profile) | n/a | ✅ (separate runtime) |

**Decision**: bge-reranker-v2-m3 because it reuses existing vLLM
infrastructure (no new image, no new runtime), supports all 6 AISHA
locales, and Cohere stays as a paid fallback for any customer who
contractually requires SaaS-only.

## §3 Per-profile canary rollout (operator action, NOT in this PR)

After the migration applies + the `vllm-reranker` container starts up
and reports healthy in `provider_health_probe`:

### Step 3.1 — Pilot profile (Day 1)

Pick **one** low-risk profile (suggest `evidence_strict` — already most-
measured by WP 1.6 RAGAS pipeline):

```sql
UPDATE context_profiles
SET rerank_provider = 'vllm_local'
WHERE slug = 'evidence_strict';
```

Wait 24 h. Read `WF_RAG_EVAL_NIGHTLY` regression-detection output (from
WP 1.6):

- `severity=ok` → continue
- `severity=warning` → investigate; check `rag_eval_runs.metadata` for
  Cohere-vs-vllm divergence
- `severity=critical` → revert (`UPDATE … SET rerank_provider = NULL`),
  open issue

### Step 3.2 — Expand profiles (Days 2-7)

If pilot stays green for 24 h, enable on `retrieval_default` + 2 more
profiles. Continue daily monitoring until all 6 active profiles are on
rerank or explicitly opted-out.

### Step 3.3 — Switch to capability_resolver (Week 2)

Once both `bge_reranker_local` and (optionally) `cohere_rerank` are
healthy:

```sql
UPDATE context_profiles
SET rerank_provider = 'capability_resolver'
WHERE slug IN ('evidence_strict', 'retrieval_default', ...);
```

AISHA's `aisha_resolve_clow_backend` will pick whichever rerank backend
is healthy + cheapest (cost_class='budget' wins by default), failing
back to `cohere` only when local is unhealthy. This matches the
"vse je dynamicke" principle from the master analysis.

## §4 Monitoring

### 4.1 Provider health

`WF_PROVIDER_HEALTH_PROBE` already probes every registered provider.
`bge_reranker_local` shows up automatically after the migration. Watch
`provider_health_probe.last_health_status` for the slug — should be
`healthy` within ~2 min of container start.

### 4.2 Rerank events

`fn_record_rerank_event_audited` (existing) logs every rerank call to
`audit_journal` action `'rag.rerank_completed'` + metadata
`{provider, candidates, picked, latency_ms, cost_usd}`. Query:

```sql
SELECT
  date_trunc('hour', created_at) AS hr,
  metadata->>'provider' AS provider,
  count(*) AS calls,
  avg((metadata->>'latency_ms')::int) AS avg_latency_ms
FROM audit_journal
WHERE action = 'rag.rerank_completed'
  AND created_at > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY hr DESC;
```

### 4.3 Quality

WP 1.6 RAGAS pipeline picks up rerank quality automatically — no extra
wiring. Expected lift per plan SLO: **+0.05 composite_avg** after the
rerank backend is enabled on a profile.

## §5 Rollback

### 5.1 Per-profile (instant, recommended)

```sql
UPDATE context_profiles SET rerank_provider = NULL
WHERE slug = '<profile>';
```

Next retrieval skips the rerank stage. No data loss, no service restart.

### 5.2 Provider-wide (1 min via admin RPC)

```sql
SELECT public.update_provider_admin(
  p_slug => 'bge_reranker_local',
  p_is_enabled => false
);
```

`capability_resolver` falls back to next healthy rerank provider (Cohere
if enabled) or skips rerank entirely.

### 5.3 Compose-level (5 min)

Stop the container:

```bash
docker compose -f docker-compose.local.yml --profile vllm stop vllm-reranker
```

GPU memory freed; other vLLM containers unaffected.

### 5.4 Schema rollback (NOT recommended once profile data exists)

```sql
ALTER TABLE context_profiles DROP COLUMN rerank_provider;
DELETE FROM ai_provider_registry WHERE slug IN ('bge_reranker_local', 'cohere_rerank');
```

This is destructive — only do this if you're sure no profile has
`rerank_provider != NULL`.

## §6 Cost transparency

Per-query cost estimate:

| Provider | Cost per 1k queries | Latency p95 |
|---|---|---|
| `bge_reranker_local` | GPU power (~$0.003 on a 16 GB GPU @ $0.40/h) | 50-100 ms |
| `cohere_rerank` | $1.00 (Cohere v3 pricing) | 100-200 ms (network) |

Cohere is ~300× more expensive per query, justified only when:
- SaaS-only contract requires it, OR
- GPU temporarily unavailable + premium customer demands no degradation

## §7 Related WPs

- **WP 0.3** Langfuse — auto-captures rerank LLM spans
- **WP 1.6** RAGAS nightly — measures quality lift automatically
- **WP 2.2** vLLM perf tuning — prefix caching + batch sizing applied
  to generation only; reranker doesn't benefit from prefix-cache
- **WP 14.1** (future) Qwen3-Embedding-4B self-host — independent
  rollout, same vllm-models cache volume

## §8 References

- bge-reranker-v2-m3 model card: <https://huggingface.co/BAAI/bge-reranker-v2-m3>
- vLLM `--task=score` docs: <https://docs.vllm.ai/en/latest/models/supported_models.html#scoring-rerank>
- AISHA `RAG_STEP_6_1_PREFLIGHT.md` (Phase 10 PR-E)
- `aisha_resolve_clow_backend` SoT: `aisha/db/sql/functions/aisha_resolve_clow_backend.sql`
