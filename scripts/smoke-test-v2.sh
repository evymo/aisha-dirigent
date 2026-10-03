#!/usr/bin/env bash
# =============================================================================
# smoke-test-v2.sh — Full v2 stack smoke test
# =============================================================================
# Validates all v2 services are running and responding correctly.
# Tests: health endpoints, PostgREST RPC, Keycloak OIDC, MinIO storage,
#         Gateway proxy, WebSocket gateway.
#
# Usage:
#   ./scripts/smoke-test-v2.sh                    # Test local stack
#   ./scripts/smoke-test-v2.sh --base=https://api.example.com  # Remote
#
# Required env vars (for auth/RPC tests):
#   GATEWAY_URL           — Gateway base URL (default: http://localhost:3001)
#   KC_URL                — Keycloak URL (default: http://localhost:8080)
#   KC_REALM              — Keycloak realm (default: aisha)
#   INTERNAL_API_KEY      — API key for internal endpoints (optional)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
SKIP=0

pass() { echo -e "  ${GREEN}✓${NC} $*"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${NC} $*"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; ((WARN++)); }
skip() { echo -e "  ${CYAN}○${NC} $*"; ((SKIP++)); }
section() { echo -e "\n${BOLD}═══ $* ═══${NC}"; }

# ── Config ──
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3001}"
KC_URL="${KC_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-aisha}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-}"
TIMEOUT=10

# Parse args
for arg in "$@"; do
  case "$arg" in
    --base=*) GATEWAY_URL="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 [--base=URL]"
      exit 0
      ;;
  esac
done

echo -e "${BOLD}Smoke Test — Evymo v2 Stack${NC}"
echo "Gateway: ${GATEWAY_URL}"
echo "Keycloak: ${KC_URL}"
echo ""

# ── Helper: HTTP check ──
http_check() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null || true)

  if [[ "$status" == "$expected_status" ]]; then
    pass "${name} (${status})"
    return 0
  elif [[ "$status" == "000" ]]; then
    fail "${name} — connection refused/timeout"
    return 1
  else
    fail "${name} — expected ${expected_status}, got ${status}"
    return 1
  fi
}

# ── Helper: JSON health check ──
health_check() {
  local name="$1"
  local url="$2"

  local resp
  resp=$(curl -s --max-time "$TIMEOUT" "$url" 2>/dev/null || echo "")

  if [[ -z "$resp" ]]; then
    fail "${name} — no response"
    return 1
  fi

  local status_field
  status_field=$(echo "$resp" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')

  if [[ "$status_field" == "ok" || "$status_field" == "healthy" ]]; then
    pass "${name}"
    return 0
  elif [[ "$status_field" == "degraded" ]]; then
    warn "${name} — degraded"
    return 0
  else
    fail "${name} — status: ${status_field:-unknown}"
    return 1
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# 1. Infrastructure services
# ══════════════════════════════════════════════════════════════════════════════
section "1. Infrastructure"

# PG17 via PostgREST
http_check "PostgREST" "http://localhost:3000/" 200

# Keycloak
http_check "Keycloak" "${KC_URL}/health/ready" 200

# Redis
if command -v redis-cli &>/dev/null; then
  REDIS_PONG=$(redis-cli -h localhost -p 6379 ping 2>/dev/null || echo "")
  if [[ "$REDIS_PONG" == "PONG" ]]; then
    pass "Redis"
  else
    fail "Redis — no PONG"
  fi
else
  # Try via TCP
  if nc -z localhost 6379 2>/dev/null; then
    pass "Redis (TCP)"
  else
    fail "Redis — port 6379 not reachable"
  fi
fi

# MinIO
http_check "MinIO health" "http://localhost:9000/minio/health/live" 200

# ══════════════════════════════════════════════════════════════════════════════
# 2. Gateway & aggregated health
# ══════════════════════════════════════════════════════════════════════════════
section "2. Gateway"

health_check "Gateway /health" "${GATEWAY_URL}/health"
health_check "Gateway /api/health (upstream probes)" "${GATEWAY_URL}/api/health"

# ══════════════════════════════════════════════════════════════════════════════
# 3. All microservices /health
# ══════════════════════════════════════════════════════════════════════════════
section "3. Microservices"

declare -A SERVICES=(
  ["ws-gateway"]=3002
  ["storage-auth"]=3005
  ["svc-stripe"]=3010
  ["svc-ai-chat"]=3011
  ["svc-push"]=3012
  ["svc-blockchain"]=3013
  ["svc-fio-bank"]=3014
  ["svc-homeassistant"]=3015
  ["svc-github-app"]=3016
  ["svc-mcp-knowledge"]=3017
  ["svc-health-ai"]=3024
  ["svc-livekit"]=3025
  ["svc-matrix"]=3026
  ["svc-communications"]=3027
  ["svc-packeta"]=3028
  ["svc-plugin-system"]=3029
)

for svc in $(echo "${!SERVICES[@]}" | tr ' ' '\n' | sort); do
  port="${SERVICES[$svc]}"
  health_check "${svc}" "http://localhost:${port}/health"
done

# ══════════════════════════════════════════════════════════════════════════════
# 4. Keycloak OIDC discovery
# ══════════════════════════════════════════════════════════════════════════════
section "4. Keycloak OIDC"

OIDC_URL="${KC_URL}/realms/${KC_REALM}/.well-known/openid-configuration"
OIDC_RESP=$(curl -s --max-time "$TIMEOUT" "$OIDC_URL" 2>/dev/null || echo "")

if grep -q '"issuer"' <<< "$OIDC_RESP"; then
  pass "OIDC discovery (${KC_REALM})"

  # Check required endpoints
  for endpoint in "authorization_endpoint" "token_endpoint" "userinfo_endpoint" "jwks_uri"; do
    if grep -q "\"${endpoint}\"" <<< "$OIDC_RESP"; then
      pass "  ${endpoint} present"
    else
      fail "  ${endpoint} missing"
    fi
  done
else
  fail "OIDC discovery — no issuer in response"
fi

# Check aisha-app client exists (PKCE public client)
CLIENT_CHECK=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" \
  "${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/auth?client_id=aisha-app&response_type=code&redirect_uri=http://localhost&scope=openid" 2>/dev/null || true)
if [[ "$CLIENT_CHECK" == "200" || "$CLIENT_CHECK" == "302" ]]; then
  pass "aisha-app client (PKCE auth redirect)"
else
  fail "aisha-app client — status ${CLIENT_CHECK}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 5. Gateway proxy → PostgREST RPC
# ══════════════════════════════════════════════════════════════════════════════
section "5. PostgREST RPC via Gateway"

# Test a public RPC function (if any exist without auth)
RPC_RESP=$(curl -s --max-time "$TIMEOUT" \
  -X POST "${GATEWAY_URL}/rest/v1/rpc/get_public_hero_slides" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AISHA_POSTGREST_ANON_KEY:-}" \
  -d '{}' 2>/dev/null || echo "")

RPC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" \
  -X POST "${GATEWAY_URL}/rest/v1/rpc/get_public_hero_slides" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AISHA_POSTGREST_ANON_KEY:-}" \
  -d '{}' 2>/dev/null || true)

if [[ "$RPC_STATUS" == "200" ]]; then
  pass "PostgREST RPC proxy (get_public_hero_slides)"
elif [[ "$RPC_STATUS" == "401" || "$RPC_STATUS" == "403" ]]; then
  warn "PostgREST RPC — auth required (${RPC_STATUS}) — expected for anon"
else
  fail "PostgREST RPC — status ${RPC_STATUS}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 6. MinIO storage operations (if keys available)
# ══════════════════════════════════════════════════════════════════════════════
section "6. Storage (MinIO)"

if command -v mc &>/dev/null; then
  # Check if buckets exist
  BUCKET_COUNT=$(mc ls evymo-new/ 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "$BUCKET_COUNT" -gt 0 ]]; then
    pass "MinIO buckets: ${BUCKET_COUNT}"
  else
    warn "MinIO — no buckets (run storage-migrate.sh)"
  fi
else
  skip "MinIO bucket check (mc not installed)"
fi

# Test storage-auth signed URL endpoint
SA_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" \
  "http://localhost:3005/health" 2>/dev/null || true)
if [[ "$SA_STATUS" == "200" ]]; then
  pass "storage-auth service"
else
  fail "storage-auth — status ${SA_STATUS}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 7. Internal endpoints (if API key available)
# ══════════════════════════════════════════════════════════════════════════════
section "7. Internal endpoints"

if [[ -n "$INTERNAL_API_KEY" ]]; then
  # Test deployment executor health
  INT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" \
    -H "Authorization: Bearer ${INTERNAL_API_KEY}" \
    "${GATEWAY_URL}/internal/deployment-status" 2>/dev/null || true)

  if [[ "$INT_STATUS" == "200" || "$INT_STATUS" == "404" ]]; then
    pass "Internal endpoint auth (${INT_STATUS})"
  else
    fail "Internal endpoint — status ${INT_STATUS}"
  fi
else
  skip "Internal endpoints (no INTERNAL_API_KEY)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 8. WebSocket gateway
# ══════════════════════════════════════════════════════════════════════════════
section "8. WebSocket"

WS_HEALTH=$(curl -s --max-time "$TIMEOUT" "http://localhost:3002/health" 2>/dev/null || echo "")
if grep -q '"status"' <<< "$WS_HEALTH"; then
  pass "WebSocket gateway"
  # Check client count
  CLIENTS=$(echo "$WS_HEALTH" | grep -o '"clients"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
  if [[ -n "$CLIENTS" ]]; then
    echo -e "    Connected clients: ${CLIENTS}"
  fi
else
  fail "WebSocket gateway — no health response"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC}  ${PASS}"
echo -e "  ${RED}Failed:${NC}  ${FAIL}"
echo -e "  ${YELLOW}Warn:${NC}    ${WARN}"
echo -e "  ${CYAN}Skipped:${NC} ${SKIP}"
echo -e "${BOLD}════════════════════════════════════════${NC}"

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "\n${RED}SMOKE TEST FAILED — ${FAIL} check(s) failed${NC}"
  exit 1
else
  echo -e "\n${GREEN}SMOKE TEST PASSED${NC}"
  exit 0
fi
