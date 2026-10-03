#!/usr/bin/env bash
# scripts/insight-mode.sh — Helper pro přepínání backend mode Insight stacku.
#
# Exportuje INSIGHT_* env vars per zvolený mode + následně spustí (volitelně)
# `npm run insight:up`. Modes mapují na Ragnarok upstream LLMFactory schema
# (packages/insight/common/common/models/enums.py:ModelProvider).
#
# Modes:
#   openai   — Cloud-only: OpenAI gpt-4o-mini gen + text-embedding-3-small emb.
#              Vyžaduje OPENAI_API_KEY.
#   vllm     — On-prem GPU: Qwen3-30B-A3B gen + Qwen3-Embedding-0.6B emb.
#              Vyžaduje vLLM containers (profile vllm) + NVIDIA GPU.
#   hybrid   — Cost-optimized: vLLM emb (lokálně) + OpenAI gen (cloud).
#              Vyžaduje vLLM containers + OPENAI_API_KEY.
#   offline  — Bez generation/embedding: Ragnarok jen retrieval (BM25).
#              Žádný klíč, žádný GPU. Pro CI / smoke healthchecks.
#
# Použití:
#   bash scripts/insight-mode.sh openai          # exportuje + neudělá nic víc
#   bash scripts/insight-mode.sh vllm --up       # exportuje + npm run insight:up
#   eval "$(bash scripts/insight-mode.sh vllm)"  # source do shellu
#   source scripts/insight-mode.sh openai        # alternativně přes source

set -euo pipefail

MODE="${1:-}"
ACTION="${2:-print}"

if [ -z "$MODE" ]; then
  echo "Usage: $0 <mode> [--up|--print|--source]" >&2
  echo "Modes: openai | vllm | hybrid | offline" >&2
  exit 1
fi

# Reset všech INSIGHT_* + COHERE_API_KEY na clean state
unset INSIGHT_LLM_PROVIDER INSIGHT_LLM_MODEL INSIGHT_LLM_BASE_URL \
      INSIGHT_EMB_PROVIDER INSIGHT_EMB_MODEL INSIGHT_EMB_BASE_URL \
      INSIGHT_OPENAI_TYPE INSIGHT_OPENAI_ENDPOINT INSIGHT_RERANK_PROVIDER 2>/dev/null || true

case "$MODE" in
  openai)
    export INSIGHT_LLM_PROVIDER=OpenAI
    export INSIGHT_LLM_MODEL=gpt-4o-mini
    export INSIGHT_LLM_BASE_URL=
    export INSIGHT_EMB_PROVIDER=OpenAI
    export INSIGHT_EMB_MODEL=text-embedding-3-small
    export INSIGHT_EMB_BASE_URL=
    export INSIGHT_OPENAI_TYPE=OpenAI
    export INSIGHT_OPENAI_ENDPOINT=None
    export INSIGHT_RERANK_PROVIDER=Cohere
    if [ -z "${OPENAI_API_KEY:-}" ]; then
      echo "⚠️  OPENAI_API_KEY není set — Ragnarok zfailí na embedding." >&2
      echo "   export OPENAI_API_KEY=sk-... před npm run insight:up" >&2
    fi
    ;;
  vllm)
    export INSIGHT_LLM_PROVIDER=vLLM
    export INSIGHT_LLM_MODEL="${INSIGHT_LLM_MODEL_OVERRIDE:-Qwen/Qwen3-30B-A3B}"
    export INSIGHT_LLM_BASE_URL="${VLLM_GENERATION_URL:-http://vllm-generation:8000/v1}"
    export INSIGHT_EMB_PROVIDER=vLLM
    export INSIGHT_EMB_MODEL="${INSIGHT_EMB_MODEL_OVERRIDE:-Qwen/Qwen3-Embedding-0.6B}"
    export INSIGHT_EMB_BASE_URL="${VLLM_EMBEDDING_URL:-http://vllm-embedding:8000/v1}"
    export INSIGHT_OPENAI_TYPE=None
    export INSIGHT_OPENAI_ENDPOINT=None
    export INSIGHT_RERANK_PROVIDER=Cohere
    echo "ℹ️  vLLM mode vyžaduje vllm-embedding + vllm-generation containers (profile vllm)." >&2
    echo "   Spusť: npm run insight:up && docker compose -f docker-compose.local.yml --profile vllm up -d" >&2
    ;;
  hybrid)
    # vLLM embedding (lokálně, levné) + OpenAI generation (cloud, kvalitní)
    export INSIGHT_LLM_PROVIDER=OpenAI
    export INSIGHT_LLM_MODEL=gpt-4o-mini
    export INSIGHT_LLM_BASE_URL=
    export INSIGHT_EMB_PROVIDER=vLLM
    export INSIGHT_EMB_MODEL="${INSIGHT_EMB_MODEL_OVERRIDE:-Qwen/Qwen3-Embedding-0.6B}"
    export INSIGHT_EMB_BASE_URL="${VLLM_EMBEDDING_URL:-http://vllm-embedding:8000/v1}"
    export INSIGHT_OPENAI_TYPE=OpenAI
    export INSIGHT_OPENAI_ENDPOINT=None
    export INSIGHT_RERANK_PROVIDER=Cohere
    if [ -z "${OPENAI_API_KEY:-}" ]; then
      echo "⚠️  Hybrid mode vyžaduje OPENAI_API_KEY pro generation." >&2
    fi
    ;;
  offline)
    # Žádný LLM provider — Ragnarok jen retrieval (BM25, ne KNN bez embedding).
    # Pydantic OPENAI_TYPE=None projde, DEFAULT_PROVIDER_* taky None nebo OpenAI
    # bez klíče (Ragnarok pak zfailí na actual call, ale healthchecks projdou).
    export INSIGHT_LLM_PROVIDER=OpenAI
    export INSIGHT_LLM_MODEL=gpt-4o-mini
    export INSIGHT_LLM_BASE_URL=
    export INSIGHT_EMB_PROVIDER=OpenAI
    export INSIGHT_EMB_MODEL=text-embedding-3-small
    export INSIGHT_EMB_BASE_URL=
    export INSIGHT_OPENAI_TYPE=None
    export INSIGHT_OPENAI_ENDPOINT=None
    export INSIGHT_RERANK_PROVIDER=Cohere
    echo "ℹ️  Offline mode — Ragnarok healthcheck OK, ale RAG calls zfailí (no LLM)." >&2
    echo "   Smoke test stages 2-4 se SKIPnou, stage 1 (healthchecks) projde." >&2
    ;;
  *)
    echo "❌ Unknown mode: $MODE" >&2
    echo "Modes: openai | vllm | hybrid | offline" >&2
    exit 1
    ;;
esac

# Output mode summary (bez secrets — jen provider names + URLs)
echo "Insight mode: $MODE"
echo "  LLM: $INSIGHT_LLM_PROVIDER ($INSIGHT_LLM_MODEL)${INSIGHT_LLM_BASE_URL:+ @ $INSIGHT_LLM_BASE_URL}"
echo "  EMB: $INSIGHT_EMB_PROVIDER ($INSIGHT_EMB_MODEL)${INSIGHT_EMB_BASE_URL:+ @ $INSIGHT_EMB_BASE_URL}"
echo "  OPENAI_TYPE: $INSIGHT_OPENAI_TYPE${INSIGHT_OPENAI_ENDPOINT:+ @ $INSIGHT_OPENAI_ENDPOINT}"
echo "  RERANK: $INSIGHT_RERANK_PROVIDER"

case "$ACTION" in
  --up|up)
    echo ""
    echo "→ Restartuji Insight stack..."
    docker compose -f docker-compose.local.yml --profile insight down 2>&1 | tail -3
    docker compose -f docker-compose.local.yml --profile insight up -d 2>&1 | tail -8
    ;;
  --source|source)
    # Pro `eval $(bash insight-mode.sh openai --source)` — print export commands
    echo ""
    echo "# Source-friendly exports:"
    env | grep -E "^INSIGHT_" | sed 's/^/export /'
    ;;
  --print|print|"")
    : # default — env vars jsou už exportovány v current shell scope
    ;;
  *)
    echo "❌ Unknown action: $ACTION" >&2
    echo "Actions: --up | --source | --print (default)" >&2
    exit 1
    ;;
esac
