#!/usr/bin/env bash
# =============================================================================
# smoke-keycloak.sh — Public Keycloak readiness gate
# =============================================================================
# Used by the phased cold-start orchestrator (scripts/aisha-cold-start.sh) to
# decide whether downstream services (NetBird, Langfuse, n8n, Synapse, etc.)
# may start. NetBird in particular discovers Keycloak via its public OIDC URL
# and crash-loops when discovery returns 503/404 — gating prevents that loop.
#
# Checks (all must succeed):
#   1. /health/ready               — Coolify proxy can reach KC
#   2. /realms/<realm>/.well-known/openid-configuration — realm exists
#   3. /realms/<realm>/protocol/openid-connect/certs    — JWKS endpoint serves keys
#
# Usage:
#   KC_URL=https://auth.example.com bash scripts/smoke-keycloak.sh  # realm=aisha
#   KC_URL=https://auth.example.com KC_REALM=foo \
#     bash scripts/smoke-keycloak.sh
#
#   TIMEOUT_SECONDS=120 bash scripts/smoke-keycloak.sh   # wait up to 120s
#
# Exit codes:
#   0 — all checks passed
#   1 — at least one check failed within timeout
# =============================================================================
set -euo pipefail

KC_URL="${KC_URL:-${KEYCLOAK_URL:?KEYCLOAK_URL or KC_URL must be set}}"
KC_REALM="${KC_REALM:-${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
SLEEP_SECONDS="${SLEEP_SECONDS:-3}"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; N='\033[0m'
info() { echo -e "${B}ℹ${N} $*"; }
ok()   { echo -e "${G}✅${N} $*"; }
warn() { echo -e "${Y}⚠️${N}  $*"; }
err()  { echo -e "${R}❌${N} $*" >&2; }

check_url() {
  local label="$1"
  local url="$2"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -L "$url" 2>/dev/null || true)
  if [ "$code" = "200" ]; then
    ok "$label: $code"
    return 0
  else
    warn "$label: $code (url=$url)"
    return 1
  fi
}

check_jwks_has_keys() {
  local url="$1"
  local body
  body=$(curl -sS --max-time 10 -L "$url" 2>/dev/null || echo '{}')
  if echo "$body" | jq -e '.keys | length > 0' >/dev/null 2>&1; then
    ok "JWKS contains $(echo "$body" | jq '.keys | length') key(s)"
    return 0
  else
    warn "JWKS empty or invalid (url=$url)"
    return 1
  fi
}

info "Keycloak smoke: $KC_URL (realm=$KC_REALM, timeout=${TIMEOUT_SECONDS}s)"

START=$(date +%s)
while true; do
  failed=0
  check_url "/health/ready" "$KC_URL/health/ready" || failed=1
  check_url "OIDC discovery"  "$KC_URL/realms/$KC_REALM/.well-known/openid-configuration" || failed=1
  check_jwks_has_keys "$KC_URL/realms/$KC_REALM/protocol/openid-connect/certs" || failed=1

  if [ "$failed" -eq 0 ]; then
    ok "Keycloak ready — all gates passed"
    exit 0
  fi

  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
    err "Keycloak smoke FAILED after ${ELAPSED}s (limit ${TIMEOUT_SECONDS}s)"
    exit 1
  fi

  info "retry in ${SLEEP_SECONDS}s (elapsed ${ELAPSED}s)..."
  sleep "$SLEEP_SECONDS"
done
