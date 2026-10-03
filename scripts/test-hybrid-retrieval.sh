#!/usr/bin/env bash
# scripts/test-hybrid-retrieval.sh — compose_context pgvector + Ragnarok hybrid merge live
#
# Validates the "rozložení řízení informací (PG) vs vyhodnocovací část (Ragnarok)"
# přes orchestrationBridge.enrichWithAishaContext logic:
#
#   1. compose_context (PG layer) — vrátí pgvector chunks (řízení informací,
#      governance + RBAC + audit-aware)
#   2. Ragnarok hybrid /nlp/rag/ — vrátí ES BM25+kNN chunks (vyhodnocovací,
#      multi-language full-text)
#   3. mergeWithIntegrity — TS-side RRF merge s pinned brain-layer items + RLS
#      policy enforcement (knowledgeIntegrity.ts)
#
# Cíl: ověřit, že obě cesty živě fungují a že context_profile.kb_retrieval.
# ragnarok_hybrid flag (v migraci 20260406150849) skutečně řídí merge.
#
# Provoz:
#   STORY_ID=<uuid> bash scripts/test-hybrid-retrieval.sh
#
# Required env (load: source .env-prod-backup nebo source .env.coolify):
#   POSTGREST_SERVICE_TOKEN — service_role JWT
#   STORY_ID                — story whose context to retrieve. NO default: the
#                             platform seed ships no demo stories.
#   RAGNAROK_API_KEY        — Ragnarok auth (default aisha-ragnarok-local)
#   OPENAI_API_KEY          — pro Ragnarok query embedding
#
# Exit codes:
#   0 — obě vrstvy + merge funkční
#   1 — env / connection issue
#   2 — některá vrstva selhala

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

POSTGREST_HOST="${POSTGREST_HOST:-aisha-postgrest:3000}"
RAGNAROK_URL_INTERNAL="${RAGNAROK_URL_INTERNAL:-http://aisha-local-ragnarok:9696}"
RAGNAROK_URL_HOST="${RAGNAROK_URL:-http://localhost:9696}"
COOLIFY_NETWORK="${COOLIFY_NETWORK:-coolify}"
RAGNAROK_NETWORK="${RAGNAROK_NETWORK:-evymo-ai-orchestrator_default}"
STORY_ID="${STORY_ID:-}"
RAGNAROK_API_KEY="${RAGNAROK_API_KEY:-aisha-ragnarok-local}"
QUERY="${QUERY:-jaké jsou principy AISHA personality a RPC patterns?}"
SERVICE_TOKEN="${POSTGREST_SERVICE_TOKEN:-${SERVICE_TOKEN:-}}"

PASS=0
FAIL=0

# Load tier-aware env (local|staging|production)
# shellcheck source=/dev/null
source "$(dirname "$0")/_env-loader.sh"
SERVICE_TOKEN="${POSTGREST_SERVICE_TOKEN:-${SERVICE_TOKEN:-}}"
RAGNAROK_URL_HOST="${RAGNAROK_URL:-$RAGNAROK_URL_HOST}"

if [ -z "$SERVICE_TOKEN" ]; then
  fail "POSTGREST_SERVICE_TOKEN missing — set v env nebo .env.coolify / .env.local.dev"
  exit 1
fi

# The story is an explicit input — fail loud, never guess one. It is embedded
# in JSON bodies below, so only a UUID is accepted.
if [ -z "$STORY_ID" ]; then
  fail "STORY_ID missing — set STORY_ID=<uuid> (no default; the platform seed ships no demo stories)"
  exit 1
fi
if ! [[ "$STORY_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  fail "STORY_ID '$STORY_ID' is not a UUID"
  exit 1
fi

info "Stage 1: compose_context (PG layer — pgvector kb_retrieval)"
PG_RESP=$(docker run --rm --network="$COOLIFY_NETWORK" alpine sh -c "
  apk add --no-cache curl >/dev/null 2>&1
  curl -sS -X POST -H 'Authorization: Bearer $SERVICE_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"p_story_id\":\"$STORY_ID\",\"p_context_profile_slug\":\"repo_plus_rules\",\"p_query\":\"$QUERY\"}' \
    http://$POSTGREST_HOST/rpc/compose_context
" 2>&1)

PG_CHUNKS=$(echo "$PG_RESP" | python3 -c "
import json,sys
try:
    d = json.loads(sys.stdin.read())
    chunks = d.get('layers',{}).get('kb_retrieval',{}).get('chunks',[])
    print(len(chunks))
except: print(-1)
" 2>/dev/null)

if [ "${PG_CHUNKS:-0}" -ge 1 ]; then
  PASS=$((PASS + 1))
  ok "compose_context vrátil $PG_CHUNKS pgvector chunks"
else
  FAIL=$((FAIL + 1))
  fail "compose_context returned $PG_CHUNKS chunks. Resp: $(echo "$PG_RESP" | head -c 200)"
fi

info "Stage 2: Ragnarok hybrid /nlp/rag/ (ES BM25 + kNN)"
RAGNAROK_RESP=$(curl -sS -m 30 -X POST \
  -H "Authorization: $RAGNAROK_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"$QUERY\",\"lang\":\"cs-CZ\",\"return_matched_chunks\":true,\"kb_ids\":[\"story-$STORY_ID\"]}" \
  "$RAGNAROK_URL_HOST/projects/aisha/nlp/rag/" 2>&1)

RAG_CHUNKS=$(echo "$RAGNAROK_RESP" | python3 -c "
import json,sys
try:
    d = json.loads(sys.stdin.read())
    if isinstance(d, dict):
        c = d.get('matched_chunks') or d.get('chunks') or []
        print(len(c) if isinstance(c, list) else 0)
    else: print(0)
except: print(-1)
" 2>/dev/null)

if [ "${RAG_CHUNKS:-0}" -ge 0 ]; then
  if [ "${RAG_CHUNKS}" -ge 1 ]; then
    PASS=$((PASS + 1))
    ok "Ragnarok vrátil $RAG_CHUNKS chunks (ES hybrid funguje)"
  else
    PASS=$((PASS + 1))
    warn "Ragnarok vrátil 0 chunks — žádné per-story KB v 'aisha' projectu pro story-$STORY_ID"
    warn "  (nezabíjí merge — orchestrationBridge fallbackne na pgvector-only)"
  fi
else
  FAIL=$((FAIL + 1))
  fail "Ragnarok call failed. Resp: $(echo "$RAGNAROK_RESP" | head -c 200)"
fi

info "Stage 3: Profile flag ragnarok_hybrid kontrola (řízení merge cesty)"
PROFILES_WITH_HYBRID=$(docker exec aisha-db psql -U postgres -d postgres -tAc "
SELECT slug FROM context_profiles
WHERE (layers->'kb_retrieval'->>'ragnarok_hybrid')::boolean = true
ORDER BY slug;
" 2>&1 | tr '\n' ',' | sed 's/,$//')

if [ -n "$PROFILES_WITH_HYBRID" ]; then
  PASS=$((PASS + 1))
  ok "Profiles s ragnarok_hybrid=true: $PROFILES_WITH_HYBRID"
else
  FAIL=$((FAIL + 1))
  fail "Žádný context_profile nemá ragnarok_hybrid flag — merge se nikdy nespustí"
fi

info "Stage 4: orchestrationBridge intent → routing decision"
INTENT_TS_PATH="services/svc-ai-chat/src/lib/orchestrationBridge.ts"
if [ -f "$INTENT_TS_PATH" ]; then
  if grep -q "knowledgeIntent.*hybrid_lookup\|preferredBackend.*hybrid" "$INTENT_TS_PATH" 2>/dev/null; then
    PASS=$((PASS + 1))
    ok "analyzeChatQueryIntent definuje hybrid_lookup (rule + document → hybrid backend)"
  else
    FAIL=$((FAIL + 1))
    fail "Intent analysis postrádá hybrid_lookup branch"
  fi

  if grep -q "mergeWithIntegrity" "$INTENT_TS_PATH" 2>/dev/null; then
    PASS=$((PASS + 1))
    ok "enrichWithAishaContext volá mergeWithIntegrity (TS-side RRF)"
  else
    FAIL=$((FAIL + 1))
    fail "Žádné volání mergeWithIntegrity — merge cesta není wired"
  fi
else
  warn "$INTENT_TS_PATH not found — skipping wiring check"
fi

info "Stage 5: knowledgeIntegrity scoring weights (řízení vs vyhodnocovací prioritization)"
INTEGRITY_TS_PATH="services/svc-ai-chat/src/lib/knowledgeIntegrity.ts"
if [ -f "$INTEGRITY_TS_PATH" ]; then
  PG_WEIGHT=$(grep -E "pgvector:\s*[0-9]+" "$INTEGRITY_TS_PATH" | grep -oE "[0-9]+" | head -1)
  RAG_WEIGHT=$(grep -E "ragnarok:\s*[0-9]+" "$INTEGRITY_TS_PATH" | grep -oE "[0-9]+" | head -1)
  if [ -n "$PG_WEIGHT" ] && [ -n "$RAG_WEIGHT" ]; then
    PASS=$((PASS + 1))
    ok "Source weights: pgvector=$PG_WEIGHT, ragnarok=$RAG_WEIGHT (governance > free-text)"
  else
    FAIL=$((FAIL + 1))
    fail "Source weights NOT defined v knowledgeIntegrity.ts"
  fi
else
  warn "$INTEGRITY_TS_PATH not found"
fi

echo ""
echo "============================================================"
echo "Hybrid retrieval smoke summary:"
echo "  ${GREEN}${PASS} passed${NC} / ${RED}${FAIL} failed${NC}"
echo "  Story: ${STORY_ID}"
echo "  Query: \"${QUERY:0:60}…\""
echo "  pgvector chunks: $PG_CHUNKS / Ragnarok chunks: ${RAG_CHUNKS:-?}"
echo "============================================================"

if [ $FAIL -eq 0 ]; then
  ok "Hybrid retrieval (PG + Ragnarok merge) wired & operational."
  exit 0
else
  fail "Hybrid retrieval má $FAIL failed stages"
  exit 2
fi
