#!/usr/bin/env bash
# scripts/test-brain-wiring.sh — End-to-end brain wiring smoke test
#
# Verifikuje synergii vrstev AISHA brain layer **přes živé RPC volání**:
#   1. Tao (fn_get_tao_principles) — governance principles
#   2. Psyche (fn_get_psyche_traits) — personality DNA
#   3. compose_context — 4-layer assembly s p_story_id (per-story isolation)
#   4. Ruleset layer — story_rulesets přes story_contexts.ruleset_id
#   5. KB retrieval — pgvector search přes mcp_search_knowledge_v2
#   6. RBAC — anon access denial pro per-story data
#   7. Per-story isolation — zero cross-leak
#
# Cílem je validovat **kompletní flow** který svc-ai-chat /story-consult orchestruje,
# bez závislosti na Keycloak JWT (testujeme přes service-role token).
#
# Provoz:
#   STORY_ID=<uuid> bash scripts/test-brain-wiring.sh
#
# Required env (load: source .env-prod-backup):
#   POSTGREST_SERVICE_TOKEN — service_role JWT for AISHA PostgREST
#   STORY_ID                — the story whose wiring to verify. NO default: the
#                             platform seed ships no demo stories, so a built-in
#                             id would point at a row that does not exist.
#
# Exit codes:
#   0 — všechny vrstvy OK (synergie verified)
#   1 — chybějící env / connection
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

PG_CONTAINER="${PG_CONTAINER:-aisha-db}"
POSTGREST_HOST="${POSTGREST_HOST:-aisha-postgrest:3000}"
COOLIFY_NETWORK="${COOLIFY_NETWORK:-coolify}"
STORY_ID="${STORY_ID:-}"
SERVICE_TOKEN="${POSTGREST_SERVICE_TOKEN:-${SERVICE_TOKEN:-}}"

PASS=0
FAIL=0

# Service-role token MUST come from env — no committed credential fallback (security).
if [ -z "$SERVICE_TOKEN" ]; then
  echo "ERROR: set POSTGREST_SERVICE_TOKEN (or SERVICE_TOKEN) — no hardcoded fallback" >&2
  exit 1
fi

# The story is an explicit input — fail loud, never guess one. It is also
# interpolated into SQL below, so only a UUID is accepted.
if [ -z "$STORY_ID" ]; then
  echo "ERROR: set STORY_ID=<uuid> — the story to verify (no default; the platform seed ships no demo stories)" >&2
  echo "       e.g. list candidates: docker exec $PG_CONTAINER psql -U postgres -d postgres -tAc \"SELECT id, title FROM partner_stories ORDER BY last_activity_at DESC NULLS LAST LIMIT 10\"" >&2
  exit 1
fi
if ! [[ "$STORY_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "ERROR: STORY_ID '$STORY_ID' is not a UUID" >&2
  exit 1
fi

# ── Helper: PostgREST RPC call přes coolify network ─────────────────────────
rpc_call() {
  local fn="$1"
  local body="$2"
  local extra_header="${3:-}"
  docker run --rm --network="$COOLIFY_NETWORK" alpine sh -c "
    apk add --no-cache curl >/dev/null 2>&1
    curl -sS -X POST \
      -H 'Authorization: Bearer $SERVICE_TOKEN' \
      -H 'Content-Type: application/json' \
      $extra_header \
      -d '$body' \
      http://$POSTGREST_HOST/rpc/$fn
  " 2>&1
}

count_array() {
  python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d) if isinstance(d, list) else 0)" 2>/dev/null
}

count_jsonb_path() {
  local path="$1"
  python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
keys='$path'.split('.')
for k in keys:
    if isinstance(d, dict): d=d.get(k, {})
    elif isinstance(d, list): d=d[int(k)] if int(k) < len(d) else {}
    else: d={}
print(len(d) if isinstance(d, (list,dict)) else 0)
" 2>/dev/null
}

# ── Stage 0: Preflight ──────────────────────────────────────────────────────
info "Stage 0: Preflight"
if ! docker ps --format "{{.Names}}" | grep "^${PG_CONTAINER}$" >/dev/null; then
  fail "Container $PG_CONTAINER neběží. Spusť AISHA stack."
  exit 1
fi
ok "Container $PG_CONTAINER healthy"

# Verify story exists
STORY_EXISTS=$(docker exec "$PG_CONTAINER" psql -U postgres -d postgres -tAc "SELECT count(*) FROM partner_stories WHERE id = '$STORY_ID'::uuid;" 2>&1)
if [ "$STORY_EXISTS" != "1" ]; then
  fail "Story $STORY_ID nenalezena v partner_stories"
  exit 1
fi
ok "Story $STORY_ID existuje"

# ── Stage 1: Tao (governance principles) ────────────────────────────────────
info "Stage 1: Tao governance principles"
TAO_RESP=$(rpc_call "fn_get_tao_principles" "{}")
TAO_COUNT=$(echo "$TAO_RESP" | count_array)
if [ "${TAO_COUNT:-0}" -ge 5 ]; then
  PASS=$((PASS + 1))
  ok "Tao principles: $TAO_COUNT (≥5 expected)"
else
  FAIL=$((FAIL + 1))
  fail "Tao principles: $TAO_COUNT (expected ≥5). Resp: $(echo "$TAO_RESP" | head -c 100)"
fi

# ── Stage 2: Psyche (personality DNA) ───────────────────────────────────────
info "Stage 2: Psyche personality traits"
PSYCHE_RESP=$(rpc_call "fn_get_psyche_traits" "{}")
PSYCHE_COUNT=$(echo "$PSYCHE_RESP" | count_array)
if [ "${PSYCHE_COUNT:-0}" -ge 5 ]; then
  PASS=$((PASS + 1))
  ok "Psyche traits: $PSYCHE_COUNT (≥5 expected)"
else
  FAIL=$((FAIL + 1))
  fail "Psyche traits: $PSYCHE_COUNT. Resp: $(echo "$PSYCHE_RESP" | head -c 100)"
fi

# ── Stage 3: compose_context — 4-layer assembly ────────────────────────────
info "Stage 3: compose_context with story+ruleset (repo_plus_rules profile)"
CTX_RESP=$(rpc_call "compose_context" "{\"p_story_id\":\"$STORY_ID\",\"p_context_profile_slug\":\"repo_plus_rules\",\"p_query\":\"jak používat RPC a Zod validation v AISHA?\"}")
LAYER_KEYS=$(echo "$CTX_RESP" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(','.join(sorted(d.get('layers',{}).keys())))" 2>/dev/null)

if echo "$LAYER_KEYS" | grep -q "kb_retrieval" && \
   echo "$LAYER_KEYS" | grep -q "psyche_context" && \
   echo "$LAYER_KEYS" | grep -q "ruleset" && \
   echo "$LAYER_KEYS" | grep -q "project_context"; then
  PASS=$((PASS + 1))
  ok "compose_context layers: $LAYER_KEYS"
else
  FAIL=$((FAIL + 1))
  fail "compose_context missing layers. Got: $LAYER_KEYS"
  echo "    Resp: $(echo "$CTX_RESP" | head -c 300)"
fi

# ── Stage 4: Ruleset layer — story_rulesets → expert_rules ─────────────────
info "Stage 4: Ruleset layer (story → expert_rules with Phase E relevance)"
RULESET_COUNT=$(echo "$CTX_RESP" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('layers',{}).get('ruleset',{}).get('rules',[])))" 2>/dev/null)
RULESET_FP=$(echo "$CTX_RESP" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('layers',{}).get('ruleset',{}).get('fingerprint','none'))" 2>/dev/null)

if [ "${RULESET_COUNT:-0}" -ge 1 ]; then
  PASS=$((PASS + 1))
  ok "Ruleset rules: $RULESET_COUNT (fingerprint: ${RULESET_FP:0:30}…)"
else
  FAIL=$((FAIL + 1))
  fail "Ruleset rules: $RULESET_COUNT. Story $STORY_ID nemá story_contexts → story_rulesets link?"
  warn "  Seed: SELECT * FROM story_rulesets WHERE story_id='$STORY_ID' a story_contexts entry"
fi

# ── Stage 5: KB retrieval (pgvector) ───────────────────────────────────────
info "Stage 5: pgvector kb_retrieval (text-only, no embedding)"
KB_COUNT=$(echo "$CTX_RESP" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('layers',{}).get('kb_retrieval',{}).get('chunks',[])))" 2>/dev/null)
if [ "${KB_COUNT:-0}" -ge 3 ]; then
  PASS=$((PASS + 1))
  ok "KB chunks: $KB_COUNT (≥3 expected)"
else
  FAIL=$((FAIL + 1))
  fail "KB chunks: $KB_COUNT. compose_context má kb_retrieval.enabled? embeddings populated?"
fi

# ── Stage 6: RBAC — anon denied for per-story ─────────────────────────────
info "Stage 6: RBAC enforcement (anon → 42501)"
ANON_RESP=$(docker run --rm --network="$COOLIFY_NETWORK" alpine sh -c "
  apk add --no-cache curl >/dev/null 2>&1
  curl -sS -w 'HTTP=%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    -d '{\"p_story_id\":\"$STORY_ID\",\"p_query_text\":\"test\"}' \
    http://$POSTGREST_HOST/rpc/mcp_search_knowledge_v2
" 2>&1)
if grep -q "42501\|Access denied\|Unauthorized" <<< "$ANON_RESP"; then
  PASS=$((PASS + 1))
  ok "RBAC: anon access denied (ERRCODE 42501)"
else
  FAIL=$((FAIL + 1))
  fail "RBAC: anon was NOT denied! Resp: $(echo "$ANON_RESP" | head -c 200)"
fi

# ── Stage 7: Per-story isolation — no cross-leak ──────────────────────────
info "Stage 7: Per-story isolation (global search → no per-story items)"
GLOBAL_RESP=$(rpc_call "mcp_search_knowledge_v2" "{\"p_query_text\":\"AISHA babička\",\"p_limit\":10}")
STORY_LEAK=$(echo "$GLOBAL_RESP" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
leaked = [r for r in d if r.get('story_id') is not None]
print(len(leaked))
" 2>/dev/null)
if [ "${STORY_LEAK:-0}" = "0" ]; then
  PASS=$((PASS + 1))
  ok "Per-story isolation: globální search nezasáhl per-story items (zero leak)"
else
  FAIL=$((FAIL + 1))
  fail "Per-story isolation: $STORY_LEAK per-story items leaked do global search!"
fi

# ── Final report ────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "Brain wiring smoke summary:"
echo "  ${GREEN}${PASS} passed${NC} / ${RED}${FAIL} failed${NC}"
echo "  Story: ${STORY_ID}"
echo "  Layers verified: Tao, Psyche, compose_context (4-layer), Ruleset, KB, RBAC, isolation"
echo "============================================================"

if [ $FAIL -eq 0 ]; then
  ok "Brain wiring synergy verified end-to-end."
  exit 0
else
  fail "Brain wiring má $FAIL failed stages — viz výpis výše."
  exit 2
fi
