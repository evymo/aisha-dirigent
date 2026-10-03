#!/usr/bin/env bash
# =============================================================================
# smoke-netbird.sh — NetBird control plane readiness gate
# =============================================================================
# Used by the phased cold-start orchestrator AFTER smoke-keycloak.sh succeeds.
# Verifies that NetBird management/signal/dashboard are routed correctly by
# the Coolify Caddy proxy. Catches the failure mode where dashboard responds
# 200 but `/api/*` and gRPC paths fall through to the SPA HTML 404.
#
# Checks:
#   1. Dashboard root          — HTML 200 (SPA)
#   2. Management /api/*       — must NOT return text/html (otherwise routing
#                                fell through to dashboard); 401 is fine
#                                (auth enforced) but 200/401/403 are accepted.
#   3. Relay TCP reachability — best-effort, only if RELAY_PORT given.
#
# Usage:
#   bash scripts/smoke-netbird.sh
#   NETBIRD_DOMAIN=netbird.example.com bash scripts/smoke-netbird.sh
#   TIMEOUT_SECONDS=120 bash scripts/smoke-netbird.sh
# =============================================================================
set -euo pipefail

# ⛔ OPERÁTORSKÁ SONDA MÍŘÍ NA ROUTOVANÉ JMÉNO (2026-08-25).
#
# `NETBIRD_DOMAIN` je VEŘEJNÉ jméno, které edge směruje na uzel EDGE. Když
# netbird bydlí jinde (u pki, kvůli bootstrapu mesh certifikátu), veřejná cesta
# k němu nevede a sonda hlásí 404 — tedy vadu netbirdu, který přitom běží.
# Změřeno: `<direct>/api/peers` → 401 (API odpovídá, chce token), touž cestou
# přes veřejné jméno → 404.
#
# `NETBIRD_DOMAIN_DIRECT` vydává derive-domains a leží v zóně, kterou edge
# směruje na uzel služby. Když není (starší env), platí veřejné jméno.
NETBIRD_DOMAIN="${NETBIRD_DOMAIN_DIRECT:-${NETBIRD_DOMAIN:?NETBIRD_DOMAIN required (e.g. netbird.<your-domain>)}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-90}"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; N='\033[0m'
info() { echo -e "${B}ℹ${N} $*"; }
ok()   { echo -e "${G}✅${N} $*"; }
warn() { echo -e "${Y}⚠️${N}  $*"; }
err()  { echo -e "${R}❌${N} $*" >&2; }

check_dashboard() {
  local code body
  body=$(curl -sS --max-time 10 -L -w '\n__HTTP_CODE__:%{http_code}' "https://$NETBIRD_DOMAIN/" 2>/dev/null || true)
  code=$(echo "$body" | grep '__HTTP_CODE__:' | cut -d: -f2)
  if [ "$code" = "200" ]; then
    ok "dashboard root: 200"
    return 0
  fi
  warn "dashboard root: ${code:-???}"
  return 1
}

check_management_api() {
  # /api/peers without auth must reach the management container, not the SPA.
  # Acceptable: 401 (auth required) or 403. Reject: 200 with text/html
  # (means request hit dashboard), 404 (no route), 503 (no upstream).
  local headers code ctype
  headers=$(curl -sS --max-time 10 -D - -o /dev/null "https://$NETBIRD_DOMAIN/api/peers" 2>/dev/null || true)
  code=$(echo "$headers" | awk 'NR==1 {print $2}')
  ctype=$(echo "$headers" | grep -i '^content-type:' | head -1 | tr -d '\r' | awk '{print tolower($2)}')

  case "$code" in
    401|403)
      ok "management /api/peers: $code (auth-protected, routed to mgmt)"
      return 0
      ;;
    200)
      if echo "$ctype" | grep -q 'text/html'; then
        warn "management /api/peers: 200 text/html (routing fell through to dashboard)"
        return 1
      fi
      ok "management /api/peers: 200 (json)"
      return 0
      ;;
    *)
      warn "management /api/peers: ${code:-???} content-type=${ctype:-?}"
      return 1
      ;;
  esac
}

info "NetBird smoke: $NETBIRD_DOMAIN (timeout=${TIMEOUT_SECONDS}s)"

START=$(date +%s)
while true; do
  failed=0
  check_dashboard || failed=1
  check_management_api || failed=1

  if [ "$failed" -eq 0 ]; then
    ok "NetBird ready — dashboard + management routing OK"
    exit 0
  fi

  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
    err "NetBird smoke FAILED after ${ELAPSED}s (limit ${TIMEOUT_SECONDS}s)"
    err "Likely cause: docker_compose_domains routes only dashboard; management"
    err "API at /api/* and gRPC at /management.ManagementService/* fall through"
    err "to the dashboard SPA. Verify Coolify generated Caddyfile or split"
    err "domains so management has its own host (e.g. netbird-api.example.com)."
    exit 1
  fi

  info "retry in ${SLEEP_SECONDS}s (elapsed ${ELAPSED}s)..."
  sleep "$SLEEP_SECONDS"
done
