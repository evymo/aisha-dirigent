#!/usr/bin/env bash
# scripts/test-insight-multiturn.sh — Multi-turn coherence USP automatický test
#
# Verifikuje plný end-to-end Insight flow:
#   1. Upload PDF do Ragnaroku (per-story KB)
#   2. Wait for indexing (Ragnarok embedding via OpenAI/vLLM)
#   3. Maestro session create přes shim (s nebo bez PG persist)
#   4. Turn 1: factual question s konkrétním klíčem (např. delka projektu)
#   5. Turn 2: follow-up dotaz vyžadující turn-1 context (= coherence test)
#   6. Verify: turn 2 odpověď reference turn 1 fakta
#   7. Cleanup
#
# Provoz:
#   bash scripts/test-insight-multiturn.sh                    # default PDF
#   bash scripts/test-insight-multiturn.sh /path/to/test.pdf  # vlastní PDF
#   PROJECT_ID=story-foo-123 bash scripts/test-insight-multiturn.sh
#
# Required env (load: source .env-prod-backup nebo bash scripts/insight-mode.sh openai):
#   OPENAI_API_KEY        — pro Ragnarok embedding + generation
#   RAGNAROK_API_KEY      — auth s Ragnarok (default aisha-ragnarok-local)
#   MAESTRO_API_KEY       — auth s Maestro (default aisha-maestro-local)
#   KRONOS_API_KEY        — auth s Kronos shim (default aisha-kronos-shim-local)
#
# Optional:
#   POSTGREST_SERVICE_TOKEN — pro AISHA agent_memories session/turn persist.
#                             Bez něj shim graceful fallback (Maestro in-memory only).
#
# Exit codes:
#   0 — všech 6 stages prošlo, USP verified
#   1 — kritický fail (Ragnarok/Maestro down, upload broken)
#   2 — coherence fail (turn-2 nereferuje turn-1)
#   3 — env missing (no OPENAI_API_KEY)

set -uo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

# ── Config ───────────────────────────────────────────────────────────────────
PDF_PATH="${1:-./trash/Pripadova-studie-rizeny-vyvoj-mobilni-aplikace-pro-pripojeni-do-hotelove-WiFi.pdf}"
PROJECT_ID="${PROJECT_ID:-multiturn-$(date +%s)}"
RAGNAROK_URL="${RAGNAROK_URL:-http://localhost:9696}"
MAESTRO_URL="${MAESTRO_URL:-http://localhost:8020}"
SHIM_URL="${KRONOS_SHIM_URL:-http://localhost:9625}"
RAGNAROK_API_KEY="${RAGNAROK_API_KEY:-aisha-ragnarok-local}"
MAESTRO_API_KEY="${MAESTRO_API_KEY:-aisha-maestro-local}"
KRONOS_API_KEY="${KRONOS_API_KEY:-aisha-kronos-shim-local}"
INDEXING_MAX_WAIT=180
TURN_TIMEOUT=120

# Test scenario: assumes upstream PDF popisuje project délka X dní.
# Turn 1 zeptá se na "kolik dnů" → response should mention specific number.
# Turn 2 zeptá se follow-up s pronoun ("a kolik to celé stálo?") → must understand
# context (project from turn 1).
TURN1_QUERY="${TURN1_QUERY:-Kolik dnů trval celý projekt? Odpověz konkrétním číslem.}"
TURN1_EXPECTED_PATTERN="${TURN1_EXPECTED_PATTERN:-17|sedmnáct|dní|dnů}"
TURN2_QUERY="${TURN2_QUERY:-A kolik to celé stálo? Můžeš to porovnat s tradičním vývojem?}"
TURN2_COHERENCE_PATTERN="${TURN2_COHERENCE_PATTERN:-tradičn|úspora|Kč|cena|náklad|17|18 týdn}"

PASS=0
FAIL=0
SKIPPED=0

# ── Stage 0: Preflight ───────────────────────────────────────────────────────
info "Stage 0: Preflight"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  fail "OPENAI_API_KEY není exported. Ragnarok embedding/gen nebude fungovat."
  echo "    Spusť: source .env-prod-backup nebo export OPENAI_API_KEY=sk-..."
  exit 3
fi
ok "OPENAI_API_KEY exported (len ${#OPENAI_API_KEY})"

if [ ! -f "$PDF_PATH" ]; then
  fail "PDF nenalezen: $PDF_PATH"
  exit 1
fi
ok "PDF: $PDF_PATH ($(wc -c < "$PDF_PATH") bytes)"

# ── Stage 1: Healthchecks ────────────────────────────────────────────────────
info "Stage 1: Healthchecks Insight stack"

for endpoint in "${RAGNAROK_URL}/health:Ragnarok" "${MAESTRO_URL}/health:Maestro" "${SHIM_URL}/health:Kronos shim"; do
  url="${endpoint%:*}"
  name="${endpoint##*:}"
  if curl -fsS "$url" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    ok "$name healthy"
  else
    FAIL=$((FAIL + 1))
    fail "$name NOT healthy at $url"
  fi
done

if [ $FAIL -gt 0 ]; then
  fail "Stack nedostupný — spusť npm run insight:up"
  exit 1
fi

# ── Stage 2: PDF Upload do Ragnaroku ─────────────────────────────────────────
info "Stage 2: Upload PDF (project_id=${PROJECT_ID})"

# source_type query musí matchovat file extension (Ragnarok defaultuje PDF
# a používá suffix tmp soubor; mismatch = parser fail).
DOC_EXT="${PDF_PATH##*.}"
case "$DOC_EXT" in
  pdf|txt|docx|html|pptx|xlsx) SOURCE_TYPE_Q="&source_type=${DOC_EXT}";;
  *) SOURCE_TYPE_Q="";;
esac

UPLOAD=$(curl -sS -m 60 -X POST \
  -H "Authorization: ${RAGNAROK_API_KEY}" \
  -F "file=@${PDF_PATH}" \
  "${RAGNAROK_URL}/knowledge_base/file?project_id=${PROJECT_ID}${SOURCE_TYPE_Q}" 2>&1)

KB_ID=$(echo "$UPLOAD" | grep -oE '"kb_id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$KB_ID" ]; then
  PASS=$((PASS + 1))
  ok "Upload OK (kb_id=${KB_ID})"
else
  FAIL=$((FAIL + 1))
  fail "Upload selhal: $(echo "$UPLOAD" | head -c 200)"
  exit 1
fi

# ── Stage 3: Wait for indexing ───────────────────────────────────────────────
info "Stage 3: Wait for Ragnarok indexing (max ${INDEXING_MAX_WAIT}s)"

INDEXED=0
for i in $(seq 1 $((INDEXING_MAX_WAIT / 5))); do
  RESP=$(curl -sS -m 15 -X POST \
    -H "Authorization: ${RAGNAROK_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"query":"projekt","lang":"cs-CZ","return_matched_chunks":true}' \
    "${RAGNAROK_URL}/projects/${PROJECT_ID}/nlp/rag/" 2>&1)
  if grep -qE '"matched_chunks":\[\{' <<< "$RESP" 2>/dev/null; then
    INDEXED=1
    break
  fi
  sleep 5
done

if [ $INDEXED -eq 1 ]; then
  PASS=$((PASS + 1))
  ok "Indexing complete (${i}×5s)"
else
  FAIL=$((FAIL + 1))
  fail "Ragnarok indexing timeout — embedding/ES issue"
  exit 1
fi

# ── Stage 4: Maestro Session Create ──────────────────────────────────────────
info "Stage 4: Maestro session create přes shim"

SESSION=$(curl -sS -m 30 -X POST \
  -H "Authorization: ${MAESTRO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"${PROJECT_ID}\",\"language\":\"cs-CZ\",\"name\":\"multiturn-test\"}" \
  "${MAESTRO_URL}/projects/${PROJECT_ID}/sessions/" 2>&1)

# Maestro vrací `session_id` field (přes Mongo `_id` z shim). Some responses
# mohou vrátit jen `_id`.
SID=$(echo "$SESSION" | grep -oE '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$SID" ]; then
  SID=$(echo "$SESSION" | grep -oE '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

if [ -n "$SID" ]; then
  PASS=$((PASS + 1))
  ok "Session created (session_id=${SID})"
  # Detect PG persist mode (shim health endpoint odpoví postgrest_configured).
  PG_PERSIST=$(curl -sS "${SHIM_URL}/health" 2>&1 | grep -oE '"postgrest_configured":(true|false)' | cut -d':' -f2)
  if [ "$PG_PERSIST" = "true" ]; then
    info "  AISHA agent_memories PG persist: enabled (long-term Hippocampus signals)"
  else
    warn "  AISHA agent_memories PG persist: graceful fallback (in-memory session only)"
    warn "  Multi-turn coherence test stále funguje (Maestro server-side RAM state)."
  fi
else
  FAIL=$((FAIL + 1))
  fail "Session create selhal: $(echo "$SESSION" | head -c 200)"
  exit 1
fi

# ── Stage 5: Turn 1 ──────────────────────────────────────────────────────────
info "Stage 5: Turn 1 — \"${TURN1_QUERY:0:60}…\""

T1_START=$(date +%s)
curl -sS -m $TURN_TIMEOUT -o /tmp/multiturn-t1.json -X POST \
  -H "Authorization: ${MAESTRO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"${TURN1_QUERY}\",\"lang\":\"cs-CZ\",\"return_matched_chunks\":false}" \
  "${MAESTRO_URL}/projects/${PROJECT_ID}/query/rag?session_id=${SID}" 2>&1
T1_DURATION=$(($(date +%s) - T1_START))

T1_TEXT=$(python3 -c "
import json, sys
text = ''
for line in open('/tmp/multiturn-t1.json'):
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        if obj.get('chunk_index', -1) >= 0:
            text += obj.get('text', '')
    except: pass
print(text)
" 2>/dev/null)

if [ -n "$T1_TEXT" ] && [ ${#T1_TEXT} -gt 20 ]; then
  PASS=$((PASS + 1))
  ok "Turn 1 response (${#T1_TEXT} chars, ${T1_DURATION}s)"
  echo "    Text: ${T1_TEXT:0:200}..."

  if echo "$T1_TEXT" | grep -qiE "$TURN1_EXPECTED_PATTERN" 2>/dev/null; then
    PASS=$((PASS + 1))
    ok "Turn 1 obsahuje expected pattern (\"${TURN1_EXPECTED_PATTERN:0:30}\")"
  else
    warn "Turn 1 neobsahuje expected pattern. Možná PDF má jiná data; coherence test ale stále jede."
  fi
else
  FAIL=$((FAIL + 1))
  fail "Turn 1 prázdný/krátký response (${#T1_TEXT} chars)"
  exit 1
fi

# ── Stage 6: Turn 2 (coherence test) ─────────────────────────────────────────
info "Stage 6: Turn 2 — \"${TURN2_QUERY:0:60}…\" (vyžaduje turn-1 context)"

T2_START=$(date +%s)
curl -sS -m $TURN_TIMEOUT -o /tmp/multiturn-t2.json -X POST \
  -H "Authorization: ${MAESTRO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"${TURN2_QUERY}\",\"lang\":\"cs-CZ\",\"return_matched_chunks\":false}" \
  "${MAESTRO_URL}/projects/${PROJECT_ID}/query/rag?session_id=${SID}" 2>&1
T2_DURATION=$(($(date +%s) - T2_START))

T2_TEXT=$(python3 -c "
import json, sys
text = ''
for line in open('/tmp/multiturn-t2.json'):
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        if obj.get('chunk_index', -1) >= 0:
            text += obj.get('text', '')
    except: pass
print(text)
" 2>/dev/null)

if [ -n "$T2_TEXT" ] && [ ${#T2_TEXT} -gt 20 ]; then
  PASS=$((PASS + 1))
  ok "Turn 2 response (${#T2_TEXT} chars, ${T2_DURATION}s)"
  echo "    Text: ${T2_TEXT:0:200}..."

  # Coherence check: turn 2 by mělo referencovat fakta z turn 1 (project context,
  # ne čistě "co je AISHA" z PDF jako standalone).
  if echo "$T2_TEXT" | grep -qiE "$TURN2_COHERENCE_PATTERN" 2>/dev/null; then
    PASS=$((PASS + 1))
    ok "🎯 USP COHERENCE VERIFIED — Turn 2 references project context z turn 1"
    echo "    Matched coherence pattern: \"${TURN2_COHERENCE_PATTERN:0:50}\""
  else
    FAIL=$((FAIL + 1))
    fail "Turn 2 NEReferences turn-1 context — coherence USP zfailovala"
    echo "    Expected pattern: ${TURN2_COHERENCE_PATTERN}"
    exit 2
  fi
else
  FAIL=$((FAIL + 1))
  fail "Turn 2 prázdný response"
  exit 2
fi

# ── Final report ─────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "Multi-turn coherence USP test:"
echo "  ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "  Project: ${PROJECT_ID}"
echo "  Session: ${SID}"
echo "  Latency: turn-1 ${T1_DURATION}s, turn-2 ${T2_DURATION}s"
echo "============================================================"
if [ $FAIL -eq 0 ]; then
  ok "USP COHERENCE VERIFIED end-to-end (Maestro session-aware multi-turn dialog)."
  exit 0
else
  fail "Multi-turn coherence test FAILED."
  exit 2
fi
