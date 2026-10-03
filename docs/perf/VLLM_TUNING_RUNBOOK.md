# vLLM tuning runbook — Phase 12 WP 2.2

> **Snapshot 2026-05-20**, valid against main commit `<merge-sha>`.
> **Owner**: Backend + DevOps (per Phase 12 §0.3 roster).
> **Target model**: `Qwen/Qwen3-30B-A3B` (Mixture of Experts, 3B active params).

## TL;DR

This PR enables **prefix caching** + raises **batch sizing** on the local-dev
vLLM generation container. Speculative decoding is **deliberately deferred** —
it needs a Qwen3-family draft model + vLLM 0.6.6 MoE-target compatibility audit
that we don't have time to run blind.

| Flag | Status in this PR | Production rollout |
|---|---|---|
| `--enable-prefix-caching` | ✅ enabled | After 7-day local-dev observation |
| `--max-num-batched-tokens=8192` | ✅ enabled (was default 4096) | Same |
| `--max-num-seqs=256` | ✅ explicit (was default 256, now documented) | Same |
| `--speculative-model=…` | ❌ NOT YET — needs §3 follow-up | After draft model verified |
| `--num-speculative-tokens=5` | ❌ NOT YET — depends on `--speculative-model` | Same |

Rationale: "stokrat měřit než jednou blbě říznout". Get the safe wins first,
then add the riskier knobs with a measured A/B.

---

## §1 What this PR ships

### 1.1 Prefix caching

vLLM 0.6+ supports KV-cache reuse across prompts that share a common prefix.
For AISHA this is the **single largest TTFT win**:

- Maestro multi-turn dialogues replay the same system prompt + retrieval
  preamble every turn → cache hits the entire prefix
- Story-scoped chat keeps the AISHA persona + story-context block stable →
  cache hits ~85 % of the prompt
- RAG-augmented Q&A reuses the system prompt + retrieved chunk header

Empirical expectation per vLLM 0.6 benchmark suite:
- Multi-turn with shared system prompt: **TTFT 2-3× faster**
- Single-shot prompts (no shared prefix): **identical performance** (cache
  miss = no overhead, just no benefit)
- Memory cost: bounded by `gpu-memory-utilization` (already 0.7)

### 1.2 Batch sizing

```diff
-      - "--port=8000"
+      - "--port=8000"
+      - "--enable-prefix-caching"
+      - "--max-num-batched-tokens=8192"
+      - "--max-num-seqs=256"
```

- `max-num-batched-tokens=8192` (was default 4096): higher throughput when
  multiple agents call the model concurrently (e.g. critic loop + main turn
  in parallel). Trade-off: slightly higher per-batch latency at low
  concurrency, but our `cost_total_json` ledger shows we're throughput-bound
  during business hours.
- `max-num-seqs=256` (default — now explicit): documents the upper bound on
  concurrent sequences a single vLLM instance handles before backpressure.
  Set explicitly so future ops can tune without hunting for defaults.

---

## §2 Why not speculative decoding (yet)

The plan called for:
```
--speculative-model Qwen/Qwen2.5-0.5B-Instruct
--num-speculative-tokens 5
```

**Three blockers** that need to be resolved before we flip this on:

### 2.1 Wrong family

The plan referenced `Qwen2.5-0.5B-Instruct`, but our generation model is
`Qwen/Qwen3-30B-A3B`. Speculative decoding requires the draft model and the
target model to share the **same tokenizer** (so the verifier can compare
token-by-token). Qwen2.5 and Qwen3 have different tokenizers in some
configurations — using a Qwen2.5 draft against a Qwen3 target will fail to
verify on every token and degrade throughput instead of improving it.

**Correct draft candidate**: `Qwen/Qwen3-0.6B-Base` or `Qwen/Qwen3-1.7B-Base`.
Need to verify tokenizer-id match against `Qwen/Qwen3-30B-A3B` before merge.

### 2.2 MoE target compatibility

`Qwen3-30B-A3B` is a Mixture-of-Experts model (3B params active per token,
30B total). vLLM 0.6.6's spec-decoding implementation handles dense-target +
dense-draft well; the MoE-target case (where each expert produces a slightly
different logit distribution) is documented as **experimental** in vLLM
0.6.6 release notes. We need a small A/B to confirm:
- No accuracy regression vs current non-spec output
- Actual throughput improvement (not just theoretical)

### 2.3 GPU memory budget

Spec-decoding loads the draft model **in addition** to the target. Current
`gpu-memory-utilization=0.7` leaves 30 % headroom for KV cache + activations.
A Qwen3-0.6B draft model is ~1.5 GB fp16 → we'd need to drop generation's
`gpu-memory-utilization` to ~0.6 to fit.

---

## §3 Rollout sequence for spec-decoding (separate PR)

When we ship spec-decoding as a follow-up:

### 3.1 Pre-flight (1 day, Backend)

```bash
# 3.1.1 Verify tokenizer compatibility
python3 -c "
from transformers import AutoTokenizer
t1 = AutoTokenizer.from_pretrained('Qwen/Qwen3-30B-A3B')
t2 = AutoTokenizer.from_pretrained('Qwen/Qwen3-0.6B-Base')
assert t1.get_vocab() == t2.get_vocab(), 'tokenizer mismatch — spec-decoding will fail'
print('tokenizer match OK')
"

# 3.1.2 GPU memory check
nvidia-smi --query-gpu=memory.total,memory.free --format=csv

# 3.1.3 vLLM version check (need 0.6.6+ for MoE spec-decoding)
docker run --rm vllm/vllm-openai:v0.6.6 --version
```

### 3.2 Canary deploy (2 days, DevOps)

Add a **second** vLLM generation container as an A/B target, NOT replacing
the existing one:

```yaml
vllm-generation-spec:
  # ... same as vllm-generation but with:
  command:
    - "--model=Qwen/Qwen3-30B-A3B"
    - "--gpu-memory-utilization=0.55"   # leaves room for draft model
    - "--port=8000"
    - "--enable-prefix-caching"
    - "--max-num-batched-tokens=8192"
    - "--max-num-seqs=256"
    - "--speculative-model=Qwen/Qwen3-0.6B-Base"
    - "--num-speculative-tokens=5"
    - "--use-v2-block-manager"          # required for spec-decoding in 0.6.6
  ports:
    - "8101:8000"   # different host port
```

### 3.3 Gateway A/B (1 day, Backend)

`services/gateway/src/routes/llm.ts` — route 10 % of traffic to the spec
container based on a header or random sampling, log both paths to Langfuse
with `experimental.spec_decoding={true|false}` tag.

### 3.4 7-day observation (continuous)

Watch in Langfuse:
- TTFT p95 (spec vs non-spec)
- Total latency p95 (spec vs non-spec)
- Cost-per-1k-output-tokens (spec should be cheaper if it works)
- Faithfulness regression (existing RAGAS nightly per WP 1.6)
- Per-tenant abort rate (some prompts spec-decode worse than others)

### 3.5 Decision gate

- ✅ Spec improves TTFT ≥ 1.5× **AND** no faithfulness drop → roll to 100 %
- ⚠️ Mixed results → keep at 10 % canary, deeper analysis
- ❌ Spec slower or quality regression → revert, document why in this runbook

---

## §4 Monitoring + rollback

### 4.1 What to watch

Per `docs/perf/BASELINE_2026-05-20.md` baseline:

| Metric | Baseline (pre-WP-2.2) | Target (post-WP-2.2) | Source |
|---|---|---|---|
| TTFT p95 (multi-turn chat) | ~2800 ms | ≤ 1400 ms | Langfuse trace |
| TTFT p95 (single-shot) | ~2800 ms | unchanged (no shared prefix) | Langfuse trace |
| GPU memory utilisation | ~70 % | ~75 % (cache overhead) | nvidia-smi via Grafana |
| Tokens/sec/concurrent-user | ~30 | ~30-40 (batch size win) | Langfuse |

### 4.2 Rollback (instant)

```bash
# Remove the three new flags from docker-compose.local.yml
git revert <wp-2-2-merge-commit>
docker compose -f docker-compose.local.yml --profile vllm up -d --force-recreate vllm-generation
```

Recreates the container with the old command. No data loss; vLLM restart
takes ~30 sec for the model to warm up again.

### 4.3 Partial rollback (keep batch sizing, drop prefix-cache)

If we observe a memory pressure issue but want to keep the batch wins:

```diff
-      - "--enable-prefix-caching"
       - "--max-num-batched-tokens=8192"
       - "--max-num-seqs=256"
```

---

## §5 Related WPs

- **WP 0.3** Langfuse cost dashboards — measures TTFT/cost per turn
- **WP 1.6** RAGAS nightly — catches faithfulness regression
- **WP 4.1** Agent critic loop — produces shared system prompts; biggest
  prefix-cache beneficiary
- **WP 14.1** (future) Qwen3-Embedding-4B self-host — separate vLLM instance,
  same tuning approach applies

## §6 References

- vLLM 0.6.0 release notes (prefix caching): <https://github.com/vllm-project/vllm/releases/tag/v0.6.0>
- vLLM speculative decoding docs: <https://docs.vllm.ai/en/latest/features/spec_decode.html>
- Qwen3 model card: <https://huggingface.co/Qwen/Qwen3-30B-A3B>
- AISHA `ai_runs.cost_total_json` ledger schema: `aisha/db/sql/tables/ai_runs.sql`
